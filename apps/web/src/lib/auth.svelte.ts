import { browser } from '$app/environment';
import { apiUrl } from './apiBase';

export interface Officer {
	id: number;
	username: string;
	fullName: string;
	role: 'hr_officer' | 'admin' | 'viewer';
}

interface TokenPair {
	accessToken: string;
	refreshToken: string;
}

// No httpOnly cookie in a cross-origin (app.* / api.*) deployment, so the
// app itself holds the credential. This trades cookie-level XSS protection
// for the ability to call an API on a different domain — accepted
// consciously here since this is an internal, access-controlled tool, not a
// public consumer app. Access tokens are short-lived (15 min default) so a
// leaked one has a small window; the refresh token is the real secret and
// is rotated (single-use) on every refresh.
const ACCESS_KEY = 'medicore_access_token';
const REFRESH_KEY = 'medicore_refresh_token';
const OFFICER_KEY = 'medicore_officer_display';

function readTokens(): TokenPair | null {
	if (!browser) return null;
	const accessToken = localStorage.getItem(ACCESS_KEY);
	const refreshToken = localStorage.getItem(REFRESH_KEY);
	return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

function restoreDisplay(): Officer | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(OFFICER_KEY);
		return raw ? (JSON.parse(raw) as Officer) : null;
	} catch {
		return null;
	}
}

// `checked` is false until the /api/auth/me round trip resolves at least
// once — guards must wait for it instead of trusting the cached officer.
export const auth = $state<{ officer: Officer | null; checked: boolean }>({
	officer: restoreDisplay(),
	checked: false
});

let tokens: TokenPair | null = readTokens();

export function getAccessToken(): string | null {
	return tokens?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
	return tokens?.refreshToken ?? null;
}

export function setTokens(pair: TokenPair) {
	tokens = pair;
	if (browser) {
		localStorage.setItem(ACCESS_KEY, pair.accessToken);
		localStorage.setItem(REFRESH_KEY, pair.refreshToken);
	}
}

export function setSession(officer: Officer, pair?: TokenPair) {
	auth.officer = officer;
	auth.checked = true;
	if (pair) setTokens(pair);
	if (browser) localStorage.setItem(OFFICER_KEY, JSON.stringify(officer));
}

export function clearSession() {
	auth.officer = null;
	auth.checked = true;
	tokens = null;
	if (browser) {
		localStorage.removeItem(OFFICER_KEY);
		localStorage.removeItem(ACCESS_KEY);
		localStorage.removeItem(REFRESH_KEY);
	}
}

async function fetchMe(accessToken: string): Promise<Officer | null> {
	const res = await fetch(apiUrl('/api/auth/me'), {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	return res.ok ? ((await res.json()) as Officer) : null;
}

async function tryRefresh(refreshToken: string): Promise<TokenPair | null> {
	const res = await fetch(apiUrl('/api/auth/refresh'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ refreshToken })
	});
	return res.ok ? ((await res.json()) as TokenPair) : null;
}

/**
 * Confirms the stored tokens are still valid; call once on app boot. The
 * access token is short-lived by design, so a page reload commonly lands
 * here with one already expired — one refresh attempt before giving up
 * keeps that the normal case, not a forced re-login.
 */
export async function checkSession() {
	if (!tokens) {
		clearSession();
		return;
	}
	let officer = await fetchMe(tokens.accessToken);
	if (!officer) {
		const refreshed = await tryRefresh(tokens.refreshToken);
		if (!refreshed) {
			clearSession();
			return;
		}
		setTokens(refreshed);
		officer = await fetchMe(refreshed.accessToken);
	}
	if (officer) setSession(officer);
	else clearSession();
}
