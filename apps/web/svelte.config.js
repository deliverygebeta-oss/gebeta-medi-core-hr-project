import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		runes: true
	},
	kit: {
		// adapter-auto can't detect a plain Docker/VPS target — adapter-node
		// produces a real, runnable Node/Bun server (build/index.js).
		adapter: adapter()
	}
};

export default config;
