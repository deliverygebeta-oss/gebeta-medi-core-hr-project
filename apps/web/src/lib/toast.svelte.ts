export interface Toast {
	id: number;
	title: string;
	sub: string;
	type: 'info' | 'success' | 'error';
	leaving: boolean;
}

let nextId = 0;

export const toasts = $state<Toast[]>([]);

export function showToast(title: string, sub: string, type: Toast['type'] = 'info') {
	const toast: Toast = { id: nextId++, title, sub, type, leaving: false };
	toasts.push(toast);
	setTimeout(() => {
		toast.leaving = true;
		setTimeout(() => {
			const i = toasts.findIndex((t) => t.id === toast.id);
			if (i !== -1) toasts.splice(i, 1);
		}, 220);
	}, 2600);
}
