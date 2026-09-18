// Barrel so callers write `from '$lib/i18n'` — the actual $state rune lives
// in store.svelte.ts, since only files with a .svelte.ts name get compiled
// for rune support outside of .svelte components.
export * from './store.svelte';
