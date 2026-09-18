<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import {
		banks,
		baseDocuments,
		departments,
		employmentTypes,
		fellowshipDoc,
		jobCategories,
		jobGrades,
		mockCandidates,
		riskAllowanceMap,
		roleCards,
		roleLabels,
		specialties,
		subspecialtyMap,
		type DocStatus,
		type Role
	} from '$lib/constants';
	import { createEmployee, fetchNextCode } from '$lib/api';
	import { showToast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n';
	import EthiopianDatePicker from '$lib/components/EthiopianDatePicker.svelte';
	import EthiopianPhoneInput from '$lib/components/EthiopianPhoneInput.svelte';

	let {
		onClose,
		onSubmitted
	}: { onClose: () => void; onSubmitted: () => void } = $props();

	const todayIso = new Date().toISOString().split('T')[0];

	/* ===== form state ===== */
	function blankDocuments() {
		return baseDocuments.map((d) => ({
			...d,
			status: 'pending' as DocStatus,
			fileAttached: false
		}));
	}

	function blankForm() {
		return {
			fullNameLatin: '',
			fullNameAmharic: '',
			nationalId: '',
			dob: '',
			phone: '',
			email: '',
			gender: '',
			employmentType: '',
			department: '',
			jobCategory: '',
			role: '' as '' | Role,
			// credentials
			licenseNumber: '',
			licenseExpiry: '',
			nurseGrade: '',
			yearsExperience: '',
			cprCertified: false,
			boardCertNumber: '',
			onCallEligible: false,
			specialty: '',
			subspecialty: '',
			academicRank: '',
			certificationType: '',
			educationLevel: '',
			previousRole: '',
			// education & grade
			eduQualification: '',
			jobGrade: '',
			specializationText: '',
			// documents
			documents: blankDocuments(),
			fellowshipStatus: 'pending' as DocStatus,
			fellowshipAttached: false,
			// contract
			contractType: '' as '' | 'permanent' | 'fixed',
			hireDate: '',
			contractEndDate: '',
			baseSalaryEtb: '',
			bankName: '',
			bankAccountNumber: '',
			pensionNumber: '',
			tinNumber: '',
			// emergency & status
			emergencyName: '',
			emergencyRelationship: '',
			emergencyPhone: '',
			employmentStatus: 'active',
			statusEffectiveDate: '',
			handbookIssued: false,
			conductSigned: false
		};
	}

	let form = $state(blankForm());

	/* ===== ui state ===== */
	let currentPanel = $state(1);
	let completedPanels = new SvelteSet<number>();
	let skippedPanels = new SvelteSet<number>();
	let demoMode = $state(false);
	let sampleMenuOpen = $state(false);
	let employeeCode = $state('HRM-————-0000');
	let submitting = $state(false);
	let submitted = $state(false);
	let summary = $state<Record<string, string>>({});

	// Tracker/toast labels — three panels today (a Documents step used to sit
	// between 1 and 2 and was folded into the post-onboarding employee page).
	const panelNames: Record<number, string> = $derived({
		1: t('wizard.step1'),
		2: t('wizard.step3'),
		3: t('wizard.step4')
	});

	/* ===== validation ===== */
	let invalidFields = new SvelteSet<string>();

	const isEmpty = (v: unknown) => v === '' || v === null || v === undefined;

	function requiredFor(panel: number): [keyof typeof form, string][] {
		if (panel === 1) {
			const req: [keyof typeof form, string][] = [
				['fullNameLatin', t('wizard.fFullNameLatin')],
				['nationalId', t('wizard.fNationalId')],
				['dob', t('wizard.fDob')],
				['phone', t('wizard.fPhone')],
				['employmentType', t('wizard.fEmploymentType')],
				['department', t('wizard.fDepartment')],
				['jobCategory', t('wizard.fJobCategory')],
				['role', t('wizard.fRoleCategory')],
				['eduQualification', t('wizard.fEduQualification')],
				['jobGrade', t('wizard.fJobGrade')]
			];
			if (form.role === 'nurse') {
				req.push(
					['licenseNumber', t('wizard.fNurseLicense')],
					['licenseExpiry', t('wizard.fLicenseExpiry')],
					['nurseGrade', t('wizard.fNurseGrade')]
				);
			} else if (form.role === 'doctor') {
				req.push(
					['licenseNumber', t('wizard.fDoctorLicense')],
					['licenseExpiry', t('wizard.fLicenseExpiry')],
					['boardCertNumber', t('wizard.fBoardCert')],
					['specialty', t('wizard.fSpecialty')]
				);
			} else if (form.role === 'lab' || form.role === 'pharmacist') {
				req.push(
					['licenseNumber', t('wizard.fLabLicense')],
					['licenseExpiry', t('wizard.fLicenseExpiry')],
					['certificationType', t('wizard.fCertType')]
				);
			}
			return req;
		}
		if (panel === 2) {
			return [
				['contractType', t('wizard.fContractType')],
				['hireDate', t('wizard.fHireDate')],
				['baseSalaryEtb', t('wizard.fBaseSalary')],
				['bankName', t('wizard.fBank')],
				['bankAccountNumber', t('wizard.fBankAccount')],
				['pensionNumber', t('wizard.fPension')],
				['tinNumber', t('wizard.fTin')]
			];
		}
		if (panel === 3) {
			return [
				['emergencyName', t('wizard.fContactName')],
				['emergencyRelationship', t('wizard.fRelationship')],
				['emergencyPhone', t('wizard.fContactPhone')]
			];
		}
		return [];
	}

	function validatePanel(panel: number): boolean {
		invalidFields.clear();
		const missing = requiredFor(panel).filter(([key]) => isEmpty(form[key]));
		for (const [key] of missing) invalidFields.add(key);
		if (missing.length > 0) {
			const names = missing.map(([, label]) => label);
			showToast(
				'Missing required fields',
				names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : ''),
				'error'
			);
		}
		return missing.length === 0;
	}

	/* ===== derived ===== */
	const subspecialtyOptions = $derived(
		form.specialty ? (subspecialtyMap[form.specialty] ?? []) : []
	);
	const showFellowship = $derived(
		form.role === 'doctor' && form.subspecialty !== '' && !form.subspecialty.startsWith('None')
	);
	const riskAllowance = $derived(form.department ? (riskAllowanceMap[form.department] ?? '—') : '—');
	const probationEndDate = $derived.by(() => {
		if (!form.hireDate) return '';
		const d = new Date(form.hireDate);
		d.setDate(d.getDate() + 60);
		return d.toISOString().split('T')[0];
	});
	const contractLabel = $derived(
		form.contractType === 'fixed'
			? t('wizard.contractFixed')
			: form.contractType === 'permanent'
				? t('wizard.contractPermanent')
				: '—'
	);

	async function refreshNextCode() {
		try {
			employeeCode = await fetchNextCode();
		} catch (err) {
			showToast('Could not fetch employee ID', err instanceof Error ? err.message : '', 'error');
		}
	}
	$effect(() => {
		refreshNextCode();
	});

	/* ===== navigation ===== */
	function goToPanel(n: number) {
		currentPanel = n;
	}

	function next(target: number) {
		if (!demoMode && !validatePanel(currentPanel)) return;
		invalidFields.clear();
		completedPanels.add(currentPanel);
		showToast('Saved — ' + panelNames[currentPanel], 'Moved to ' + panelNames[target], 'success');
		goToPanel(target);
	}

	function stepClick(target: number) {
		if (target === currentPanel) return;
		if (demoMode) {
			if (!completedPanels.has(currentPanel)) skippedPanels.add(currentPanel);
			goToPanel(target);
		} else if (completedPanels.has(target) || completedPanels.has(currentPanel)) {
			goToPanel(target);
		} else {
			showToast('Section locked', 'Complete the current section first, or enable demo mode', 'info');
		}
	}

	function toggleDemo() {
		demoMode = !demoMode;
	}

	/* ===== role selection ===== */
	function selectRole(role: Role) {
		form.role = form.role === role ? '' : role;
		if (form.role) {
			showToast('Role set — ' + roleLabels[role], 'Credential fields updated below', 'info');
		}
	}

	function toggleUpload(doc: { fileAttached: boolean }) {
		doc.fileAttached = !doc.fileAttached;
	}

	/* ===== samples ===== */
	function loadSample(key: string) {
		const candidate = mockCandidates.find((c) => c.key === key);
		if (!candidate) return;
		const fresh = blankForm();
		Object.assign(fresh, candidate.data);
		fresh.documents = baseDocuments.map((d) => ({
			...d,
			status: 'pending' as DocStatus,
			fileAttached: false
		}));
		fresh.fellowshipStatus = 'pending';
		fresh.fellowshipAttached = false;
		fresh.handbookIssued = true;
		fresh.conductSigned = true;
		form = fresh;
		completedPanels.add(1);
		completedPanels.add(2);
		completedPanels.add(3);
		sampleMenuOpen = false;
		showToast('Sample loaded — ' + candidate.data.fullNameLatin, 'All sections pre-filled', 'success');
	}

	function clearForm() {
		form = blankForm();
		completedPanels.clear();
		skippedPanels.clear();
		currentPanel = 1;
		sampleMenuOpen = false;
	}

	/* ===== submit ===== */
	function buildPayload() {
		const documents = form.documents.map((d) => ({
			docType: d.docType,
			status: d.status,
			fileAttached: d.fileAttached
		}));
		if (showFellowship) {
			documents.push({
				docType: fellowshipDoc.docType,
				status: form.fellowshipStatus,
				fileAttached: form.fellowshipAttached
			});
		}
		return {
			fullNameLatin: form.fullNameLatin,
			fullNameAmharic: form.fullNameAmharic,
			nationalId: form.nationalId,
			dob: form.dob,
			phone: form.phone,
			email: form.email,
			gender: form.gender,
			employmentType: form.employmentType,
			department: form.department,
			jobCategory: form.jobCategory,
			role: form.role,
			eduQualification: form.eduQualification,
			jobGrade: form.jobGrade,
			specializationText: form.specializationText,
			credential: {
				licenseNumber: form.licenseNumber,
				licenseExpiry: form.licenseExpiry,
				nurseGrade: form.nurseGrade,
				yearsExperience: form.yearsExperience === '' ? undefined : Number(form.yearsExperience),
				cprCertified: form.cprCertified,
				boardCertNumber: form.boardCertNumber,
				onCallEligible: form.onCallEligible,
				specialty: form.specialty,
				subspecialty: form.subspecialty,
				academicRank: form.academicRank,
				certificationType: form.certificationType,
				educationLevel: form.educationLevel,
				previousRole: form.previousRole
			},
			documents,
			contract: {
				contractType: form.contractType,
				hireDate: form.hireDate,
				probationEndDate,
				contractEndDate: form.contractType === 'fixed' ? form.contractEndDate : '',
				baseSalaryEtb: Number(form.baseSalaryEtb),
				riskAllowance,
				bankName: form.bankName,
				bankAccountNumber: form.bankAccountNumber,
				pensionNumber: form.pensionNumber,
				tinNumber: form.tinNumber
			},
			emergencyContact: {
				name: form.emergencyName,
				relationship: form.emergencyRelationship,
				phone: form.emergencyPhone
			},
			employmentStatus: form.employmentStatus,
			statusEffectiveDate: form.statusEffectiveDate,
			handbookIssued: form.handbookIssued,
			conductSigned: form.conductSigned
		};
	}

	async function submit() {
		// Server rejects incomplete records, so validate every panel before sending.
		for (const panel of [1, 2, 3]) {
			if (!validatePanel(panel)) {
				goToPanel(panel);
				return;
			}
		}
		submitting = true;
		try {
			const created = await createEmployee(buildPayload());
			summary = {
				empId: created.employeeCode,
				name: form.fullNameLatin || '—',
				role: form.role ? roleLabels[form.role] : '—',
				dept: form.department || '—',
				empType: form.employmentType || '—',
				grade: form.jobGrade || '—',
				salary: form.baseSalaryEtb ? 'ETB ' + Number(form.baseSalaryEtb).toLocaleString() : '—',
				contract: contractLabel,
				hireDate: form.hireDate || '—',
				status: form.employmentStatus.replace('_', ' ').toUpperCase()
			};
			submitted = true;
			onSubmitted();
			showToast('Employee profile activated', created.employeeCode + ' registered to you', 'success');
		} catch (err) {
			showToast('Submission failed', err instanceof Error ? err.message : String(err), 'error');
		} finally {
			submitting = false;
		}
	}

	async function startAnother() {
		clearForm();
		submitted = false;
		await refreshNextCode();
	}
