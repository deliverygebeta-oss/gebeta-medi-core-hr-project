<script lang="ts">
	import { toasts } from '$lib/toast.svelte';

	const icons = { success: 'ti-circle-check', info: 'ti-arrow-right', error: 'ti-alert-circle' };
</script>

<div class="toast-stack">
	{#each toasts as toast (toast.id)}
		<div class="toast {toast.type}" class:leaving={toast.leaving}>
			<span class="ti-wrap"><i class="ti {icons[toast.type]}" aria-hidden="true"></i></span>
			<div class="txt">
				<div class="ttl">{toast.title}</div>
				<div class="sub">{toast.sub}</div>
			</div>
		</div>
	{/each}
</div>
