<script lang="ts">
	import { goto } from '$app/navigation';
	import AppShell from '$lib/components/AppShell.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import OnboardingWizard from '$lib/components/OnboardingWizard.svelte';
	import { auth } from '$lib/auth.svelte';
	import {
		deleteEmployee,
		fetchEmployees,
		fetchStats,
		generateUploadLink,
		type EmployeeSummary,
		type Stats,
		type UploadLinkMeta
	} from '$lib/api';
	import { roleLabels, departments, type Role } from '$lib/constants';
	import { showToast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n';

	let employees = $state<EmployeeSummary[]>([]);
	let stats = $state<Stats>({ total: 0, completed: 0, docsPending: 0, inProgress: 0 });
	let loading = $state(true);
	let refreshing = $state(false);
	let wizardOpen = $state(false);
	let deleteTarget = $state<EmployeeSummary | null>(null);
	let deleting = $state(false);

	// Upload link modal
	let linkTarget = $state<EmployeeSummary | null>(null);
	let linkData = $state<UploadLinkMeta | null>(null);
	let linkLoading = $state(false);
	let linkCopied = $state(false);

	// Enterprise States
	let searchQuery = $state('');
	let tableDensity = $state<'compact' | 'comfortable' | 'spacious'>('comfortable');
	let selectedRole = $state<string>('all');
	let selectedDepartment = $state<string>('all');
	let selectedStatus = $state<string>('all');
	let sortKey = $state<string>('id');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let currentPage = $state(1);
	let pageSize = $state<number | 'all'>(10);

	async function refresh(showFeedback = false) {
		if (!auth.officer) return;
		refreshing = true;
		try {
			[employees, stats] = await Promise.all([fetchEmployees(), fetchStats()]);
			if (showFeedback) {
				showToast('Data reloaded', employees.length + ' records fetched from the database', 'success');
			}
		} catch {
			/* auth errors handled by the api layer */
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	$effect(() => {
		refresh();
	});

	async function confirmDelete() {
		if (!deleteTarget) return;
		deleting = true;
		try {
			const res = await deleteEmployee(deleteTarget.id);
			showToast('Employee deleted', res.employeeCode + ' and their documents were removed', 'success');
			deleteTarget = null;
			await refresh();
		} catch (err) {
			showToast('Delete failed', err instanceof Error ? err.message : String(err), 'error');
		} finally {
			deleting = false;
		}
	}

	async function generateLink(emp: EmployeeSummary) {
		linkTarget = emp;
		linkData = null;
		linkCopied = false;
		linkLoading = true;
		try {
			const res = await generateUploadLink(emp.id);
			linkData = res;
		} catch (err) {
			showToast('Link generation failed', err instanceof Error ? err.message : String(err), 'error');
			linkTarget = null;
		} finally {
			linkLoading = false;
		}
	}

	function copyLink() {
		if (!linkData) return;
		const full = `${window.location.origin}${linkData.url}`;
		navigator.clipboard.writeText(full).then(() => {
			linkCopied = true;
			setTimeout(() => (linkCopied = false), 2500);
		});
	}

	// Filter Logic
	const filteredEmployees = $derived.by(() => {
		let list = employees;
		
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase().trim();
			list = list.filter((e) =>
				e.fullNameLatin.toLowerCase().includes(query) ||
				e.employeeCode.toLowerCase().includes(query) ||
				e.department.toLowerCase().includes(query) ||
				(roleLabels[e.role as Role] ?? e.role).toLowerCase().includes(query)
			);
		}
		if (selectedRole !== 'all') {
			list = list.filter((e) => e.role === selectedRole);
		}
		if (selectedDepartment !== 'all') {
			list = list.filter((e) => e.department === selectedDepartment);
		}
		if (selectedStatus !== 'all') {
			list = list.filter((e) => e.onboardingStatus === selectedStatus);
		}
		return list;
	});

	// Sorting Logic
	const sortedEmployees = $derived.by(() => {
		const list = [...filteredEmployees];
		list.sort((a, b) => {
			let valA: any = a[sortKey as keyof EmployeeSummary];
			let valB: any = b[sortKey as keyof EmployeeSummary];

			if (sortKey === 'role') {
				valA = roleLabels[a.role as Role] ?? a.role;
				valB = roleLabels[b.role as Role] ?? b.role;
			} else if (sortKey === 'docsProgress') {
				valA = a.docsTotal ? a.docsVerified / a.docsTotal : 0;
				valB = b.docsTotal ? b.docsVerified / b.docsTotal : 0;
			}

			if (valA === undefined || valA === null) return 1;
			if (valB === undefined || valB === null) return -1;

			if (typeof valA === 'string') {
				return sortDirection === 'asc'
					? valA.localeCompare(valB)
					: valB.localeCompare(valA);
			} else {
				return sortDirection === 'asc' ? valA - valB : valB - valA;
			}
		});
		return list;
	});

	// Pagination Logic
	const paginatedEmployees = $derived.by(() => {
		if (pageSize === 'all') return sortedEmployees;
		const start = (currentPage - 1) * pageSize;
		return sortedEmployees.slice(start, start + pageSize);
	});

	const totalPages = $derived(
		pageSize === 'all' ? 1 : Math.max(1, Math.ceil(sortedEmployees.length / pageSize))
	);

	// Reset page on filter adjustments
	$effect(() => {
		searchQuery;
		selectedRole;
		selectedDepartment;
		selectedStatus;
		currentPage = 1;
	});

	function toggleSort(key: string) {
		if (sortKey === key) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDirection = 'asc';
		}
	}

	function exportToCSV() {
		if (sortedEmployees.length === 0) {
			showToast(t('list.noRecordsToExport'), t('list.applyFiltersFirst'), 'info');
			return;
		}
		const headers = ['Employee ID', 'Name', 'Role', 'Department', 'Employment Status', 'Onboarding Status', 'Progress', 'Registered Date'];
		const rows = sortedEmployees.map((e) => [
			e.employeeCode,
			`"${e.fullNameLatin.replace(/"/g, '""')}"`,
			`"${roleLabels[e.role as Role] ?? e.role}"`,
			`"${e.department}"`,
			e.employmentStatus,
			e.onboardingStatus,
			`"${e.docsVerified}/${e.docsTotal}"`,
			e.createdAt
		]);
		const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.setAttribute('href', url);
		link.setAttribute('download', `MediCore_Onboarding_${new Date().toISOString().split('T')[0]}.csv`);
		link.style.visibility = 'hidden';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		showToast(t('list.csvExported'), t('list.rowsWritten', { n: sortedEmployees.length }), 'success');
	}

	const statusLabels: Record<string, string> = $derived({
		completed: t('list.statusCompleted'),
		docs_pending: t('list.statusDocsPending'),
		in_progress: t('list.statusInProgress')
	});

	function fmtDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<AppShell
	title={t('list.title')}
	sub={auth.officer?.role === 'admin' ? t('list.subRegisteredByAll') : t('list.subRegisteredByYou')}
>
	{#snippet actions()}
		<button
			class="btn-ghost"
			onclick={() => refresh(true)}
			disabled={refreshing}
			title="Reload all data from the database"
		>
			<i class="ti ti-refresh" class:spin={refreshing} aria-hidden="true"></i>
			{refreshing ? t('list.reloading') : t('list.reloadData')}
		</button>
		<button class="btn-pill" onclick={() => (wizardOpen = true)}>
			<i class="ti ti-plus" aria-hidden="true" style="margin-right:4px;"></i> {t('list.startOnboarding')}
		</button>
	{/snippet}

	<div class="list-toolbar" style="flex-direction: column; align-items: stretch; gap: 16px; margin-bottom: 20px;">
		<!-- Row 1: Left Stats Chips & Right Actions (CSV, Reload, etc) -->
		<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
			<div class="count-chips">
				<button
					class="count-chip"
					class:active-demo={selectedStatus === 'all'}
					onclick={() => selectedStatus = 'all'}
					style="cursor: pointer; background: var(--white);"
				>
					<b>{stats.total}</b> {t('list.registered')}
				</button>
				<button
					class="count-chip"
					class:active-demo={selectedStatus === 'completed'}
					onclick={() => selectedStatus = 'completed'}
					style="cursor: pointer; background: var(--white);"
				>
					<span class="dot" style="background:var(--green);"></span><b>{stats.completed}</b> {t('list.completed')}
				</button>
				<button
					class="count-chip"
					class:active-demo={selectedStatus === 'docs_pending'}
					onclick={() => selectedStatus = 'docs_pending'}
					style="cursor: pointer; background: var(--white);"
				>
					<span class="dot" style="background:var(--amber);"></span><b>{stats.docsPending}</b> {t('list.docsPending')}
				</button>
				<button
					class="count-chip"
					class:active-demo={selectedStatus === 'in_progress'}
					onclick={() => selectedStatus = 'in_progress'}
					style="cursor: pointer; background: var(--white);"
				>
					<span class="dot" style="background:var(--blue);"></span><b>{stats.inProgress}</b> {t('list.inProgress')}
				</button>
			</div>

			<div style="display: flex; gap: 8px; align-items: center;">
				<button class="btn-export" onclick={exportToCSV} title="Export filtered records as CSV">
					<i class="ti ti-download" aria-hidden="true"></i> {t('list.exportCsv')}
				</button>
			</div>
		</div>

		<!-- Row 2: Search, Filters, Density and Limit Settings -->
		<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; border-top: 1px solid var(--gray-200); padding-top: 16px;">
			<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1;">
				<!-- Search -->
				<div class="search-wrap">
					<i class="ti ti-search" aria-hidden="true"></i>
					<input
						type="text"
						placeholder={t('list.searchPlaceholder')}
						bind:value={searchQuery}
						style="width: 260px;"
					/>
				</div>

				<!-- Department Select -->
				<select class="enterprise-select" bind:value={selectedDepartment}>
					<option value="all">{t('list.allDepartments')}</option>
					{#each departments as d (d)}
						<option value={d}>{d}</option>
					{/each}
				</select>

				<!-- Role Select -->
				<select class="enterprise-select" bind:value={selectedRole}>
					<option value="all">{t('list.allRoles')}</option>
					{#each Object.entries(roleLabels) as [val, label] (val)}
						<option value={val}>{label}</option>
					{/each}
				</select>
			</div>

			<!-- Table Controls -->
			<div class="search-control-group">
				<!-- Density Control -->
				<div style="display: flex; align-items: center; gap: 6px;">
					<span style="font-size: 10px; font-family: var(--mono); color: var(--gray-500); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">{t('list.density')}</span>
					<div class="density-group">
						<button
							class="density-btn"
							class:active={tableDensity === 'compact'}
							onclick={() => tableDensity = 'compact'}
							title={t('list.densityCompact')}
						>
							C
						</button>
						<button
							class="density-btn"
							class:active={tableDensity === 'comfortable'}
							onclick={() => tableDensity = 'comfortable'}
							title={t('list.densityComfortable')}
						>
							M
						</button>
						<button
							class="density-btn"
							class:active={tableDensity === 'spacious'}
							onclick={() => tableDensity = 'spacious'}
							title={t('list.densitySpacious')}
						>
							S
						</button>
					</div>
				</div>

				<!-- Page Size -->
				<div style="display: flex; align-items: center; gap: 6px;">
					<span style="font-size: 10px; font-family: var(--mono); color: var(--gray-500); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">{t('list.show')}</span>
					<select class="enterprise-select" bind:value={pageSize} style="height: 36px; padding-top: 4px; padding-bottom: 4px;">
						<option value={5}>5</option>
						<option value={10}>10</option>
						<option value={25}>25</option>
						<option value={50}>50</option>
						<option value="all">All</option>
					</select>
				</div>
			</div>
		</div>
	</div>

	<div class="submissions-table-wrap" style="margin-top:0;">
		<div class="submissions-head">
			<span class="sh-ttl">{t('list.registerTitle')}</span>
			<span class="sh-count">
				{t('list.showingRecords', { shown: paginatedEmployees.length, total: sortedEmployees.length, plural: sortedEmployees.length === 1 ? '' : 's' })}
			</span>
		</div>
		{#if loading}
			<table class="sub-table density-comfortable">
				<thead>
					<tr>
						<th>{t('list.colEmployeeId')}</th>
						<th>{t('list.colName')}</th>
						<th>{t('list.colRole')}</th>
						<th>{t('list.colDepartment')}</th>
						<th>{t('list.colDocuments')}</th>
						<th>{t('list.colOnboarding')}</th>
						<th>{t('list.colRegistered')}</th>
						<th style="text-align:right;">{t('list.colActions')}</th>
					</tr>
				</thead>
				<tbody>
					{#each Array(5) as _, idx}
						<tr class="skeleton-row">
							<td><div class="skeleton-cell" style="width: 80px;"></div></td>
							<td><div class="skeleton-cell" style="width: 140px;"></div></td>
							<td><div class="skeleton-cell" style="width: 90px; border-radius: 10px;"></div></td>
							<td><div class="skeleton-cell" style="width: 100px;"></div></td>
							<td><div class="skeleton-cell" style="width: 70px;"></div></td>
							<td><div class="skeleton-cell" style="width: 85px; border-radius: 10px;"></div></td>
							<td><div class="skeleton-cell" style="width: 110px;"></div></td>
							<td><div class="skeleton-cell" style="width: 60px; float: right;"></div></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else if sortedEmployees.length === 0}
			<div class="empty-table-state">
				{t('list.emptyNoMatch')}<br />
				{t('list.emptyNoMatchHint')}
			</div>
		{:else}
			<table class="sub-table density-{tableDensity}">
				<thead>
					<tr>
						<th class="sortable-th" class:active-sort={sortKey === 'employeeCode'} onclick={() => toggleSort('employeeCode')}>
							{t('list.colEmployeeId')}
							<span class="sort-indicator">
								{#if sortKey === 'employeeCode'}
									<i class="ti ti-chevron-{sortDirection === 'asc' ? 'up' : 'down'}"></i>
								{:else}
									<i class="ti ti-selector"></i>
								{/if}
							</span>
						</th>
						<th class="sortable-th" class:active-sort={sortKey === 'fullNameLatin'} onclick={() => toggleSort('fullNameLatin')}>
							{t('list.colName')}
							<span class="sort-indicator">
								{#if sortKey === 'fullNameLatin'}
									<i class="ti ti-chevron-{sortDirection === 'asc' ? 'up' : 'down'}"></i>
								{:else}
									<i class="ti ti-selector"></i>
								{/if}
							</span>
						</th>
						<th class="sortable-th" class:active-sort={sortKey === 'role'} onclick={() => toggleSort('role')}>
							{t('list.colRole')}
							<span class="sort-indicator">
								{#if sortKey === 'role'}
									<i class="ti ti-chevron-{sortDirection === 'asc' ? 'up' : 'down'}"></i>
								{:else}
									<i class="ti ti-selector"></i>
								{/if}
							</span>
						</th>
						<th class="sortable-th" class:active-sort={sortKey === 'department'} onclick={() => toggleSort('department')}>
							{t('list.colDepartment')}
							<span class="sort-indicator">
								{#if sortKey === 'department'}
									<i class="ti ti-chevron-{sortDirection === 'asc' ? 'up' : 'down'}"></i>
								{:else}
									<i class="ti ti-selector"></i>
								{/if}
							</span>
						</th>
						<th class="sortable-th" class:active-sort={sortKey === 'docsProgress'} onclick={() => toggleSort('docsProgress')}>
							{t('list.colDocuments')}
							<span class="sort-indicator">
								{#if sortKey === 'docsProgress'}
									<i class="ti ti-chevron-{sortDirection === 'asc' ? 'up' : 'down'}"></i>
								{:else}
									<i class="ti ti-selector"></i>
								{/if}
							</span>
						</th>
						<th class="sortable-th" class:active-sort={sortKey === 'onboardingStatus'} onclick={() => toggleSort('onboardingStatus')}>
							{t('list.colOnboarding')}
							<span class="sort-indicator">
								{#if sortKey === 'onboardingStatus'}
									<i class="ti ti-chevron-{sortDirection === 'asc' ? 'up' : 'down'}"></i>
								{:else}
									<i class="ti ti-selector"></i>
								{/if}
							</span>
						</th>
						<th class="sortable-th" class:active-sort={sortKey === 'createdAt'} onclick={() => toggleSort('createdAt')}>
							{t('list.colRegistered')}
							<span class="sort-indicator">
								{#if sortKey === 'createdAt'}
									<i class="ti ti-chevron-{sortDirection === 'asc' ? 'up' : 'down'}"></i>
								{:else}
									<i class="ti ti-selector"></i>
								{/if}
							</span>
						</th>
						<th style="text-align:right;">{t('list.colActions')}</th>
					</tr>
				</thead>
				<tbody>
					{#each paginatedEmployees as rec (rec.id)}
						<tr>
							<td style="font-family:var(--mono);">{rec.employeeCode}</td>
							<td style="font-weight:600;">{rec.fullNameLatin}</td>
							<td>
								<span class="role-chip {rec.role}">{roleLabels[rec.role as Role] ?? rec.role}</span>
							</td>
							<td>{rec.department}</td>
							<td>
								<div class="doc-progress">
									<span class="bar"><i style="width:{rec.docsTotal ? (rec.docsVerified / rec.docsTotal) * 100 : 0}%"></i></span>
									<span class="cnt">{rec.docsVerified}/{rec.docsTotal}</span>
								</div>
							</td>
							<td>
								<span class="ob-badge {rec.onboardingStatus}">
									<span class="dot"></span>{statusLabels[rec.onboardingStatus]}
								</span>
							</td>
							<td style="color:var(--gray-500);font-size:12px;">{fmtDate(rec.createdAt)}</td>
							<td>
								<div class="action-group">
									<button
										class="icon-btn"
										title={t('list.viewEmployee')}
										aria-label="{t('list.viewEmployee')} {rec.fullNameLatin}"
										onclick={() => goto(`/employees/${rec.id}`)}
									>
										<i class="ti ti-eye" aria-hidden="true"></i>
									</button>
									<button
										class="icon-btn"
										title={t('list.editEmployee')}
										aria-label="{t('list.editEmployee')} {rec.fullNameLatin}"
										onclick={() => goto(`/employees/${rec.id}?edit=1`)}
									>
										<i class="ti ti-pencil" aria-hidden="true"></i>
									</button>
									<button
										class="icon-btn link-btn"
										title={t('list.generateLinkFor', { name: rec.fullNameLatin })}
										aria-label={t('list.generateLinkFor', { name: rec.fullNameLatin })}
										onclick={() => generateLink(rec)}
									>
										<i class="ti ti-link" aria-hidden="true"></i>
									</button>
									<button
										class="icon-btn danger"
										title={t('list.deleteEmployee')}
										aria-label="{t('list.deleteEmployee')} {rec.fullNameLatin}"
										onclick={() => (deleteTarget = rec)}
									>
										<i class="ti ti-trash" aria-hidden="true"></i>
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			
			<!-- Pagination Footer -->
			{#if sortedEmployees.length > 0}
				<div class="pagination-container">
					<div class="pagination-info">
						{t('list.showingRange', {
							from: pageSize === 'all' ? 1 : Math.min(sortedEmployees.length, (currentPage - 1) * pageSize + 1),
							to: pageSize === 'all' ? sortedEmployees.length : Math.min(sortedEmployees.length, currentPage * pageSize),
							total: sortedEmployees.length
						})}
						{#if filteredEmployees.length !== employees.length}
							{t('list.filteredFrom', { n: employees.length })}
						{/if}
					</div>

					<div class="pagination-controls">
						<button
							class="pagination-btn"
							disabled={currentPage === 1}
							onclick={() => currentPage = 1}
							title={t('list.firstPage')}
						>
							<i class="ti ti-chevrons-left"></i>
						</button>
						<button
							class="pagination-btn"
							disabled={currentPage === 1}
							onclick={() => currentPage = Math.max(1, currentPage - 1)}
							title={t('list.prevPage')}
						>
							<i class="ti ti-chevron-left"></i> {t('common.prev')}
						</button>

						<span style="font-family: var(--mono); font-size: 11.5px; margin: 0 4px; color: var(--gray-700);">
							{t('list.pageOf', { current: currentPage, total: totalPages })}
						</span>

						<button
							class="pagination-btn"
							disabled={currentPage === totalPages}
							onclick={() => currentPage = Math.min(totalPages, currentPage + 1)}
							title={t('list.nextPage')}
						>
							{t('common.next')} <i class="ti ti-chevron-right"></i>
						</button>
						<button
							class="pagination-btn"
							disabled={currentPage === totalPages}
							onclick={() => currentPage = totalPages}
							title={t('list.lastPage')}
						>
							<i class="ti ti-chevrons-right"></i>
						</button>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</AppShell>

{#if wizardOpen}
	<Modal
		title="Start onboarding — FORM MCR-ONB-01"
		sub="Fill from the candidate's physical documents"
		onClose={() => (wizardOpen = false)}
	>
		<OnboardingWizard onClose={() => (wizardOpen = false)} onSubmitted={() => refresh()} />
	</Modal>
{/if}

{#if deleteTarget}
	<Modal
		title={t('list.deleteTitle')}
		sub={deleteTarget.employeeCode}
		size="sm"
		onClose={() => (deleteTarget = null)}
	>
		<div class="confirm-body">
			{t('list.deleteConfirm', { name: deleteTarget.fullNameLatin, code: deleteTarget.employeeCode, dept: deleteTarget.department })}
		</div>
		<div class="confirm-warn">
			<i class="ti ti-alert-triangle" aria-hidden="true" style="vertical-align:-2px;margin-right:4px;"></i>
			{t('list.deleteWarning')}
		</div>
		<div class="confirm-actions">
			<button class="btn-secondary" onclick={() => (deleteTarget = null)}>{t('common.cancel')}</button>
			<button class="btn-danger" onclick={confirmDelete} disabled={deleting}>
				{#if deleting}<i class="ti ti-loader-2 spin" aria-hidden="true"></i> {t('list.deleting')}{:else}<i class="ti ti-trash" aria-hidden="true"></i> {t('list.deletePermanently')}{/if}
			</button>
		</div>
	</Modal>
{/if}

{#if linkTarget}
	<Modal
		title={t('list.linkModalTitle')}
		sub={linkTarget.employeeCode}
		size="sm"
		onClose={() => { linkTarget = null; linkData = null; }}
	>
		{#if linkLoading}
			<div class="link-modal-loading">
				<i class="ti ti-loader-2 spin" aria-hidden="true" style="font-size:1.5rem;color:var(--accent);"></i>
				<span>{t('list.linkGenerating')}</span>
			</div>
		{:else if linkData}
			<div class="link-modal-body">
				<div class="link-modal-icon">🔗</div>
				<p class="link-modal-desc">
					{t('list.linkDesc', { name: linkTarget.fullNameLatin })}
				</p>
				<div class="link-box">
					<span class="link-text">{typeof window !== 'undefined' ? window.location.origin : ''}{linkData.url}</span>
					<button class="copy-btn" onclick={copyLink} title="Copy to clipboard">
						{#if linkCopied}
							<i class="ti ti-check" aria-hidden="true"></i> {t('list.linkCopied')}
						{:else}
							<i class="ti ti-copy" aria-hidden="true"></i> {t('list.linkCopy')}
						{/if}
					</button>
				</div>
				<p class="link-expiry">
					<i class="ti ti-clock" aria-hidden="true"></i>
					{t('list.linkExpiresLabel')} <b>{new Date(linkData.expiresAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</b>
					(7 days)
				</p>
				<p class="link-note">
					{t('list.linkNote')}
				</p>
			</div>
		{/if}
		<div class="confirm-actions">
			<button class="btn-secondary" onclick={() => { linkTarget = null; linkData = null; }}>{t('common.close')}</button>
			{#if linkData}
				<button class="btn-primary-sm" onclick={copyLink}>
					{#if linkCopied}<i class="ti ti-check" aria-hidden="true"></i> {t('list.linkCopied')}{:else}<i class="ti ti-copy" aria-hidden="true"></i> {t('list.linkCopyLink')}{/if}
				</button>
			{/if}
		</div>
	</Modal>
{/if}

<style>
	/* ── Link button ── */
	:global(.icon-btn.link-btn) {
		color: #3b82f6 !important;
	}
	:global(.icon-btn.link-btn:hover) {
		background: rgba(59,130,246,.15) !important;
		color: #60a5fa !important;
	}

	/* ── Link modal ── */
	.link-modal-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: .75rem;
		padding: 1.5rem 0;
		color: var(--gray-500);
		font-size: .9rem;
	}
	.link-modal-body {
		display: flex;
		flex-direction: column;
		gap: .9rem;
		padding: .25rem 0 .75rem;
	}
	.link-modal-icon {
		font-size: 2rem;
		text-align: center;
	}
	.link-modal-desc {
		color: var(--gray-400);
		font-size: .875rem;
		text-align: center;
		line-height: 1.5;
		margin: 0;
	}
	.link-box {
		display: flex;
		align-items: center;
		gap: .5rem;
		background: var(--surface-2, rgba(255,255,255,.04));
		border: 1px solid rgba(255,255,255,.12);
		border-radius: 10px;
		padding: .6rem .8rem;
	}
	.link-text {
		flex: 1;
		font-size: .78rem;
		font-family: var(--mono);
		color: #93c5fd;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.copy-btn {
		background: rgba(59,130,246,.15);
		border: 1px solid rgba(59,130,246,.3);
		border-radius: 7px;
		color: #93c5fd;
		font-size: .78rem;
		font-weight: 600;
		padding: .35rem .65rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: .3rem;
		flex-shrink: 0;
		transition: background .2s;
		white-space: nowrap;
	}
	.copy-btn:hover { background: rgba(59,130,246,.3); }
	.link-expiry {
		font-size: .8rem;
		color: var(--gray-500);
		margin: 0;
		display: flex;
		align-items: center;
		gap: .35rem;
	}
	.link-note {
		font-size: .76rem;
		color: var(--gray-600, #475569);
		margin: 0;
		padding: .5rem .7rem;
		background: rgba(245,158,11,.06);
		border-left: 2px solid rgba(245,158,11,.5);
		border-radius: 0 6px 6px 0;
	}
	.btn-primary-sm {
		background: linear-gradient(135deg, #3b82f6, #6366f1);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: .55rem 1rem;
		font-size: .85rem;
		font-weight: 600;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: .4rem;
		transition: opacity .2s;
	}
	.btn-primary-sm:hover { opacity: .88; }
</style>
