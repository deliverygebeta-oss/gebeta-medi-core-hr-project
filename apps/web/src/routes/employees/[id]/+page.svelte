<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { auth } from '$lib/auth.svelte';
	import {
		deleteEmployee,
		downloadDocumentFile,
		fetchEmployee,
		patchDocument,
		updateEmployee,
		uploadDocumentFile,
		type EmployeeDetail
	} from '$lib/api';
	import { departments, employmentTypes, jobGrades, roleLabels, type Role } from '$lib/constants';
	import { showToast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n';

	let employee = $state<EmployeeDetail | null>(null);
	let error = $state('');
	let uploadingDocId = $state<number | null>(null);
	let changingDocStatusId = $state<number | null>(null);
	let confirmingDelete = $state(false);
	let deleting = $state(false);

	// Edit modal
	let editOpen = $state(false);
	let saving = $state(false);
	let edit = $state({
		fullNameLatin: '',
		fullNameAmharic: '',
		phone: '',
		email: '',
		employmentType: '',
		department: '',
		jobGrade: '',
		employmentStatus: 'active',
		baseSalaryEtb: '',
		bankName: '',
		bankAccountNumber: ''
	});

	$effect(() => {
		if (!auth.officer) return;
		const id = page.params.id;
		if (!id) return;
		fetchEmployee(id)
			.then((e) => {
				employee = e;
				if (page.url.searchParams.get('edit') === '1') openEdit();
			})
			.catch((err) => (error = err instanceof Error ? err.message : 'Failed to load'));
	});

	function openEdit() {
		if (!employee) return;
		edit = {
			fullNameLatin: employee.fullNameLatin,
			fullNameAmharic: employee.fullNameAmharic ?? '',
			phone: employee.phone,
			email: employee.email ?? '',
			employmentType: employee.employmentType,
			department: employee.department,
			jobGrade: employee.jobGrade ?? '',
			employmentStatus: employee.employmentStatus,
			baseSalaryEtb: employee.contract?.baseSalaryEtb ?? '',
			bankName: employee.contract?.bankName ?? '',
			bankAccountNumber: employee.contract?.bankAccountNumber ?? ''
		};
		editOpen = true;
	}

	async function saveEdit() {
		if (!employee) return;
		if (!edit.fullNameLatin.trim() || !edit.phone.trim()) {
			showToast('Name and phone are required', 'Fill both fields before saving', 'error');
			return;
		}
		saving = true;
		try {
			employee = await updateEmployee(employee.id, {
				fullNameLatin: edit.fullNameLatin,
				fullNameAmharic: edit.fullNameAmharic,
				phone: edit.phone,
				email: edit.email,
				employmentType: edit.employmentType,
				department: edit.department,
				jobGrade: edit.jobGrade,
				employmentStatus: edit.employmentStatus,
				contract: {
					baseSalaryEtb: Number(edit.baseSalaryEtb) || undefined,
					bankName: edit.bankName || undefined,
					bankAccountNumber: edit.bankAccountNumber || undefined
				}
			});
			editOpen = false;
			showToast('Changes saved', employee.employeeCode + ' updated', 'success');
		} catch (err) {
			showToast('Save failed', err instanceof Error ? err.message : String(err), 'error');
		} finally {
			saving = false;
		}
	}

	async function confirmDelete() {
		if (!employee) return;
		deleting = true;
		try {
			const res = await deleteEmployee(employee.id);
			showToast('Employee deleted', res.employeeCode + ' and their documents were removed', 'success');
			goto('/');
		} catch (err) {
			showToast('Delete failed', err instanceof Error ? err.message : String(err), 'error');
			deleting = false;
		}
	}

	async function updateDocStatus(docId: number, status: 'pending' | 'received' | 'verified') {
		if (!employee) return;
		changingDocStatusId = docId;
		try {
			const res = await patchDocument(employee.id, docId, { status });
			const doc = employee.documents.find((d) => d.id === docId);
			if (doc) doc.status = res.document.status;
			const before = employee.onboardingStatus;
			employee.onboardingStatus = res.onboardingStatus;
			if (before !== 'completed' && res.onboardingStatus === 'completed') {
				showToast('Onboarding completed 🎉', 'All documents verified for ' + employee.fullNameLatin, 'success');
			} else {
				showToast('Document updated', res.document.docType + ' — ' + res.document.status, 'success');
			}
		} catch (err) {
			showToast('Update failed', err instanceof Error ? err.message : String(err), 'error');
		} finally {
			changingDocStatusId = null;
		}
	}

	async function onFilePicked(docId: number, input: HTMLInputElement) {
		const file = input.files?.[0];
		input.value = '';
		if (!file || !employee) return;
		uploadingDocId = docId;
		try {
			const updated = await uploadDocumentFile(employee.id, docId, file);
			const doc = employee.documents.find((d) => d.id === docId);
			if (doc) Object.assign(doc, updated);
			showToast('File uploaded', updated.fileName + ' stored in HR-EMP-FILE', 'success');
		} catch (err) {
			showToast('Upload failed', err instanceof Error ? err.message : String(err), 'error');
		} finally {
			uploadingDocId = null;
		}
	}

	async function download(docId: number, fileName: string) {
		if (!employee) return;
		try {
			await downloadDocumentFile(employee.id, docId, fileName);
		} catch (err) {
			showToast('Download failed', err instanceof Error ? err.message : String(err), 'error');
		}
	}

	const statusLabels: Record<string, string> = $derived({
		completed: t('list.statusCompleted'),
		docs_pending: t('list.statusDocsPending'),
		in_progress: t('list.statusInProgress')
	});

	const money = (v: string | undefined | null) => (v ? 'ETB ' + Number(v).toLocaleString() : '—');
	const kb = (n: number | null) => (n ? (n / 1024).toFixed(0) + ' KB' : '');
</script>

<AppShell title={t('detail.pageTitle')} sub={employee?.employeeCode ?? ''}>
	{#snippet actions()}
		{#if employee}
			<button class="btn-ghost" onclick={openEdit}>
				<i class="ti ti-pencil" aria-hidden="true"></i> {t('detail.editProfile')}
			</button>
			<button class="btn-ghost" style="color:var(--red);border-color:var(--red);" onclick={() => (confirmingDelete = true)}>
				<i class="ti ti-trash" aria-hidden="true"></i> {t('detail.delete')}
			</button>
		{/if}
	{/snippet}

	{#if error}
		<div class="login-error" style="max-width:480px;">{error}</div>
		<a class="back-link" href="/"><i class="ti ti-arrow-left"></i> {t('detail.backToEmployees')}</a>
	{:else if !employee}
		<div class="skel-line" style="width:140px;height:11px;margin-bottom:14px;"></div>

		<div class="detail-head">
			<div style="flex:1;">
				<div class="skel-line lg" style="width:240px;margin-bottom:10px;"></div>
				<div class="skel-line" style="width:320px;height:11px;"></div>
			</div>
			<div class="skel-pill" style="width:112px;"></div>
		</div>

		<div class="summary-grid">
			<div class="summary-card">
				<div class="skel-line" style="width:100px;height:11px;margin-bottom:18px;"></div>
				<div class="skel-stack">
					{#each Array(9) as _, i (i)}
						<div class="skel-row-pair">
							<div class="skel-line" style="width:110px;"></div>
							<div class="skel-line" style="width:{120 + ((i * 37) % 90)}px;"></div>
						</div>
					{/each}
				</div>
			</div>
			<div class="summary-card">
				<div class="skel-line" style="width:130px;height:11px;margin-bottom:18px;"></div>
				<div class="skel-stack">
					{#each Array(8) as _, i (i)}
						<div class="skel-row-pair">
							<div class="skel-line" style="width:100px;"></div>
							<div class="skel-line" style="width:{110 + ((i * 41) % 80)}px;"></div>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<div class="card" style="padding:24px 28px;">
			<div class="section-head">
				<div class="skel-line" style="width:220px;"></div>
				<div class="skel-line" style="width:90px;"></div>
			</div>
			{#each Array(5) as _, i (i)}
				<div class="doc-row">
					<div style="flex:1;">
						<div class="skel-line" style="width:{160 + ((i * 29) % 70)}px;margin-bottom:8px;"></div>
						<div class="skel-line" style="width:{200 + ((i * 23) % 100)}px;height:11px;"></div>
					</div>
					<div class="skel-block" style="width:150px;height:34px;"></div>
					<div class="skel-block" style="width:130px;height:34px;"></div>
				</div>
			{/each}
		</div>
	{:else}
		<a class="back-link" href="/"><i class="ti ti-arrow-left"></i> {t('detail.backToEmployees')}</a>

		<div class="detail-head" style="box-shadow: 0 4px 12px rgba(0,0,0,0.03); border-color: var(--gray-200);">
			<div>
				<div class="dh-name">{employee.fullNameLatin}</div>
				<div class="dh-meta">
					{employee.employeeCode} · {roleLabels[employee.role as Role] ?? employee.role} ·
					{employee.department}
					{#if employee.registrar}
						{t('detail.registeredBy', { name: employee.registrar.fullName })}{/if}
				</div>
			</div>
			<span class="ob-badge {employee.onboardingStatus}" style="font-size:11px;padding:7px 14px;box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
				<span class="dot"></span>{statusLabels[employee.onboardingStatus]}
			</span>
		</div>

		<div class="summary-grid">
			<div class="summary-card" style="box-shadow: 0 4px 12px rgba(0,0,0,0.03); border-color: var(--gray-200);">
				<div class="sc-head">{t('detail.profileDetails')}</div>
				<div class="summary-row"><span class="sk">{t('detail.fAmharicName')}</span><span class="sv">{employee.fullNameAmharic ?? '—'}</span></div>
				<div class="summary-row"><span class="sk">{t('detail.fNationalId')}</span><span class="sv">{employee.nationalId}</span></div>
				<div class="summary-row"><span class="sk">{t('detail.fDob')}</span><span class="sv">{employee.dob}</span></div>
				<div class="summary-row"><span class="sk">{t('detail.fPhone')}</span><span class="sv">{employee.phone}</span></div>
				<div class="summary-row"><span class="sk">{t('detail.fEmail')}</span><span class="sv" style="text-transform: none; font-family: var(--mono); font-size: 12px;">{employee.email ?? '—'}</span></div>
				<div class="summary-row"><span class="sk">{t('detail.fEmploymentType')}</span><span class="sv">{employee.employmentType}</span></div>
				<div class="summary-row"><span class="sk">{t('detail.fEmploymentStatus')}</span><span class="sv" style="text-transform: capitalize;">{employee.employmentStatus.replace('_', ' ')}</span></div>
				<div class="summary-row"><span class="sk">{t('detail.fJobGrade')}</span><span class="sv">{employee.jobGrade ?? '—'}</span></div>
				<div class="summary-row"><span class="sk">{t('detail.fQualification')}</span><span class="sv" style="max-width: 60%;">{employee.eduQualification ?? '—'}</span></div>
			</div>

			<div class="summary-card" style="box-shadow: 0 4px 12px rgba(0,0,0,0.03); border-color: var(--gray-200);">
				<div class="sc-head">{t('detail.contractPay')}</div>
				{#if employee.contract}
					<div class="summary-row"><span class="sk">{t('detail.fContract')}</span><span class="sv">{employee.contract.contractType === 'fixed' ? t('wizard.contractFixed') : t('wizard.contractPermanent')}</span></div>
					<div class="summary-row"><span class="sk">{t('detail.fHireDate')}</span><span class="sv">{employee.contract.hireDate}</span></div>
					<div class="summary-row"><span class="sk">{t('detail.fProbationEnds')}</span><span class="sv">{employee.contract.probationEndDate ?? '—'}</span></div>
					<div class="summary-row"><span class="sk">{t('detail.fBaseSalary')}</span><span class="sv" style="color: var(--navy); font-weight: 700;">{money(employee.contract.baseSalaryEtb)}</span></div>
					<div class="summary-row"><span class="sk">{t('detail.fRiskAllowance')}</span><span class="sv">{employee.contract.riskAllowance ?? '—'}</span></div>
					<div class="summary-row"><span class="sk">{t('detail.fBank')}</span><span class="sv">{employee.contract.bankName}</span></div>
					<div class="summary-row"><span class="sk">{t('detail.fAccountNo')}</span><span class="sv" style="font-family: var(--mono); font-size: 12px;">{employee.contract.bankAccountNumber}</span></div>
					<div class="summary-row"><span class="sk">{t('detail.fPensionNo')}</span><span class="sv" style="font-family: var(--mono); font-size: 12px;">{employee.contract.pensionNumber}</span></div>
					<div class="summary-row"><span class="sk">{t('detail.fTin')}</span><span class="sv" style="font-family: var(--mono); font-size: 12px;">{employee.contract.tinNumber}</span></div>
				{/if}
				{#if employee.emergencyContacts[0]}
					{@const em = employee.emergencyContacts[0]}
					<div class="sc-head" style="margin-top:22px;">{t('detail.emergencyContact')}</div>
					<div class="summary-row"><span class="sk">{t('detail.fContactName')}</span><span class="sv">{em.name}</span></div>
					<div class="summary-row"><span class="sk">{t('detail.fRelationship')}</span><span class="sv">{em.relationship}</span></div>
					<div class="summary-row"><span class="sk">{t('detail.fPhone')}</span><span class="sv">{em.phone}</span></div>
				{/if}
			</div>
		</div>

		<div class="card" style="padding:24px 28px; box-shadow: 0 4px 12px rgba(0,0,0,0.03); border-color: var(--gray-200);">
			<div class="section-head">
				<span class="section-label">{t('detail.documentVerification')}</span>
				<span class="section-num">
					{t('detail.verifiedCount', { verified: employee.documents.filter((d) => d.status === 'verified').length, total: employee.documents.length })}
				</span>
			</div>

			{#if employee.onboardingStatus !== 'completed'}
				<div class="conditional-note amber" style="display:block;margin-bottom:18px;">
					<i class="ti ti-alert-triangle" aria-hidden="true" style="vertical-align:-2px;margin-right:4px;"></i>
					{t('detail.incompleteNote')}
				</div>
			{/if}

			{#each employee.documents as doc (doc.id)}
				<div class="doc-row" style="padding: 18px 0; border-bottom: 1px solid var(--gray-200);">
					<div>
						<div class="doc-name">{doc.docType}</div>
						<div class="doc-sub">
							{#if doc.fileName}
								<button class="file-dl" onclick={() => download(doc.id, doc.fileName ?? 'document')} title="Download {doc.fileName}">
									<i class="ti ti-download" aria-hidden="true" style="margin-right: 2px;"></i>
									{doc.fileName} <span style="color: var(--gray-500); font-weight: normal; margin-left: 4px;">({kb(doc.fileSize)})</span>
								</button>
							{:else}
								{t('detail.noFileYet')}
							{/if}
						</div>
					</div>
					<div class="doc-status" style="display: flex; align-items: center; gap: 8px;">
						{#if changingDocStatusId === doc.id}
							<span class="activity-spinner" style="margin-right: 4px;" title={t('detail.savingStatus')}></span>
						{/if}
						<select
							class="status-select status-{doc.status}"
							value={doc.status}
							disabled={changingDocStatusId === doc.id}
							onchange={(e) => updateDocStatus(doc.id, e.currentTarget.value as 'pending' | 'received' | 'verified')}
							style="min-width: 120px; font-weight: bold;"
						>
							<option value="pending">{t('detail.docStatusPending')}</option>
							<option value="received">{t('detail.docStatusReceived')}</option>
							<option value="verified">{t('detail.docStatusVerified')}</option>
						</select>
					</div>
					<div class="file-cell">
						<input
							type="file"
							accept=".pdf,.jpg,.jpeg,.png,.webp"
							style="display:none;"
							id="file-{doc.id}"
							onchange={(e) => onFilePicked(doc.id, e.currentTarget)}
						/>
						<button
							class="upload-btn"
							class:uploaded={doc.fileAttached}
							disabled={uploadingDocId === doc.id}
							onclick={() => document.getElementById(`file-${doc.id}`)?.click()}
							style="transition: all 0.15s ease;"
						>
							{#if uploadingDocId === doc.id}
								<i class="ti ti-loader-2 spin" aria-hidden="true"></i> {t('detail.uploading')}
							{:else if doc.fileName}
								<i class="ti ti-refresh" aria-hidden="true"></i> {t('detail.replaceFile')}
							{:else}
								<i class="ti ti-upload" aria-hidden="true"></i> {t('detail.uploadFile')}
							{/if}
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</AppShell>

{#if editOpen && employee}
	<Modal title={t('detail.editTitle')} sub={employee.employeeCode} onClose={() => (editOpen = false)}>
		<div class="card" style="padding:24px 28px;">
			<div class="grid2" style="margin-bottom:20px;">
				<div class="field">
					<label for="e-name">{t('detail.fFullNameLatin')}<span class="req">*</span></label>
					<input type="text" id="e-name" bind:value={edit.fullNameLatin} />
				</div>
				<div class="field">
					<label for="e-amh">{t('detail.fAmharicName')}</label>
					<input type="text" id="e-amh" bind:value={edit.fullNameAmharic} />
				</div>
				<div class="field">
					<label for="e-phone">{t('detail.fPhone')}<span class="req">*</span></label>
					<input type="tel" id="e-phone" bind:value={edit.phone} />
				</div>
				<div class="field">
					<label for="e-email">{t('detail.fEmail')}</label>
					<input type="email" id="e-email" bind:value={edit.email} />
				</div>
				<div class="field">
					<label for="e-emptype">{t('detail.fEmploymentType')}</label>
					<select id="e-emptype" bind:value={edit.employmentType}>
						{#each employmentTypes as et (et)}<option>{et}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="e-dept">{t('detail.fDepartment')}</label>
					<select id="e-dept" bind:value={edit.department}>
						{#each departments as d (d)}<option>{d}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="e-grade">{t('detail.fJobGrade')}</label>
					<select id="e-grade" bind:value={edit.jobGrade}>
						<option value="">{t('detail.selectGrade')}</option>
						{#each jobGrades as g (g)}<option>{g}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="e-status">{t('detail.fEmploymentStatus')}</label>
					<select id="e-status" bind:value={edit.employmentStatus}>
						<option value="active">{t('wizard.statusActive')}</option>
						<option value="on_leave">{t('wizard.statusOnLeave')}</option>
						<option value="suspended">{t('wizard.statusSuspended')}</option>
						<option value="terminated">{t('wizard.statusTerminated')}</option>
						<option value="retired">{t('wizard.statusRetired')}</option>
						<option value="deceased">{t('wizard.statusDeceased')}</option>
					</select>
				</div>
			</div>

			<div class="section-head" style="margin-top: 28px;">
				<span class="section-label" style="color:var(--gray-700);">{t('detail.payBank')}</span>
			</div>
			<div class="grid3">
				<div class="field">
					<label for="e-salary">{t('detail.fBaseSalary')} (ETB)</label>
					<input type="number" id="e-salary" bind:value={edit.baseSalaryEtb} />
				</div>
				<div class="field">
					<label for="e-bank">{t('detail.fBank')}</label>
					<input type="text" id="e-bank" bind:value={edit.bankName} />
				</div>
				<div class="field">
					<label for="e-acct">{t('detail.fAccountNo')}</label>
					<input type="text" id="e-acct" bind:value={edit.bankAccountNumber} />
				</div>
			</div>

			<div class="confirm-actions" style="margin-top: 28px; border-top: 1px solid var(--gray-200); padding-top: 20px;">
				<button class="btn-secondary" onclick={() => (editOpen = false)}>{t('common.cancel')}</button>
				<button class="btn-primary" onclick={saveEdit} disabled={saving}>
					{#if saving}<i class="ti ti-loader-2 spin" aria-hidden="true"></i> {t('detail.saving')}{:else}<i class="ti ti-device-floppy" aria-hidden="true"></i> {t('detail.saveChanges')}{/if}
				</button>
			</div>
		</div>
	</Modal>
{/if}

{#if confirmingDelete && employee}
	<Modal title={t('list.deleteTitle')} sub={employee.employeeCode} size="sm" onClose={() => (confirmingDelete = false)}>
		<div class="confirm-body">
			{t('detail.deleteConfirmSimple', { name: employee.fullNameLatin, code: employee.employeeCode })}
		</div>
		<div class="confirm-warn">
			<i class="ti ti-alert-triangle" aria-hidden="true" style="vertical-align:-2px;margin-right:4px;"></i>
			{t('list.deleteWarning')}
		</div>
		<div class="confirm-actions">
			<button class="btn-secondary" onclick={() => (confirmingDelete = false)}>{t('common.cancel')}</button>
			<button class="btn-danger" onclick={confirmDelete} disabled={deleting}>
				{#if deleting}<i class="ti ti-loader-2 spin" aria-hidden="true"></i> {t('list.deleting')}{:else}<i class="ti ti-trash" aria-hidden="true"></i> {t('list.deletePermanently')}{/if}
			</button>
		</div>
	</Modal>
{/if}
