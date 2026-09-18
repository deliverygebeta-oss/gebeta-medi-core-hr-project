<script lang="ts">
	import { toEC, MonthGrid, monthNames } from 'kenat';
	import { i18n, t } from '$lib/i18n';

	let {
		value = $bindable(''),
		id,
		disabled = false,
		readonly = false,
		placeholder,
		min,
		max
	}: {
		value?: string;
		id?: string;
		disabled?: boolean;
		readonly?: boolean;
		placeholder?: string;
		min?: string;
		max?: string;
	} = $props();

	interface DayCell {
		ethiopian: { year: number; month: number; day: number };
		gregorian: { year: number; month: number; day: number };
		weekday: number;
		weekdayName: string;
		isToday: boolean;
	}

	let rootEl: HTMLDivElement | undefined = $state();
	let open = $state(false);
	let viewYear = $state(0);
	let viewMonth = $state(0);

	function isoToParts(iso: string): { y: number; m: number; d: number } | null {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
		if (!match) return null;
		return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
	}
	function partsToIso(y: number, m: number, d: number): string {
		return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}
	function todayGregorianParts() {
		const now = new Date();
		return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
	}

	const ethSelected = $derived.by(() => {
		const g = isoToParts(value);
		if (!g) return null;
		try {
			return toEC(g.y, g.m, g.d);
		} catch {
			return null;
		}
	});

	const monthLabel = $derived(monthNames[i18n.locale === 'am' ? 'amharic' : 'english'][viewMonth - 1] ?? '');

	const grid = $derived.by(() => {
		if (!viewYear || !viewMonth) return null;
		return MonthGrid.create({
			year: viewYear,
			month: viewMonth,
			weekdayLang: i18n.locale === 'am' ? 'amharic' : 'english',
			useGeez: false
		}) as { headers: string[]; days: (DayCell | null)[] };
	});

	function seedView() {
		if (ethSelected) {
			viewYear = ethSelected.year;
			viewMonth = ethSelected.month;
		} else {
			try {
				const g = todayGregorianParts();
				const eth = toEC(g.y, g.m, g.d);
				viewYear = eth.year;
				viewMonth = eth.month;
			} catch {
				viewYear = 2017;
				viewMonth = 1;
			}
		}
	}

	function togglePopover() {
		if (disabled || readonly) return;
		if (!open) seedView();
		open = !open;
	}

	function stepMonth(delta: number) {
		let m = viewMonth + delta;
		let y = viewYear;
		if (m > 13) {
			m = 1;
			y++;
		} else if (m < 1) {
			m = 13;
			y--;
		}
		viewMonth = m;
		viewYear = y;
	}

	function isoOf(cell: DayCell) {
		return partsToIso(cell.gregorian.year, cell.gregorian.month, cell.gregorian.day);
	}

	function isOutOfRange(cell: DayCell) {
		const iso = isoOf(cell);
		if (min && iso < min) return true;
		if (max && iso > max) return true;
		return false;
	}

	function isSelected(cell: DayCell) {
		return (
			!!ethSelected &&
			ethSelected.year === cell.ethiopian.year &&
			ethSelected.month === cell.ethiopian.month &&
			ethSelected.day === cell.ethiopian.day
		);
	}

	function pickDay(cell: DayCell | null) {
		if (!cell || isOutOfRange(cell)) return;
		value = isoOf(cell);
		open = false;
	}

	function jumpToday() {
		const g = todayGregorianParts();
		const iso = partsToIso(g.y, g.m, g.d);
		if ((min && iso < min) || (max && iso > max)) return;
		value = iso;
		const eth = toEC(g.y, g.m, g.d);
		viewYear = eth.year;
		viewMonth = eth.month;
	}

	const displayText = $derived.by(() => {
		if (!ethSelected) return '';
		const names = monthNames[i18n.locale === 'am' ? 'amharic' : 'english'];
		return `${ethSelected.day} ${names[ethSelected.month - 1]} ${ethSelected.year}`;
	});

	function handleDocClick(e: MouseEvent) {
		if (open && rootEl && !rootEl.contains(e.target as Node)) open = false;
	}
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
</script>

<svelte:document onclick={handleDocClick} onkeydown={handleKeydown} />

