<script lang="ts">
	import { onMount } from 'svelte';
	import { connectivity, disconnected, startConnectivityMonitor } from '$lib/connectivity.svelte';
	import { t } from '$lib/i18n';

	onMount(() => {
		startConnectivityMonitor();
	});

	function reload() {
		location.reload();
	}
</script>

{#if disconnected()}
	<!-- Blocks interaction with whatever's underneath while the connection is
	     down — clicking through to a page that can't reach the API just
	     produces confusing failed requests, so freeze it instead. -->
	<div class="connectivity-overlay"></div>

	<div class="connectivity-banner" role="alert">
		<i class="ti ti-plug-connected-x" aria-hidden="true"></i>
		<div class="connectivity-text">
			<span class="connectivity-title">
				{connectivity.online ? t('common.serverUnreachableTitle') : t('common.offlineTitle')}
			</span>
			<span class="connectivity-detail">{t('common.connectionErrorDetail')}</span>
		</div>
		<button type="button" class="connectivity-reload" onclick={reload}>
			<i class="ti ti-refresh" aria-hidden="true"></i>
			{t('common.reload')}
		</button>
	</div>
{/if}

<style>
	.connectivity-overlay {
		position: fixed;
		inset: 0;
		background: rgba(11, 37, 64, 0.35);
		z-index: 998;
	}

	.connectivity-banner {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 999;
		background: var(--navy);
		color: #fff;
		border-bottom: 3px solid var(--red);
		padding: 12px 20px;
		display: flex;
		align-items: center;
		gap: 12px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
	}
	.connectivity-banner .ti-plug-connected-x {
		font-size: 22px;
		color: #f5a29a;
		flex-shrink: 0;
	}
	.connectivity-text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.connectivity-title {
		font-weight: 700;
		font-size: 13.5px;
	}
	.connectivity-detail {
		font-size: 11.5px;
		color: #b9cce2;
	}
	.connectivity-reload {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--blue);
		color: #fff;
		border: none;
		border-radius: var(--radius);
		padding: 8px 14px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.02em;
		cursor: pointer;
	}
	.connectivity-reload:hover {
		background: var(--blue-dark);
	}

	@media (max-width: 560px) {
		.connectivity-banner {
			flex-wrap: wrap;
		}
		.connectivity-reload {
			width: 100%;
			justify-content: center;
		}
	}
</style>
