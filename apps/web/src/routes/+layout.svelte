<script lang="ts">
	// Self-hosted (not a Google Fonts CDN <link>) — matches the same call made
	// for Tabler icons: a CDN font previously failed to load in this
	// environment, so every platform-wide typeface is bundled locally.
	import '@fontsource/open-sans/400.css';
	import '@fontsource/open-sans/500.css';
	import '@fontsource/open-sans/600.css';
	import '@fontsource/open-sans/700.css';
	import '@fontsource/open-sans/800.css';
	import '@tabler/icons-webfont/dist/tabler-icons.min.css';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import Toasts from '$lib/components/Toasts.svelte';
	import ConnectivityBanner from '$lib/components/ConnectivityBanner.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<Toasts />
<ConnectivityBanner />
