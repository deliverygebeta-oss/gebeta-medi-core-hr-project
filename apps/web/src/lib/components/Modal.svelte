<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		sub = '',
		size = 'lg',
		onClose,
		children
	}: {
		title: string;
		sub?: string;
		size?: 'lg' | 'sm';
		onClose: () => void;
		children: Snippet;
	} = $props();
</script>

<!-- Deliberately static: clicking the backdrop or pressing Escape never closes
     the modal — half-filled onboarding forms are only dismissed via the X. -->
<div class="modal-overlay" role="presentation">
	<div class="modal-box" class:sm={size === 'sm'} role="dialog" aria-modal="true" aria-label={title}>
		<div class="modal-head">
			<div>
				<div class="m-title">{title}</div>
				{#if sub}<div class="m-sub">{sub}</div>{/if}
			</div>
			<button class="modal-close" onclick={onClose} aria-label="Close" title="Close">
				<i class="ti ti-x" aria-hidden="true"></i>
			</button>
		</div>
		<div class="modal-body">
			{@render children()}
		</div>
	</div>
</div>
