import { env } from '$env/dynamic/public';

// web and api are deployed on separate domains (app.* / api.*) — every call
// needs an absolute URL. PUBLIC_API_URL is baked in at build time (Vite
// inlines PUBLIC_ vars); local dev falls back to '' so requests stay relative
// and go through vite.config.ts's dev-server proxy to localhost:3000.
const API_BASE = (env.PUBLIC_API_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
	return `${API_BASE}${path}`;
}
