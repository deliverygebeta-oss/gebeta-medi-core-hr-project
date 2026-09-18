import { browser } from '$app/environment';
import { en, type Dict } from './en';
import { am } from './am';

export type Locale = 'en' | 'am';

const dicts: Record<Locale, Dict> = { en, am };
const STORAGE_KEY = 'medicore_locale';

function initialLocale(): Locale {
	if (!browser) return 'en';
	const saved = localStorage.getItem(STORAGE_KEY);
	return saved === 'am' ? 'am' : 'en';
}

/** Reactive current locale — read/write from anywhere, template updates follow. */
export const i18n = $state<{ locale: Locale }>({ locale: initialLocale() });

export function setLocale(l: Locale) {
	i18n.locale = l;
	if (browser) localStorage.setItem(STORAGE_KEY, l);
}

function lookup(dict: Dict, path: string): string | undefined {
	return path.split('.').reduce<unknown>((node, key) => {
		return node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined;
	}, dict) as string | undefined;
}

/**
 * Translate a dot-path key, e.g. t('wizard.fDob'). Falls back to English if
 * the active locale is missing the key, then to the key itself so a typo is
 * visible instead of silently blank.
 * Optional `vars` interpolates {{name}} placeholders, e.g.
 * t('list.showingRecords', { shown: 5, total: 12, plural: 's' }).
 */
export function t(key: string, vars?: Record<string, string | number>): string {
	const dict = dicts[i18n.locale];
	let str = lookup(dict, key) ?? lookup(en, key) ?? key;
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			str = str.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
		}
	}
	return str;
}
