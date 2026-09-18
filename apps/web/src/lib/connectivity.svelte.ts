import { browser } from '$app/environment';
import { apiUrl } from './apiBase';

const PING_INTERVAL_MS = 10_000;
const PING_TIMEOUT_MS = 5_000;

export const connectivity = $state({
	online: browser ? navigator.onLine : true,
	apiReachable: true
});

export const disconnected = () => !connectivity.online || !connectivity.apiReachable;

async function pingApi() {
	// Offline already answers the question — skip the network round trip.
	if (!connectivity.online) return;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
	try {
		const res = await fetch(apiUrl('/api/health'), { signal: controller.signal, cache: 'no-store' });
		connectivity.apiReachable = res.ok;
	} catch {
		connectivity.apiReachable = false;
	} finally {
		clearTimeout(timeout);
	}
}

let started = false;

/** Call once from the root layout — sets up listeners and starts polling. */
export function startConnectivityMonitor() {
	if (!browser || started) return;
	started = true;

	window.addEventListener('online', () => {
		connectivity.online = true;
		pingApi();
	});
	window.addEventListener('offline', () => {
		connectivity.online = false;
	});

	pingApi();
	setInterval(pingApi, PING_INTERVAL_MS);
}
