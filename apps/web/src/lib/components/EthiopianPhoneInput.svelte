<script lang="ts">
	// Ethiopian mobile numbers only — the +251 segment is fixed (a real
	// <select>, not a disabled decoration, so it matches the look of every
	// other dropdown in the form even though there's only one entry to pick).
	// Whatever the person types — with a leading 0, a leading 251, spaces,
	// dashes — collapses to the same 9-digit national number and is emitted
	// as a single normalized "+251 9X XXX XXXX" string.
	let {
		id,
		value = $bindable(''),
		invalid = false
	}: { id: string; value: string; invalid?: boolean } = $props();

	function digitsOnly(raw: string): string {
		let d = raw.replace(/\D/g, '');
		if (d.startsWith('251')) d = d.slice(3);
		else if (d.startsWith('0')) d = d.slice(1);
		return d.slice(0, 9);
	}
	function format(d: string): string {
		return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 9)].filter(Boolean).join(' ');
	}

	const displayValue = $derived(format(digitsOnly(value)));

	function onInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const digits = digitsOnly(input.value);
		const formatted = format(digits);
		input.value = formatted;
		value = digits ? `+251 ${formatted}` : '';
	}
</script>

<div class="phone-input" class:invalid>
	<select class="phone-country" aria-label="Country code">
		<option>🇪🇹 +251</option>
	</select>
	<input
		{id}
		type="tel"
		class="phone-national"
		inputmode="numeric"
		value={displayValue}
		oninput={onInput}
		placeholder="91 234 5678"
		autocomplete="tel-national"
		aria-label="Phone number"
	/>
</div>

<style>
	.phone-input {
		display: flex;
		border: 1px solid var(--gray-300);
		border-radius: var(--radius);
		overflow: hidden;
		background: #fff;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.phone-input:focus-within {
		border-color: var(--blue);
		box-shadow: 0 0 0 3px rgba(21, 101, 192, 0.12);
	}
	.phone-input.invalid {
		border-color: var(--red);
	}
	.phone-country {
		/* app.css has a global `select{width:100%}` rule that applies to any
		   bare <select>, this one included — width:auto + a fixed flex-basis
		   overrides it explicitly rather than relying on property omission. */
		width: auto;
		flex: 0 0 auto;
		border: none;
		border-right: 1px solid var(--gray-200);
		background: var(--gray-100);
		font-size: 13px;
		font-family: var(--sans);
		color: var(--ink);
		padding: 10px 22px 10px 10px;
		cursor: pointer;
		appearance: none;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M0 0l5 6 5-6z' fill='%236B7280'/></svg>");
		background-repeat: no-repeat;
		background-position: right 8px center;
	}
	.phone-national {
		/* Same global input[type="tel"]{width:100%} rule — flex-basis:0 from
		   the flex shorthand normally wins, but set explicitly for clarity
		   and so this survives if the shorthand above ever changes. */
		width: auto;
		border: none;
		flex: 1 1 0;
		padding: 10px 12px;
		font-size: 14px;
		font-family: var(--sans);
		color: var(--ink);
		min-width: 0;
		outline: none;
	}
	.phone-national::placeholder {
		color: #a6acb8;
	}
</style>
