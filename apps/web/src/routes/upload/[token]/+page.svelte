<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { verifyUploadLink, uploadEmployeeFile, pollUploadStatus } from '$lib/api';
  import type { VerifyResult, DocumentRecord } from '$lib/api';
  import { apiUrl } from '$lib/apiBase';

  const token = $page.params.token ?? '';

  // ── UI State ────────────────────────────────────────────────────
  type Phase = 'verify' | 'portal' | 'expired' | 'invalid' | 'resuming';
  let phase = $state<Phase>('resuming');
  let last4 = $state('');
  let verifying = $state(false);
  let verifyError = $state('');

  let employee = $state<VerifyResult['employee'] | null>(null);
  let documents = $state<DocumentRecord[]>([]);
  let expiresAt = $state('');

  // Per-doc upload state
  let uploading = $state<Record<number, boolean>>({});
  let uploadProgress = $state<Record<number, number>>({});
  let uploadError = $state<Record<number, string>>({});
  let dragOverId = $state<number | null>(null);
  let fileInputs: Record<number, HTMLInputElement | null> = {};

  // ── Portal session (client-side only) ────────────────────────────
  // The server treats every request as stateless — token + last4 are
  // re-checked on every call, and re-verifying with the *correct* digits
  // never counts against the attempt lockout. So "staying signed in" for
  // 30 minutes is just: remember last4 locally and keep silently replaying
  // it, rather than asking the person to retype it on every visit. The
  // digits are low-sensitivity (a public suffix of their own employee code;
  // the real security boundary is the server's 5-attempt lockout), so
  // holding them in localStorage for a bounded window is a reasonable
  // trade for not re-prompting someone mid-onboarding on their phone.
  const SESSION_MS = 30 * 60 * 1000;
  const sessionKey = `medicore_upload_session_${token}`;

  function loadSession(): { last4: string } | null {
    try {
      const raw = localStorage.getItem(sessionKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { last4: string; expiresAt: number };
      if (Date.now() > parsed.expiresAt) {
        localStorage.removeItem(sessionKey);
        return null;
      }
      return { last4: parsed.last4 };
    } catch {
      return null;
    }
  }
  function saveSession(digits: string) {
    localStorage.setItem(sessionKey, JSON.stringify({ last4: digits, expiresAt: Date.now() + SESSION_MS }));
  }
  function extendSession() {
    if (last4) saveSession(last4);
  }
  function clearStoredSession() {
    localStorage.removeItem(sessionKey);
  }

  function categorizeError(err: unknown): 'expired' | 'invalid' | 'other' {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (msg.includes('expired') || msg.includes('too many')) return 'expired';
    if (msg.includes('not found')) return 'invalid';
    return 'other';
  }

  function signOut() {
    clearStoredSession();
    employee = null;
    documents = [];
    last4 = '';
    verifyError = '';
    phase = 'verify';
    queueMicrotask(() => inputEl?.focus());
  }

  // ── Verify identity ─────────────────────────────────────────────
  let shake = $state(false);
  let inputEl: HTMLInputElement | undefined = $state();

  onMount(async () => {
    const stored = loadSession();
    if (!stored) {
      phase = 'verify';
      inputEl?.focus();
      return;
    }
    last4 = stored.last4;
    try {
      const res = await verifyUploadLink(token, stored.last4);
      employee = res.employee;
      documents = res.documents;
      expiresAt = res.expiresAt;
      phase = 'portal';
      extendSession();
    } catch (err) {
      clearStoredSession();
      const kind = categorizeError(err);
      phase = kind === 'other' ? 'verify' : kind;
      if (phase === 'verify') queueMicrotask(() => inputEl?.focus());
    }
  });

  function onDigitInput(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    last4 = digits;
    input.value = digits;
  }

  function triggerShake() {
    shake = false;
    requestAnimationFrame(() => (shake = true));
  }

  async function handleVerify(e: SubmitEvent) {
    e.preventDefault();
    const digits = last4.trim();
    if (digits.length !== 4) {
      verifyError = 'Enter 4 digits.';
      triggerShake();
      return;
    }
    verifying = true;
    verifyError = '';
    try {
      const res = await verifyUploadLink(token, digits);
      employee = res.employee;
      documents = res.documents;
      expiresAt = res.expiresAt;
      phase = 'portal';
      saveSession(digits);
    } catch (err) {
      const kind = categorizeError(err);
      if (kind !== 'other') {
        phase = kind;
      } else {
        // Whatever the exact reason (wrong digits, no match) — one plain
        // answer. The server still enforces the real attempt limit; this
        // is just what the person sees.
        verifyError = 'Wrong ID.';
        triggerShake();
      }
    } finally {
      verifying = false;
    }
  }

  // ── File upload with progress ────────────────────────────────────
  function performUpload(docId: number, file: File) {
    return new Promise<DocumentRecord>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl(`/api/upload-links/${token}/documents/${docId}/file`));

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          uploadProgress[docId] = Math.round((e.loaded / e.total) * 100);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (_) {
            reject(new Error('Invalid response'));
          }
        } else {
          try {
            const res = JSON.parse(xhr.responseText);
            reject(new Error(res.error ?? 'Upload failed'));
          } catch (_) {
            reject(new Error(xhr.statusText || 'Upload failed'));
          }
        }
      };

      xhr.onerror = () => reject(new Error('Network error'));

      const form = new FormData();
      form.append('file', file);
      form.append('last4', last4.trim());
      xhr.send(form);
    });
  }

  const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_BYTES = 10 * 1024 * 1024;

  async function validateAndUpload(docId: number, file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      uploadError[docId] = 'Only PDF and image files (JPG, PNG, WebP, GIF) are accepted.';
      return;
    }
    if (file.size > MAX_BYTES) {
      uploadError[docId] = 'File must be under 10 MB.';
      return;
    }

    uploading[docId] = true;
    uploadProgress[docId] = 0;
    uploadError[docId] = '';
    try {
      const updated = await performUpload(docId, file);
      documents = documents.map((d) => (d.id === updated.id ? updated : d));
      extendSession();
    } catch (err) {
      uploadError[docId] = err instanceof Error ? err.message : 'Upload failed. Please try again.';
    } finally {
      uploading[docId] = false;
    }
  }

  function handleFileChange(docId: number, e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    validateAndUpload(docId, file);
  }

  // Verified documents are locked — HR has signed off, no self-service
  // replace, matching the "no action needed" copy shown on that row.
  function isLocked(docId: number) {
    return documents.find((d) => d.id === docId)?.status === 'verified';
  }

  function handleDrop(docId: number, e: DragEvent) {
    e.preventDefault();
    dragOverId = null;
    if (isLocked(docId)) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    validateAndUpload(docId, file);
  }
  function handleDragOver(docId: number, e: DragEvent) {
    e.preventDefault();
    if (isLocked(docId)) return;
    dragOverId = docId;
  }
  function handleDragLeave(docId: number) {
    if (dragOverId === docId) dragOverId = null;
  }

  // ── Poll status + inactivity check every 30 s while portal is open ─
  $effect(() => {
    if (phase === 'portal') {
      const interval = setInterval(async () => {
        const stored = loadSession();
        if (!stored) {
          // 30 minutes of inactivity — this is the "token refresh timed
          // out" case: end the session automatically rather than let a
          // stale tab keep polling forever.
          signOut();
          return;
        }
        try {
          const res = await pollUploadStatus(token, last4.trim());
          documents = res.documents;
        } catch (_) {}
      }, 30000);
      return () => clearInterval(interval);
    }
  });

  const done = $derived(documents.filter((d) => d.fileAttached).length);
  const total = $derived(documents.length);

  // ── Helpers ─────────────────────────────────────────────────────
  function statusLabel(s: string) {
    return { pending: 'Pending', received: 'Received', verified: 'Verified', rejected: 'Rejected' }[s] ?? s;
  }
  function statusClass(s: string) {
    return { pending: 'badge-warn', received: 'badge-info', verified: 'badge-ok', rejected: 'badge-err' }[s] ?? '';
  }
  function docLabel(t: string) {
    return t
      .split('_')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');
  }
  function fileSize(bytes: number | null) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function daysLeft(iso: string) {
    const diff = new Date(iso).getTime() - Date.now();
    return Math.max(0, Math.floor(diff / 86400000));
  }
