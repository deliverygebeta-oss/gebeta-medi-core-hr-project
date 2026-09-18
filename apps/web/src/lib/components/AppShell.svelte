<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth, checkSession } from '$lib/auth.svelte';
	import { logout as apiLogout } from '$lib/api';
	import { showToast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n';
	import LanguageToggle from '$lib/components/LanguageToggle.svelte';

	let {
		title,
		sub = '',
		actions,
		children
	}: { title: string; sub?: string; actions?: Snippet; children: Snippet } = $props();

	// The cookie is httpOnly — this app can't just read localStorage to know
	// it's signed in, so it has to ask the server once per load.
	$effect(() => {
		checkSession();
	});

	// Route guard — only redirect once we've actually confirmed there's no
	// valid session, not on the optimistic first render.
	$effect(() => {
		if (auth.checked && !auth.officer) goto('/login');
	});

	const initials = $derived(
		(auth.officer?.fullName ?? '?')
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase()
	);

	async function logout() {
		await apiLogout();
		showToast('Signed out', 'Session ended', 'info');
		goto('/login');
	}

	const comingSoon = [
		{ key: 'nav.payroll', icon: 'ti-cash' },
		{ key: 'nav.scheduling', icon: 'ti-calendar-time' },
		{ key: 'nav.biometric', icon: 'ti-fingerprint' },
		{ key: 'nav.reports', icon: 'ti-chart-bar' }
	];
</script>

{#if auth.officer}
	<div class="shell">
		<aside class="sidebar">
			<div class="brand">
				<div class="mark">M</div>
				<div class="name">{t('nav.brandName')} <span>{t('nav.brandSuffix')}</span></div>
			</div>

			<div class="side-section">Workforce</div>
			<a
				class="side-item"
				class:active={page.url.pathname === '/' || page.url.pathname.startsWith('/employees')}
				href="/"
			>
				<i class="ti ti-users"></i> {t('nav.employees')}
			</a>

			<div class="side-section">Modules</div>
			{#each comingSoon as m (m.key)}
				<span class="side-item disabled">
					<i class="ti {m.icon}"></i>
					{t(m.key)}
					<span class="soon">{t('nav.soon')}</span>
				</span>
			{/each}

			<div class="side-foot">
				<div class="side-officer">
					<div class="av">{initials}</div>
					<div>
						<div class="nm">{auth.officer?.fullName}</div>
						<div class="rl">
							{auth.officer?.role === 'admin'
								? t('nav.administrator')
								: auth.officer?.role === 'viewer'
									? t('nav.viewer')
									: t('nav.hrOfficer')}
						</div>
					</div>
				</div>
				<button class="btn-logout" onclick={logout}>
					<i class="ti ti-logout" aria-hidden="true"></i> {t('nav.signOut')}
				</button>
				<div class="platform-credit">Dev by <b>Gebeta Tech</b></div>
			</div>
		</aside>

		<div class="main">
			<div class="topbar">
				<div>
					<div class="pg-title">{title}</div>
					{#if sub}<div class="pg-sub">{sub}</div>{/if}
				</div>
				<div class="topbar-right">
					<LanguageToggle />
					{#if actions}{@render actions()}{/if}
				</div>
			</div>
			<div class="main-body">
				{@render children()}
			</div>
		</div>
	</div>
{/if}
