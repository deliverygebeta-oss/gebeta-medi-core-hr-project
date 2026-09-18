<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth, checkSession } from '$lib/auth.svelte';
	import { login } from '$lib/api';
	import { showToast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n';
	import LanguageToggle from '$lib/components/LanguageToggle.svelte';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	// Validation States
	let usernameTouched = $state(false);
	let passwordTouched = $state(false);
	let showPassword = $state(false);

	// Derived Validation Rules
	const usernameError = $derived.by(() => {
		if (!usernameTouched) return '';
		const val = username.trim();
		if (!val) return t('login.usernameRequired');
		if (val.length < 3) return t('login.usernameTooShort');
		if (val.length > 60) return t('login.usernameTooLong');
		const validFormat = /^[a-zA-Z0-9._]+$/;
		if (!validFormat.test(val)) return t('login.usernameFormat');
		return '';
	});

	const passwordError = $derived.by(() => {
		if (!passwordTouched) return '';
		const val = password;
		if (!val) return t('login.passwordRequired');
		if (val.length < 6) return t('login.passwordTooShort');
		return '';
	});

	const isFormValid = $derived(
		username.trim().length >= 3 &&
		username.trim().length <= 60 &&
		/^[a-zA-Z0-9._]+$/.test(username.trim()) &&
		password.length >= 6
	);

	// Already signed in? Straight to the platform. The cookie is httpOnly, so
	// this has to ask the server rather than read local state.
	$effect(() => {
		checkSession();
	});
	$effect(() => {
		if (auth.checked && auth.officer) goto('/');
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		usernameTouched = true;
		passwordTouched = true;

		if (!isFormValid) {
			error = t('login.resolveErrors');
			return;
		}

		error = '';
		busy = true;
		try {
			const officer = await login(username.trim().toLowerCase(), password);
			showToast('Welcome, ' + officer.fullName, 'Signed in to MediCore HR', 'success');
			goto('/');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Sign-in failed';
		} finally {
			busy = false;
		}
	}
</script>

<div class="login-wrap">
	<form class="login-card" onsubmit={submit} novalidate>
		<div class="login-lang-toggle"><LanguageToggle /></div>

		<div class="login-brand">
			<div class="mark">M</div>
			<div class="name">{t('nav.brandName')} <span>{t('nav.brandSuffix')}</span></div>
		</div>
		<div class="login-sub">{t('login.tagline')}</div>

		{#if error}
			<div class="login-error" style="display: flex; align-items: flex-start; gap: 8px;">
				<i class="ti ti-alert-triangle" aria-hidden="true" style="font-size: 16px; margin-top: 2px;"></i>
				<span>{error}</span>
			</div>
		{/if}

		<div class="field" style="margin-bottom: 18px;">
			<label for="username">{t('login.username')}</label>
			<input
				type="text"
				id="username"
				placeholder={t('login.usernamePlaceholder')}
				autocomplete="username"
				class:invalid={!!usernameError}
				bind:value={username}
				onblur={() => usernameTouched = true}
			/>
			{#if usernameError}
				<span class="field-error" style="margin-top: 4px;">{usernameError}</span>
			{/if}
		</div>

		<div class="field" style="margin-bottom: 24px;">
			<label for="password">{t('login.password')}</label>
			<div class="password-wrap">
				<input
					type={showPassword ? 'text' : 'password'}
					id="password"
					placeholder={t('login.passwordPlaceholder')}
					autocomplete="current-password"
					class:invalid={!!passwordError}
					bind:value={password}
					onblur={() => passwordTouched = true}
				/>
				<button
					type="button"
					class="toggle-btn"
					onclick={() => showPassword = !showPassword}
					aria-label={showPassword ? 'Hide password' : 'Show password'}
					title={showPassword ? 'Hide password' : 'Show password'}
				>
					<i class="ti ti-eye{showPassword ? '-off' : ''}" aria-hidden="true"></i>
				</button>
			</div>
			{#if passwordError}
				<span class="field-error" style="margin-top: 4px;">{passwordError}</span>
			{/if}
		</div>

		<button class="btn-primary btn-login" type="submit" disabled={busy || (usernameTouched && passwordTouched && !isFormValid)}>
			{#if busy}
				<i class="ti ti-loader-2 spin" aria-hidden="true" style="margin-right: 4px;"></i> {t('login.signingIn')}
			{:else}
				<i class="ti ti-login" aria-hidden="true" style="margin-right: 4px;"></i> {t('login.signIn')}
			{/if}
		</button>

		<div class="login-foot">{t('login.footer')}<br />{t('login.footerSub')}</div>
		<div class="platform-credit" style="margin-top:12px;">Dev by <b>Gebeta Tech</b></div>
	</form>
</div>

<style>
	.login-card {
		position: relative;
	}
	.login-lang-toggle {
		position: absolute;
		top: 16px;
		right: 16px;
	}
</style>