</script>

{#if !submitted}
	<div class="id-banner">
		<div>
			<div class="id-label">{t('wizard.idLabel')}</div>
			<div class="id-value">{employeeCode}</div>
		</div>
		<div class="id-meta">{t('wizard.idMeta')}<br />{t('wizard.idMetaLine2')}</div>
	</div>

	<div class="toolbar">
		<div style="display:flex;gap:10px;align-items:center;">
			<button class="btn-ghost" class:active-demo={demoMode} onclick={toggleDemo}>
				<i class="ti ti-wand" aria-hidden="true"></i> {t('wizard.demoMode')}
			</button>
			<div class="sample-wrap">
				<button
					class="btn-ghost"
					onclick={(e) => {
						e.stopPropagation();
						sampleMenuOpen = !sampleMenuOpen;
					}}
				>
					<i class="ti ti-database" aria-hidden="true"></i> {t('wizard.sample')}
					<i class="ti ti-chevron-down" aria-hidden="true" style="font-size:12px;"></i>
				</button>
				<div class="sample-menu" class:open={sampleMenuOpen} style="left:0;right:auto;">
					<div class="sample-menu-head">{t('wizard.loadSample')}</div>
					{#each mockCandidates as candidate (candidate.key)}
						<div
							class="sample-item"
							role="button"
							tabindex="0"
							onclick={(e) => {
								e.stopPropagation();
								loadSample(candidate.key);
							}}
							onkeydown={(e) => e.key === 'Enter' && loadSample(candidate.key)}
						>
							<div class="av {candidate.avatarClass}">{candidate.avatar}</div>
							<div>
								<div class="nm">{candidate.data.fullNameLatin}</div>
								<div class="rl">{candidate.displayRole}</div>
							</div>
						</div>
					{/each}
					<div class="sample-divider"></div>
					<div
						class="sample-clear"
						role="button"
						tabindex="0"
						onclick={(e) => {
							e.stopPropagation();
							clearForm();
						}}
						onkeydown={(e) => e.key === 'Enter' && clearForm()}
					>
						<i class="ti ti-eraser" aria-hidden="true"></i> {t('wizard.clearForm')}
					</div>
				</div>
			</div>
		</div>
		<span class="toolbar-hint">
			{demoMode ? t('wizard.demoOn') : t('wizard.demoOff')}
		</span>
	</div>

	<div class="tracker">
		{#each [1, 2, 3] as n (n)}
			<div
				class="step"
				class:active={currentPanel === n}
				class:done={completedPanels.has(n) && currentPanel !== n}
				class:skipped={skippedPanels.has(n) && !completedPanels.has(n) && currentPanel !== n}
				role="button"
				tabindex="0"
				onclick={() => stepClick(n)}
				onkeydown={(e) => e.key === 'Enter' && stepClick(n)}
			>
				<span class="n">{n}</span>{panelNames[n]}
			</div>
		{/each}
	</div>

	<div class="card">
		<!-- PANEL 1 — PERSONAL & ROLE -->
		<div class="panel" class:active={currentPanel === 1}>
			<div class="section-head">
				<span class="section-label">{t('wizard.sectionA')}</span>
				<span class="section-num">01 / 03</span>
			</div>

			<div class="grid2" style="margin-bottom:20px;">
				<div class="field">
					<label for="fullNameLatin">{t('wizard.fFullNameLatin')}<span class="req">*</span></label>
					<input type="text" id="fullNameLatin" class:invalid={invalidFields.has('fullNameLatin')} placeholder={t('wizard.fFullNameLatinPh')} bind:value={form.fullNameLatin} />
				</div>
				<div class="field">
					<label for="fullNameAmharic">{t('wizard.fFullNameAmharic')}<span class="note">({t('wizard.fFullNameAmharicNote')})</span></label>
					<input type="text" id="fullNameAmharic" placeholder={t('wizard.fFullNameAmharicPh')} bind:value={form.fullNameAmharic} />
				</div>
				<div class="field">
					<label for="nationalId">{t('wizard.fNationalId')}<span class="req">*</span><span class="note">({t('wizard.fNationalIdNote')})</span></label>
					<input type="text" id="nationalId" class:invalid={invalidFields.has('nationalId')} placeholder={t('wizard.fNationalIdPh')} bind:value={form.nationalId} />
				</div>
				<div class="field">
					<label for="dob">{t('wizard.fDob')}<span class="req">*</span><span class="note">({t('wizard.fDobNote')})</span></label>
					<EthiopianDatePicker id="dob" bind:value={form.dob} max={todayIso} />
				</div>
				<div class="field">
					<label for="phone">{t('wizard.fPhone')}<span class="req">*</span></label>
					<EthiopianPhoneInput id="phone" bind:value={form.phone} invalid={invalidFields.has('phone')} />
				</div>
				<div class="field">
					<label for="email">{t('wizard.fEmail')}<span class="opt">({t('common.optional')})</span></label>
					<input type="email" id="email" placeholder="name@hospital.et" bind:value={form.email} />
				</div>
				<div class="field">
					<label for="gender">{t('wizard.fGender')}</label>
					<select id="gender" bind:value={form.gender}>
						<option value="">{t('common.select')}</option>
						<option>{t('wizard.female')}</option>
						<option>{t('wizard.male')}</option>
					</select>
				</div>
				<div class="field">
					<label for="employmentType">{t('wizard.fEmploymentType')}<span class="req">*</span></label>
					<select id="employmentType" class:invalid={invalidFields.has('employmentType')} bind:value={form.employmentType}>
						<option value="">{t('common.select')}</option>
						{#each employmentTypes as et (et)}<option>{et}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="department">{t('wizard.fDepartment')}<span class="req">*</span></label>
					<select id="department" class:invalid={invalidFields.has('department')} bind:value={form.department}>
						<option value="">{t('common.select')}</option>
						{#each departments as d (d)}<option>{d}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="jobCategory">{t('wizard.fJobCategory')}<span class="req">*</span></label>
					<select id="jobCategory" class:invalid={invalidFields.has('jobCategory')} bind:value={form.jobCategory}>
						<option value="">{t('common.select')}</option>
						{#each jobCategories as c (c)}<option>{c}</option>{/each}
					</select>
				</div>
			</div>

			<label style="margin-bottom:10px;display:block;" for="roleGrid">
				{t('wizard.fRoleCategory')}<span class="req">*</span><span class="note">({t('wizard.fRoleCategoryNote')})</span>
			</label>
			<div class="role-grid" id="roleGrid">
				{#each roleCards as card (card.role)}
					<div
						class="role-card"
						class:selected={form.role === card.role}
						role="button"
						tabindex="0"
						onclick={() => selectRole(card.role)}
						onkeydown={(e) => e.key === 'Enter' && selectRole(card.role)}
					>
						<div class="icon"><i class="ti {card.icon}"></i></div>
						<div class="label">{t('wizard.role' + card.role.charAt(0).toUpperCase() + card.role.slice(1))}</div>
						<div class="label2">{card.label2 === 'Clinical' ? t('wizard.clinical') : t('wizard.nonClinical')}</div>
					</div>
				{/each}
			</div>

			<!-- CREDENTIAL ZONE -->
			<div class="credential-zone" class:open={form.role !== ''}>
				<div class="credential-zone-head">
					<span class="role-tag">{form.role ? roleLabels[form.role] : ''}</span>
					<span class="ttl">{t('wizard.sectionBCredentials')}</span>
				</div>

				{#if form.role === 'nurse'}
					<div class="grid2">
						<div class="field">
							<label for="nurseLicense">{t('wizard.fNurseLicense')}<span class="req">*</span></label>
							<input type="text" id="nurseLicense" class:invalid={invalidFields.has('licenseNumber')} placeholder="ETH-NURSE-00441" bind:value={form.licenseNumber} />
						</div>
						<div class="field">
							<label for="nurseExpiry">{t('wizard.fLicenseExpiry')}<span class="req">*</span><span class="note">({t('wizard.fLicenseExpiryNote')})</span></label>
							<EthiopianDatePicker id="nurseExpiry" bind:value={form.licenseExpiry} />
						</div>
						<div class="field">
							<label for="nurseGrade">{t('wizard.fNurseGrade')}<span class="req">*</span></label>
							<select id="nurseGrade" class:invalid={invalidFields.has('nurseGrade')} bind:value={form.nurseGrade}>
								<option value="">{t('common.select')}</option>
								<option>{t('wizard.nurseJunior')}</option>
								<option>{t('wizard.nurseSenior')}</option>
								<option>{t('wizard.nurseHeadTrack')}</option>
							</select>
						</div>
						<div class="field">
							<label for="nurseExp">{t('wizard.fYearsExperience')}</label>
							<input type="number" id="nurseExp" placeholder="e.g. 4" bind:value={form.yearsExperience} />
						</div>
					</div>
					<div class="checkbox-row">
						<input type="checkbox" id="cpr" bind:checked={form.cprCertified} />
						<label class="cb-label" for="cpr"><b>{t('wizard.cprLabel')}</b> {t('wizard.cprSub')}</label>
					</div>
				{:else if form.role === 'doctor'}
					<div class="grid2" style="margin-bottom:20px;">
						<div class="field">
							<label for="docLicense">{t('wizard.fDoctorLicense')}<span class="req">*</span></label>
							<input type="text" id="docLicense" class:invalid={invalidFields.has('licenseNumber')} placeholder="ETH-DOC-00823" bind:value={form.licenseNumber} />
						</div>
						<div class="field">
							<label for="docExpiry">{t('wizard.fLicenseExpiry')}<span class="req">*</span><span class="note">({t('wizard.fLicenseExpiryNote')})</span></label>
							<EthiopianDatePicker id="docExpiry" bind:value={form.licenseExpiry} />
						</div>
						<div class="field">
							<label for="boardCert">{t('wizard.fBoardCert')}<span class="req">*</span></label>
							<input type="text" id="boardCert" class:invalid={invalidFields.has('boardCertNumber')} placeholder="BC-2021-1190" bind:value={form.boardCertNumber} />
						</div>
						<div class="field">
							<label for="onCall">{t('wizard.fOnCall')}</label>
							<select
								id="onCall"
								value={form.onCallEligible ? 'yes' : 'no'}
								onchange={(e) => (form.onCallEligible = e.currentTarget.value === 'yes')}
							>
								<option value="no">{t('common.no')}</option>
								<option value="yes">{t('wizard.onCallYes')}</option>
							</select>
						</div>
					</div>
					<div class="grid3">
						<div class="field">
							<label for="specialty">{t('wizard.fSpecialty')}<span class="req">*</span></label>
							<select id="specialty" class:invalid={invalidFields.has('specialty')} bind:value={form.specialty} onchange={() => (form.subspecialty = '')}>
								<option value="">{t('common.select')}</option>
								{#each specialties as s (s)}<option>{s}</option>{/each}
							</select>
						</div>
						<div class="field">
							<label for="subspecialty">{t('wizard.fSubspecialty')}<span class="opt">({t('common.optional')})</span></label>
							<select id="subspecialty" bind:value={form.subspecialty} disabled={!form.specialty}>
								{#if !form.specialty}
									<option value="">{t('wizard.fSubspecialtyFirst')}</option>
								{:else}
									<option value="">{t('common.select')}</option>
									{#each subspecialtyOptions as o (o)}<option>{o}</option>{/each}
								{/if}
							</select>
						</div>
						<div class="field">
							<label for="academicRank">{t('wizard.fAcademicRank')}<span class="opt">({t('common.optional')})</span></label>
							<select id="academicRank" bind:value={form.academicRank}>
								<option value="">{t('common.select')}</option>
								<option>Instructor</option>
								<option>Assistant Professor</option>
								<option>Associate Professor</option>
								<option>Professor (Full)</option>
							</select>
						</div>
					</div>
					{#if showFellowship}
						<div class="conditional-note">
							<i class="ti ti-info-circle" aria-hidden="true" style="vertical-align:-2px;margin-right:4px;"></i>
							{t('wizard.fellowshipNote')}
						</div>
					{/if}
				{:else if form.role === 'lab' || form.role === 'pharmacist'}
					<div class="grid2">
						<div class="field">
							<label for="labLicense">{t('wizard.fLabLicense')}<span class="req">*</span></label>
							<input type="text" id="labLicense" class:invalid={invalidFields.has('licenseNumber')} placeholder="ETH-LAB-00219" bind:value={form.licenseNumber} />
						</div>
						<div class="field">
							<label for="labExpiry">{t('wizard.fLicenseExpiry')}<span class="req">*</span></label>
							<EthiopianDatePicker id="labExpiry" bind:value={form.licenseExpiry} />
						</div>
						<div class="field">
							<label for="certType">{t('wizard.fCertType')}<span class="req">*</span></label>
							<select id="certType" class:invalid={invalidFields.has('certificationType')} bind:value={form.certificationType}>
								<option value="">{t('common.select')}</option>
								<option>Laboratory Certification</option>
								<option>Pharmacy Board Certification</option>
							</select>
						</div>
					</div>
				{:else if form.role === 'admin'}
					<div class="grid2">
						<div class="field">
							<label for="eduLevel">{t('wizard.fEduLevel')}</label>
							<select id="eduLevel" bind:value={form.educationLevel}>
								<option value="">{t('common.select')}</option>
								<option>Diploma</option>
								<option>BA/BSc Degree</option>
								<option>MA/MSc Degree</option>
							</select>
						</div>
						<div class="field">
							<label for="prevRole">{t('wizard.fPrevRole')}<span class="opt">({t('common.optional')})</span></label>
							<input type="text" id="prevRole" placeholder="e.g. Finance Officer, City Clinic" bind:value={form.previousRole} />
						</div>
					</div>
				{/if}

				<div style="margin-top:24px;">
					<div class="section-head" style="margin-top:8px;">
						<span class="section-label" style="color:var(--gray-700);">{t('wizard.eduGradeHeader')}</span>
					</div>
					<div class="grid3">
						<div class="field">
							<label for="eduQual">{t('wizard.fEduQualification')}<span class="req">*</span></label>
							<input type="text" id="eduQual" class:invalid={invalidFields.has('eduQualification')} placeholder="e.g. BSc Nursing, AAU, 2018" bind:value={form.eduQualification} />
							<div class="hint">{t('wizard.fEduQualificationHint')}</div>
						</div>
						<div class="field">
							<label for="jobGrade">{t('wizard.fJobGrade')}<span class="req">*</span><span class="note">({t('wizard.fJobGradeNote')})</span></label>
							<select id="jobGrade" class:invalid={invalidFields.has('jobGrade')} bind:value={form.jobGrade}>
								<option value="">{t('common.select')}</option>
								{#each jobGrades as g (g)}<option>{g}</option>{/each}
							</select>
						</div>
						<div class="field">
							<label for="specText">{t('wizard.fSpecializationText')}<span class="opt">({t('wizard.fSpecializationNote')})</span></label>
							<input type="text" id="specText" placeholder="e.g. Internal Medicine > Cardiology" bind:value={form.specializationText} />
						</div>
					</div>
				</div>
			</div>

			<div class="panel-nav">
				<div>
					<div class="footer-note">{t('wizard.licenseFooterNote')}</div>
					<div class="progress-meta">{t('wizard.sectionsComplete', { n: completedPanels.size })}</div>
				</div>
				<div class="footer-actions">
					<button class="btn-primary" onclick={() => next(2)}>{t('wizard.nextContract')}</button>
				</div>
			</div>
		</div>

		<!-- PANEL 2 — CONTRACT -->
		<div class="panel" class:active={currentPanel === 2}>
			<div class="section-head">
				<span class="section-label">{t('wizard.sectionBContract')}</span>
				<span class="section-num">02 / 03</span>
			</div>

			<label style="margin-bottom:10px;display:block;" for="contractToggle">{t('wizard.fContractType')}<span class="req">*</span></label>
			<div class="toggle-row" id="contractToggle" style="margin-bottom:22px;">
				<div
					class="toggle-opt"
					class:selected={form.contractType === 'permanent'}
					role="button"
					tabindex="0"
					onclick={() => (form.contractType = 'permanent')}
					onkeydown={(e) => e.key === 'Enter' && (form.contractType = 'permanent')}
				>
					{#if form.contractType === 'permanent'}
						<span class="check-badge"><i class="ti ti-check" aria-hidden="true"></i></span>
					{/if}
					<div class="t-label">{t('wizard.contractPermanent')}</div>
					<div class="t-sub">{t('wizard.contractPermanentSub')}</div>
				</div>
				<div
					class="toggle-opt"
					class:selected={form.contractType === 'fixed'}
					role="button"
					tabindex="0"
					onclick={() => (form.contractType = 'fixed')}
					onkeydown={(e) => e.key === 'Enter' && (form.contractType = 'fixed')}
				>
					{#if form.contractType === 'fixed'}
						<span class="check-badge"><i class="ti ti-check" aria-hidden="true"></i></span>
					{/if}
					<div class="t-label">{t('wizard.contractFixed')}</div>
					<div class="t-sub">{t('wizard.contractFixedSub')}</div>
				</div>
			</div>

			<div class="grid3" style="margin-bottom:20px;">
				<div class="field">
					<label for="hireDate">{t('wizard.fHireDate')}<span class="req">*</span><span class="note">({t('wizard.fHireDateNote')})</span></label>
					<EthiopianDatePicker id="hireDate" bind:value={form.hireDate} />
				</div>
				<div class="field">
					<label for="probEnd">{t('wizard.fProbationEnd')}<span class="note">({t('wizard.fProbationEndNote')})</span></label>
					<EthiopianDatePicker id="probEnd" value={probationEndDate} readonly />
					<div class="hint">{t('wizard.probationHint')}</div>
				</div>
				<div class="field" style:opacity={form.contractType === 'fixed' ? '1' : '.4'}>
					<label for="contractEnd">{t('wizard.fContractEnd')}<span class="opt">({t('wizard.fContractEndNote')})</span></label>
					<EthiopianDatePicker id="contractEnd" bind:value={form.contractEndDate} disabled={form.contractType !== 'fixed'} />
				</div>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="baseSalary">{t('wizard.fBaseSalary')}<span class="req">*</span></label>
					<input type="number" id="baseSalary" class:invalid={invalidFields.has('baseSalaryEtb')} placeholder="e.g. 9500" bind:value={form.baseSalaryEtb} />
				</div>
				<div class="field">
					<label for="riskAllow">{t('wizard.fRiskAllowance')}<span class="opt">({t('wizard.fRiskAllowanceNote')})</span></label>
					<input type="text" id="riskAllow" value={riskAllowance} readonly />
				</div>
				<div class="field">
					<label for="bank">{t('wizard.fBank')}<span class="req">*</span></label>
					<select id="bank" class:invalid={invalidFields.has('bankName')} bind:value={form.bankName}>
						<option value="">{t('wizard.fSelectBank')}</option>
						{#each banks as b (b)}<option>{b}</option>{/each}
					</select>
				</div>
				<div class="field full">
					<label for="bankAcct">{t('wizard.fBankAccount')}<span class="req">*</span></label>
					<input type="text" id="bankAcct" class:invalid={invalidFields.has('bankAccountNumber')} placeholder="e.g. 1000123456789" bind:value={form.bankAccountNumber} />
				</div>
				<div class="field">
					<label for="pension">{t('wizard.fPension')}<span class="req">*</span></label>
					<input type="text" id="pension" class:invalid={invalidFields.has('pensionNumber')} placeholder="e.g. POEPF-882910" bind:value={form.pensionNumber} />
				</div>
				<div class="field">
					<label for="tin">{t('wizard.fTin')}<span class="req">*</span></label>
					<input type="text" id="tin" class:invalid={invalidFields.has('tinNumber')} placeholder="e.g. 0012345678" bind:value={form.tinNumber} />
				</div>
			</div>

			<div class="panel-nav">
				<div>
					<div class="footer-note">{t('wizard.contractFooterNote')}</div>
					<div class="progress-meta">{t('wizard.sectionsComplete', { n: completedPanels.size })}</div>
				</div>
				<div class="footer-actions">
					<button class="btn-secondary" onclick={() => goToPanel(1)}>← {t('common.back')}</button>
					<button class="btn-primary" onclick={() => next(3)}>{t('wizard.nextEmergency')}</button>
				</div>
			</div>
		</div>

		<!-- PANEL 3 — EMERGENCY & STATUS -->
		<div class="panel" class:active={currentPanel === 3}>
			<div class="section-head">
				<span class="section-label">{t('wizard.sectionCEmergency')}</span>
				<span class="section-num">03 / 03</span>
			</div>

			<div class="conditional-note amber" style="margin-bottom:20px;display:block;">
				<i class="ti ti-alert-triangle" aria-hidden="true" style="vertical-align:-2px;margin-right:4px;"></i>
				{t('wizard.emergencyRequired')}
			</div>

			<div class="grid3" style="margin-bottom:24px;">
				<div class="field">
					<label for="emName">{t('wizard.fContactName')}<span class="req">*</span></label>
					<input type="text" id="emName" class:invalid={invalidFields.has('emergencyName')} placeholder="e.g. Tinsae Worku" bind:value={form.emergencyName} />
				</div>
				<div class="field">
					<label for="emRel">{t('wizard.fRelationship')}<span class="req">*</span></label>
					<select id="emRel" class:invalid={invalidFields.has('emergencyRelationship')} bind:value={form.emergencyRelationship}>
						<option value="">{t('common.select')}</option>
						<option>{t('wizard.relSpouse')}</option>
						<option>{t('wizard.relParent')}</option>
						<option>{t('wizard.relSibling')}</option>
						<option>{t('wizard.relOther')}</option>
					</select>
				</div>
				<div class="field">
					<label for="emPhone">{t('wizard.fContactPhone')}<span class="req">*</span></label>
					<EthiopianPhoneInput id="emPhone" bind:value={form.emergencyPhone} invalid={invalidFields.has('emergencyPhone')} />
				</div>
			</div>

			<div class="section-head">
				<span class="section-label" style="color:var(--gray-700);">{t('wizard.employmentStatusHeader')}</span>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="empStatus">{t('wizard.fEmploymentStatus')}<span class="req">*</span></label>
					<select id="empStatus" bind:value={form.employmentStatus}>
						<option value="active">{t('wizard.statusActive')}</option>
						<option value="on_leave">{t('wizard.statusOnLeave')}</option>
						<option value="suspended">{t('wizard.statusSuspended')}</option>
						<option value="terminated">{t('wizard.statusTerminated')}</option>
						<option value="retired">{t('wizard.statusRetired')}</option>
						<option value="deceased">{t('wizard.statusDeceased')}</option>
					</select>
				</div>
				<div class="field">
					<label for="statusDate">{t('wizard.fStatusEffectiveDate')}</label>
					<EthiopianDatePicker id="statusDate" bind:value={form.statusEffectiveDate} />
				</div>
			</div>

			<div class="checkbox-row" style="margin-top:24px;">
				<input type="checkbox" id="handbook" bind:checked={form.handbookIssued} />
				<label class="cb-label" for="handbook"><b>{t('wizard.handbookLabel')}</b> {t('wizard.handbookSub')}</label>
			</div>
			<div class="checkbox-row">
				<input type="checkbox" id="conduct" bind:checked={form.conductSigned} />
				<label class="cb-label" for="conduct"><b>{t('wizard.conductLabel')}</b> {t('wizard.conductSub')}</label>
			</div>

			<div class="panel-nav">
				<div>
					<div class="footer-note">{t('wizard.finalFooterNote')}</div>
					<div class="progress-meta">{t('wizard.sectionsComplete', { n: completedPanels.size })}</div>
				</div>
				<div class="footer-actions">
					<button class="btn-secondary" onclick={() => goToPanel(2)}>← {t('common.back')}</button>
					<button class="btn-primary" onclick={submit} disabled={submitting}>
						{submitting ? t('wizard.activating') : t('wizard.activate')}
					</button>
				</div>
			</div>
		</div>
	</div>
{:else}
	<!-- SUCCESS -->
	<div class="success-banner">
		<div class="check-circle"><i class="ti ti-check" aria-hidden="true"></i></div>
		<div class="stxt">
			<div class="sttl">{t('wizard.successTitle')}</div>
			<div class="ssub">{t('wizard.successSub')}</div>
		</div>
	</div>

	<div class="summary-grid">
		<div class="summary-card">
			<div class="sc-head">Employee summary</div>
			<div class="summary-row"><span class="sk">{t('wizard.summaryEmployeeId')}</span><span class="sv">{summary.empId}</span></div>
			<div class="summary-row"><span class="sk">{t('wizard.summaryName')}</span><span class="sv">{summary.name}</span></div>
			<div class="summary-row"><span class="sk">{t('wizard.summaryRole')}</span><span class="sv">{summary.role}</span></div>
			<div class="summary-row"><span class="sk">{t('wizard.summaryDept')}</span><span class="sv">{summary.dept}</span></div>
			<div class="summary-row"><span class="sk">{t('wizard.summaryEmpType')}</span><span class="sv">{summary.empType}</span></div>
			<div class="summary-row"><span class="sk">{t('wizard.summaryGrade')}</span><span class="sv">{summary.grade}</span></div>
			<div class="summary-row"><span class="sk">{t('wizard.summarySalary')}</span><span class="sv">{summary.salary}</span></div>
			<div class="summary-row"><span class="sk">{t('wizard.summaryContract')}</span><span class="sv">{summary.contract}</span></div>
			<div class="summary-row"><span class="sk">{t('wizard.summaryHireDate')}</span><span class="sv">{summary.hireDate}</span></div>
		</div>

		<div class="summary-card">
			<div class="sc-head">{t('wizard.employmentStatusHeader')}</div>
			<span class="status-pill-lg active"><span class="dot"></span> <span>{summary.status}</span></span>

			<div class="stage-list">
				<div class="stage-item"><span class="sti"><i class="ti ti-check" aria-hidden="true"></i></span><span class="stt">{t('wizard.stageBasic')}</span></div>
				<div class="stage-item"><span class="sti"><i class="ti ti-check" aria-hidden="true"></i></span><span class="stt">{t('wizard.stageContract')}</span></div>
				<div class="stage-item"><span class="sti"><i class="ti ti-check" aria-hidden="true"></i></span><span class="stt">{t('wizard.stageEmergency')}</span></div>
			</div>

			<div class="download-row">
				<button class="btn-secondary" style="flex:1;" onclick={startAnother}>
					<i class="ti ti-plus" aria-hidden="true" style="margin-right:4px;"></i> {t('wizard.startAnother')}
				</button>
				<button class="btn-primary" style="flex:1;" onclick={onClose}>{t('wizard.doneClose')}</button>
			</div>
		</div>
	</div>
{/if}