<div class="eth-date-wrap" bind:this={rootEl}>
	<button
		type="button"
		{id}
		class="eth-date-trigger"
		class:readonly-look={readonly}
		{disabled}
		onclick={togglePopover}
	>
		<span class="eth-date-text" class:placeholder={!displayText}>
			{displayText || placeholder || t('datePicker.selectDate')}
		</span>
		{#if !readonly}
			<i class="ti ti-calendar" aria-hidden="true"></i>
		{/if}
	</button>
	{#if value}
		<div class="eth-date-greg">{t('datePicker.gregorianEquivalent', { date: value })}</div>
	{/if}

	{#if open && grid}
		<div class="eth-date-popover" role="dialog" aria-label={t('datePicker.selectDate')}>
			<div class="eth-date-head">
				<button type="button" class="icon-btn" onclick={() => stepMonth(-1)} aria-label="Previous month">
					<i class="ti ti-chevron-left" aria-hidden="true"></i>
				</button>
				<div class="eth-date-head-mid">
					<span class="eth-date-month">{monthLabel}</span>
					<input
						type="number"
						class="eth-date-year"
						bind:value={viewYear}
						aria-label={t('datePicker.year')}
					/>
				</div>
				<button type="button" class="icon-btn" onclick={() => stepMonth(1)} aria-label="Next month">
					<i class="ti ti-chevron-right" aria-hidden="true"></i>
				</button>
			</div>

			<div class="eth-date-weekdays">
				{#each grid.headers as h (h)}
					<span>{h}</span>
				{/each}
			</div>

			<div class="eth-date-grid">
				{#each grid.days as cell, i (i)}
					{#if cell}
						<button
							type="button"
							class="eth-date-cell"
							class:today={cell.isToday}
							class:selected={isSelected(cell)}
							disabled={isOutOfRange(cell)}
							onclick={() => pickDay(cell)}
							title={cell.weekdayName}
						>
							{cell.ethiopian.day}
						</button>
					{:else}
						<span class="eth-date-cell empty"></span>
					{/if}
				{/each}
			</div>

			<button type="button" class="eth-date-today-btn" onclick={jumpToday}>
				<i class="ti ti-point-filled" aria-hidden="true"></i> {t('datePicker.today')}
			</button>
		</div>
	{/if}
</div>

<style>
	.eth-date-wrap {
		position: relative;
		width: 100%;
	}
	.eth-date-trigger {
		border: 1px solid var(--gray-300);
		border-radius: var(--radius);
		padding: 10px 12px;
		font-size: 14px;
		font-family: var(--sans);
		color: var(--ink);
		background: #fff;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		cursor: pointer;
		text-align: left;
	}
	.eth-date-trigger:hover:not(:disabled) {
		border-color: var(--blue);
	}
	.eth-date-trigger:focus-visible {
		outline: none;
		border-color: var(--blue);
		box-shadow: 0 0 0 3px rgba(21, 101, 192, 0.12);
	}
	.eth-date-trigger:disabled,
	.eth-date-trigger.readonly-look {
		background: var(--gray-100);
		color: var(--gray-500);
		cursor: not-allowed;
	}
	.eth-date-trigger .ti-calendar {
		color: var(--gray-500);
		font-size: 15px;
		flex-shrink: 0;
	}
	.eth-date-text.placeholder {
		color: #a6acb8;
	}
	.eth-date-greg {
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--gray-500);
		margin-top: 4px;
	}

	.eth-date-popover {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 60;
		background: #fff;
		border: 1px solid var(--gray-300);
		border-radius: var(--radius);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
		padding: 14px;
		width: 280px;
	}
	.eth-date-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
	}
	.eth-date-head-mid {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.eth-date-month {
		font-weight: 700;
		font-size: 13px;
		color: var(--navy);
	}
	.eth-date-year {
		width: 62px;
		border: 1px solid var(--gray-300);
		border-radius: var(--radius);
		font-family: var(--mono);
		font-size: 12px;
		padding: 3px 5px;
		text-align: center;
	}
	.eth-date-weekdays {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		margin-bottom: 4px;
	}
	.eth-date-weekdays span {
		text-align: center;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.04em;
		color: var(--gray-500);
		text-transform: uppercase;
	}
	.eth-date-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}
	.eth-date-cell {
		aspect-ratio: 1;
		border: none;
		background: transparent;
		border-radius: 4px;
		font-size: 12.5px;
		color: var(--ink);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.eth-date-cell:hover:not(:disabled) {
		background: var(--gray-100);
	}
	.eth-date-cell.today {
		border: 1px solid var(--blue);
	}
	.eth-date-cell.selected {
		background: var(--blue);
		color: #fff;
		font-weight: 700;
	}
	.eth-date-cell:disabled {
		color: var(--gray-300);
		cursor: not-allowed;
	}
	.eth-date-cell.empty {
		cursor: default;
	}
	.eth-date-today-btn {
		width: 100%;
		margin-top: 10px;
		background: none;
		border: 1px dashed var(--gray-300);
		border-radius: var(--radius);
		padding: 6px;
		font-family: var(--mono);
		font-size: 10.5px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--blue-dark);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
	}
	.eth-date-today-btn:hover {
		background: #eaf1fb;
	}
</style>
