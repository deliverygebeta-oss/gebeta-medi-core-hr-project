<script lang="ts">
	import { i18n, setLocale } from '$lib/i18n';
</script>

<div class="lang-toggle" role="group" aria-label="Language">
	<button
		type="button"
		class="lang-btn"
		class:active={i18n.locale === 'en'}
		onclick={() => setLocale('en')}
	>
		EN
	</button>
	<button
		type="button"
		class="lang-btn"
		class:active={i18n.locale === 'am'}
		onclick={() => setLocale('am')}
	>
		አማ
	</button>
</div>

<style>
	.lang-toggle {
		display: inline-flex;
		border: 1px solid var(--gray-300);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.lang-btn {
		background: #fff;
		border: none;
		color: var(--gray-700);
		font-family: var(--mono);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.03em;
		padding: 7px 11px;
		cursor: pointer;
	}
	.lang-btn + .lang-btn {
		border-left: 1px solid var(--gray-300);
	}
	.lang-btn:hover {
		background: var(--gray-100);
	}
	.lang-btn.active {
		background: var(--blue);
		color: #fff;
	}
</style>