</script>

<svelte:head>
  <title>Document Upload Portal | MediCore HR</title>
  <meta name="description" content="Securely upload your onboarding documents to MediCore HR." />
</svelte:head>
<div class="portal-shell">
  <!-- ── RESUMING SESSION ─────────────────────────────────────── -->
  {#if phase === 'resuming'}
    <div class="simple-state" aria-live="polite">
      <i class="ti ti-loader-2 spin" aria-hidden="true" style="font-size: 1.5rem; color: var(--gray-500);"></i>
    </div>

  <!-- ── INVALID LINK ──────────────────────────────────────────── -->
  {:else if phase === 'invalid'}
    <div class="simple-state">
      <p class="eyebrow">Link problem</p>
      <h1>This link isn't valid</h1>
      <p class="hint">Ask your HR officer for a new one.</p>
    </div>

  <!-- ── EXPIRED LINK ──────────────────────────────────────────── -->
  {:else if phase === 'expired'}
    <div class="simple-state">
      <p class="eyebrow">Link expired</p>
      <h1>This link no longer works</h1>
      <p class="hint">Ask your HR officer for a new one.</p>
    </div>

  <!-- ── VERIFY IDENTITY ──────────────────────────────────────── -->
  {:else if phase === 'verify'}
    <div class="verify-simple">
      <div class="mark">M</div>
      <h1>Enter the last 4 digits of your Employee ID</h1>

      <form onsubmit={handleVerify} class="verify-form-simple">
        <input
          bind:this={inputEl}
          value={last4}
          oninput={onDigitInput}
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="4"
          placeholder="0000"
          aria-label="Last 4 digits of your Employee ID"
          class:error={!!verifyError}
          class:shake
          autocomplete="off"
        />
        <p class="caption">Example: HRM-2026-0045 → 0045</p>

        {#if verifyError}
          <p class="wrong-id">{verifyError}</p>
        {/if}

        <button type="submit" class="btn-continue" disabled={verifying}>
          {#if verifying}
            <i class="ti ti-loader-2 spin" aria-hidden="true"></i> Checking…
          {:else}
            Continue
          {/if}
        </button>
      </form>
    </div>

  <!-- ── DOCUMENT PORTAL ──────────────────────────────────────── -->
  {:else if phase === 'portal' && employee}
    <div class="portal-wrapper">
      <!-- Header — one band: identity + the one action a signed-in person needs -->
      <header class="portal-header">
        <div class="header-inner">
          <div class="brand">
            <div class="brand-logo">MC</div>
            <div class="brand-copy">
              <span class="brand-text">MediCore HR</span>
              <span class="crumb">Document Portal</span>
            </div>
          </div>
          <div class="header-right">
            <div class="employee-badge">
              <div class="emp-avatar">{employee.fullNameLatin.charAt(0)}</div>
              <div class="emp-meta">
                <strong>{employee.fullNameLatin}</strong>
                <span class="emp-sub">{employee.employeeCode} · {employee.department}</span>
              </div>
            </div>
            <button class="signout-btn" onclick={signOut} title="Sign out of this document portal">
              <i class="ti ti-logout" aria-hidden="true"></i> Sign out
            </button>
          </div>
        </div>
      </header>

      <!-- Main content -->
      <main class="portal-main">
        <div class="section-title">
          <h2>Your documents</h2>
          <p>Drag a file onto the row it belongs to, or click Upload. PDF or image, up to 10 MB.</p>
        </div>

        <!-- Progress summary -->
        <div class="progress-summary">
          <div class="progress-header">
            <span>{done} of {total} uploaded</span>
            <span class="progress-count">{total ? Math.round((done / total) * 100) : 0}%</span>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: {total ? (done / total) * 100 : 0}%"></div>
          </div>
        </div>

        <div class="doc-list">
          {#each documents as doc (doc.id)}
            <div
              class="portal-doc-row"
              class:doc-verified={doc.status === 'verified'}
              class:doc-rejected={doc.status === 'rejected'}
              class:doc-dragover={dragOverId === doc.id}
              ondragover={(e) => handleDragOver(doc.id, e)}
              ondragleave={() => handleDragLeave(doc.id)}
              ondrop={(e) => handleDrop(doc.id, e)}
              role="group"
              aria-label="{docLabel(doc.docType)} — {statusLabel(doc.status)}"
            >
              <div class="doc-icon">
                {#if doc.status === 'verified'}
                  <i class="ti ti-discount-check" aria-hidden="true"></i>
                {:else if doc.status === 'rejected'}
                  <i class="ti ti-circle-x" aria-hidden="true"></i>
                {:else if dragOverId === doc.id}
                  <i class="ti ti-arrow-big-down-lines" aria-hidden="true"></i>
                {:else if doc.fileAttached}
                  <i class="ti ti-file-text" aria-hidden="true"></i>
                {:else}
                  <i class="ti ti-folder-open" aria-hidden="true"></i>
                {/if}
              </div>

              <div class="doc-body">
                <div class="doc-top-row">
                  <h3>{docLabel(doc.docType)}</h3>
                  <span class="badge {statusClass(doc.status)}">{statusLabel(doc.status)}</span>
                </div>

                {#if uploading[doc.id]}
                  <div class="upload-progress-container">
                    <div class="progress-bar-track">
                      <div class="progress-bar-fill" style="width: {uploadProgress[doc.id] ?? 0}%"></div>
                    </div>
                    <span class="progress-pct">Uploading — {uploadProgress[doc.id] ?? 0}%</span>
                  </div>
                {:else if dragOverId === doc.id}
                  <p class="doc-note drop">Drop to upload</p>
                {:else if doc.status === 'verified'}
                  <p class="doc-note ok">
                    <i class="ti ti-checkbox" aria-hidden="true"></i> Verified by HR — no action needed.
                  </p>
                {:else if doc.status === 'rejected'}
                  <p class="doc-note err">
                    <i class="ti ti-alert-triangle" aria-hidden="true"></i> Rejected — please re-upload a corrected copy.
                  </p>
                {:else if doc.fileAttached}
                  <p class="doc-note info">
                    {doc.fileName}{#if doc.fileSize} · {fileSize(doc.fileSize)}{/if} — waiting for HR review.
                  </p>
                {:else}
                  <p class="doc-note muted">Not uploaded yet.</p>
                {/if}

                {#if uploadError[doc.id]}
                  <p class="portal-field-error">
                    <i class="ti ti-alert-circle" aria-hidden="true"></i>
                    {uploadError[doc.id]}
                  </p>
                {/if}
              </div>

              {#if !uploading[doc.id] && doc.status !== 'verified'}
                <label class="portal-upload-btn" class:portal-upload-btn-ghost={doc.fileAttached} for="file-{doc.id}">
                  <i class="ti ti-upload" aria-hidden="true"></i>
                  {doc.fileAttached ? 'Replace' : 'Upload'}
                </label>
                <input
                  id="file-{doc.id}"
                  type="file"
                  accept=".pdf,image/*"
                  hidden
                  bind:this={fileInputs[doc.id]}
                  onchange={(e) => handleFileChange(doc.id, e)}
                />
              {/if}
            </div>
          {/each}
        </div>
      </main>

      <footer class="portal-footer">
        <p>
          <i class="ti ti-lock" aria-hidden="true"></i>
          Secure session — link expires in {daysLeft(expiresAt)} day{daysLeft(expiresAt) !== 1 ? 's' : ''}, sign-in
          for {employee.fullNameLatin.split(' ')[0]} times out after 30 min idle.
          <button class="link-btn" onclick={signOut}>Not you? Sign out</button>
        </p>
      </footer>
    </div>
  {/if}
</div>

<style>
  /* ── Shell ── */
  .portal-shell {
    min-height: 100vh;
    background: var(--gray-100);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3rem 1rem;
    color: var(--ink);
    font-family: var(--sans);
  }

  /* ── Simple states (invalid / expired / resuming) ── */
  .simple-state {
    width: 100%;
    max-width: 320px;
    text-align: center;
  }
  .eyebrow {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--amber);
    margin: 0 0 0.75rem;
  }
  .simple-state h1 {
    font-size: 1.4rem;
    font-weight: 800;
    color: var(--ink);
    margin: 0 0 0.5rem;
    line-height: 1.3;
  }
  .hint {
    color: var(--gray-500);
    font-size: 0.9rem;
    margin: 0;
  }

  /* ── Verify screen — one instruction, one input ── */
  .verify-simple {
    width: 100%;
    max-width: 320px;
    text-align: center;
  }
  .mark {
    width: 34px;
    height: 34px;
    margin: 0 auto 1.5rem;
    background: var(--navy);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--mono);
    font-weight: 700;
    font-size: 14px;
    color: #fff;
  }
  .verify-simple h1 {
    font-size: 1.3rem;
    font-weight: 800;
    color: var(--ink);
    line-height: 1.35;
    margin: 0 0 2rem;
    letter-spacing: -0.01em;
  }
  .verify-form-simple {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }
  .verify-form-simple input {
    width: 100%;
    background: #fff;
    border: none;
    border-bottom: 2px solid var(--gray-300);
    border-radius: 0;
    padding: 0.5rem 0;
    font-family: var(--mono);
    font-size: 2.25rem;
    font-weight: 700;
    color: var(--ink);
    letter-spacing: 0.5em;
    text-align: center;
    text-indent: 0.5em; /* re-centers the glyphs against the trailing letter-spacing */
    outline: none;
    transition: border-color 0.15s;
  }
  .verify-form-simple input::placeholder {
    color: var(--gray-300);
    font-weight: 400;
  }
  .verify-form-simple input:focus {
    border-color: var(--blue);
  }
  .verify-form-simple input.error {
    border-color: var(--red);
  }
  @media (prefers-reduced-motion: no-preference) {
    .verify-form-simple input.shake {
      animation: shake 0.3s ease;
    }
  }
  @keyframes shake {
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }
  .caption {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--gray-500);
    margin: 0.25rem 0 0;
  }
  .wrong-id {
    color: var(--red);
    font-size: 13px;
    font-weight: 700;
    margin: 0.25rem 0 0;
  }

  .btn-continue {
    width: 100%;
    margin-top: 1.5rem;
    background: var(--blue);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    padding: 12px 20px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 0.15s;
  }
  .btn-continue:hover:not(:disabled) { background: var(--blue-dark); }
  .btn-continue:disabled { opacity: 0.6; cursor: default; }

  /* ── Spinner ── */
  .spin {
    display: inline-block;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Portal wrapper ── */
  .portal-wrapper {
    width: 100%;
    max-width: 760px;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    align-self: flex-start;
  }

  /* ── Portal header — one band ── */
  .portal-header {
    background: var(--navy);
    color: #ffffff;
    border-radius: var(--radius);
  }
  .header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-logo {
    width: 32px;
    height: 32px;
    background: var(--blue);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 13px;
    font-family: var(--mono);
    color: #fff;
    flex-shrink: 0;
  }
  .brand-copy { display: flex; flex-direction: column; line-height: 1.3; }
  .brand-text { font-weight: 700; font-size: 14px; color: #fff; }
  .crumb {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #7e9cc1;
  }

  .header-right { display: flex; align-items: center; gap: 1rem; }
  .employee-badge { display: flex; align-items: center; gap: 10px; }
  .emp-avatar {
    width: 30px;
    height: 30px;
    background: var(--blue);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }
  .emp-meta { display: flex; flex-direction: column; line-height: 1.3; }
  .emp-meta strong { color: #ffffff; font-size: 12.5px; font-weight: 700; }
  .emp-sub { color: #7e9cc1; font-size: 10.5px; font-family: var(--mono); }

  .signout-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 1px solid #2a4566;
    color: #b9cce2;
    border-radius: var(--radius);
    padding: 7px 12px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .signout-btn:hover { border-color: var(--red); color: #ff9d94; }

  /* ── Main content ── */
  .portal-main {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .section-title h2 {
    color: var(--navy);
    font-size: 1.15rem;
    font-weight: 800;
    margin: 0 0 0.2rem;
  }
  .section-title p {
    color: var(--gray-700);
    font-size: 0.82rem;
    margin: 0;
  }

  /* ── Progress ── */
  .progress-summary {
    background: #ffffff;
    border: 1px solid var(--gray-300);
    border-radius: var(--radius);
    padding: 0.9rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    color: var(--gray-700);
    font-size: 12.5px;
    font-weight: 700;
  }
  .progress-count { color: var(--navy); font-weight: 800; font-family: var(--mono); }
  .progress-bar-track {
    height: 6px;
    background: var(--gray-200);
    border-radius: 3px;
    overflow: hidden;
  }
  .progress-bar-fill {
    height: 100%;
    background: var(--green);
    border-radius: 3px;
    transition: width 0.4s ease;
  }

  /* ── Document list — rows double as drop targets ── */
  .doc-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .portal-doc-row {
    background: #ffffff;
    border: 1px solid var(--gray-300);
    border-radius: var(--radius);
    padding: 0.9rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    transition: border-color 0.15s, background 0.15s;
  }
  .portal-doc-row.doc-verified { border-color: var(--green); background: #f6fbf9; }
  .portal-doc-row.doc-rejected { border-color: var(--red); background: #fffcfc; }
  .portal-doc-row.doc-dragover {
    border-color: var(--blue);
    background: #eaf1fb;
    border-style: dashed;
  }

  .doc-icon {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--gray-100);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.15rem;
    color: var(--gray-500);
    flex-shrink: 0;
  }
  .portal-doc-row.doc-verified .doc-icon { background: #e1f5ee; color: var(--green); }
  .portal-doc-row.doc-rejected .doc-icon { background: #fdf2f2; color: var(--red); }
  .portal-doc-row.doc-dragover .doc-icon { background: #dbe9fa; color: var(--blue); }

  .doc-body { flex: 1; min-width: 0; }
  .doc-top-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .doc-body h3 { color: var(--navy); font-size: 13.5px; font-weight: 700; margin: 0; }

  .doc-note {
    font-size: 11.5px;
    margin: 0.25rem 0 0;
    line-height: 1.4;
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
    color: var(--gray-500);
  }
  .doc-note.muted { font-weight: 500; color: var(--gray-500); }
  .doc-note.ok { color: var(--green); }
  .doc-note.err { color: var(--red); }
  .doc-note.info { color: var(--blue-dark); font-weight: 500; }
  .doc-note.drop { color: var(--blue); font-weight: 700; }

  /* ── Upload button ── */
  .portal-upload-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--blue);
    color: #ffffff;
    border: none;
    border-radius: var(--radius);
    padding: 8px 14px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
    user-select: none;
  }
  .portal-upload-btn:hover { background: var(--blue-dark); }
  .portal-upload-btn-ghost {
    background: transparent;
    border: 1px solid var(--gray-300);
    color: var(--gray-700);
  }
  .portal-upload-btn-ghost:hover {
    border-color: var(--blue);
    color: var(--blue);
    background: rgba(21, 101, 192, 0.04);
  }

  /* ── Badges ── */
  .badge {
    flex-shrink: 0;
    padding: 3px 8px;
    border-radius: 20px;
    font-size: 9px;
    font-weight: 700;
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }
  .badge-warn { background: #fff7e6; color: #7a4b12; border: 1px solid rgba(183, 121, 31, 0.25); }
  .badge-info { background: #eaf1fb; color: var(--blue-dark); border: 1px solid rgba(21, 101, 192, 0.25); }
  .badge-ok   { background: #e1f5ee; color: #085041; border: 1px solid rgba(26, 127, 78, 0.25); }
  .badge-err  { background: #fdf2f2; color: var(--red); border: 1px solid rgba(192, 54, 44, 0.25); }

  /* ── Shared field error ── */
  .portal-field-error {
    color: var(--red);
    font-size: 11px;
    font-weight: 600;
    margin: 0.25rem 0 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* ── Upload progress (per row) ── */
  .upload-progress-container {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 4px;
  }
  .upload-progress-container .progress-bar-track {
    height: 5px;
    background: var(--gray-200);
    border-radius: 3px;
    overflow: hidden;
  }
  .upload-progress-container .progress-bar-fill {
    height: 100%;
    background: var(--blue);
    border-radius: 3px;
    transition: width 0.15s ease-out;
  }
  .upload-progress-container .progress-pct {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    color: var(--gray-500);
  }

  /* ── Footer ── */
  .portal-footer {
    text-align: center;
    color: var(--gray-500);
    font-size: 11px;
    padding-bottom: 0.5rem;
  }
  .portal-footer p { display: flex; align-items: center; justify-content: center; gap: 5px; flex-wrap: wrap; margin: 0; }
  .link-btn {
    background: none;
    border: none;
    padding: 0;
    color: var(--blue);
    font-size: 11px;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
  }

  @media (max-width: 560px) {
    .header-inner { flex-direction: column; align-items: flex-start; }
    .header-right { width: 100%; justify-content: space-between; }
    .portal-doc-row { flex-wrap: wrap; }
    .portal-upload-btn { margin-left: auto; }
  }
</style>
