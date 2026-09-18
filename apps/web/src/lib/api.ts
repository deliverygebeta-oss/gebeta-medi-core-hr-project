import { goto } from '$app/navigation';
import {
	clearSession,
	getAccessToken,
	getRefreshToken,
	setSession,
	setTokens,
	type Officer
} from '$lib/auth.svelte';
import { apiUrl } from '$lib/apiBase';

export interface EmployeeSummary {
	id: number;
	employeeCode: string;
	fullNameLatin: string;
	role: string;
	department: string;
	employmentStatus: string;
	onboardingStatus: 'in_progress' | 'docs_pending' | 'completed';
	contractType: string | null;
	createdAt: string;
	docsTotal: number;
	docsVerified: number;
}

export interface EmployeeDocument {
	id: number;
	docType: string;
	status: 'pending' | 'received' | 'verified';
	fileAttached: boolean;
	fileName: string | null;
	filePath: string | null;
	mimeType: string | null;
	fileSize: number | null;
}

export interface EmployeeDetail {
	id: number;
	employeeCode: string;
	fullNameLatin: string;
	fullNameAmharic: string | null;
	nationalId: string;
	dob: string;
	phone: string;
	email: string | null;
	gender: string | null;
	employmentType: string;
	department: string;
	jobCategory: string;
	role: string;
	eduQualification: string | null;
	jobGrade: string | null;
	employmentStatus: string;
	onboardingStatus: 'in_progress' | 'docs_pending' | 'completed';
	handbookIssued: boolean;
	conductSigned: boolean;
	createdAt: string;
	credential: Record<string, unknown> | null;
	contract: {
		contractType: string;
		hireDate: string;
		probationEndDate: string | null;
		contractEndDate: string | null;
		baseSalaryEtb: string;
		riskAllowance: string | null;
		bankName: string;
		bankAccountNumber: string;
		pensionNumber: string;
		tinNumber: string;
	} | null;
	documents: EmployeeDocument[];
	emergencyContacts: { name: string; relationship: string; phone: string }[];
	registrar: { id: number; username: string; fullName: string } | null;
}

export interface Stats {
	total: number;
	completed: number;
	docsPending: number;
	inProgress: number;
}

// Serializes concurrent refreshes: if five requests all 401 at once, only
// the first one hits /api/auth/refresh — the rest await the same promise
// instead of racing to rotate the single-use refresh token against each other.
let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
	const refreshToken = getRefreshToken();
	if (!refreshToken) return false;
	try {
		const res = await fetch(apiUrl('/api/auth/refresh'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ refreshToken })
		});
		if (!res.ok) return false;
		setTokens(await res.json());
		return true;
	} catch {
		return false;
	}
}

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
	const headers = new Headers(init.headers);
	// FormData bodies set their own multipart boundary — only JSON gets a content type.
	if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

	const accessToken = getAccessToken();
	if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

	return fetch(apiUrl(path), { ...init, headers });
}

async function fetchWithAuth(path: string, init: RequestInit): Promise<Response> {
	let res = await rawRequest(path, init);

	// The public employee upload portal (/api/upload-links/*) is never gated by
	// an HR officer session — its 401s mean "wrong last-4 digits," not "your
	// login expired." Redirecting an anonymous employee to the officer /login
	// page there would be a bug, not a security measure.
	const isOfficerRoute = !path.startsWith('/api/auth/login') && !path.startsWith('/api/upload-links');

	if (res.status === 401 && isOfficerRoute) {
		refreshInFlight ??= doRefresh().finally(() => {
			refreshInFlight = null;
		});
		const refreshed = await refreshInFlight;
		if (refreshed) {
			res = await rawRequest(path, init);
		}
		if (!refreshed || res.status === 401) {
			clearSession();
			goto('/login');
			throw new Error('Session expired — please sign in again');
		}
	}
	return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetchWithAuth(path, init);
	if (!res.ok) {
		let detail = res.statusText;
		try {
			const body = await res.json();
			detail = body.error ?? detail;
			if (body.issues) detail += ' — ' + JSON.stringify(body.issues.fieldErrors);
		} catch {
			/* keep statusText */
		}
		throw new Error(detail);
	}
	return res.json() as Promise<T>;
}

export async function login(username: string, password: string): Promise<Officer> {
	const { officer, accessToken, refreshToken } = await request<{
		officer: Officer;
		accessToken: string;
		refreshToken: string;
	}>('/api/auth/login', {
		method: 'POST',
		body: JSON.stringify({ username, password })
	});
	setSession(officer, { accessToken, refreshToken });
	return officer;
}

export async function logout(): Promise<void> {
	try {
		await request('/api/auth/logout', { method: 'POST' });
	} finally {
		clearSession();
	}
}

export const fetchStats = () => request<Stats>('/api/employees/stats');

export const fetchEmployees = () => request<EmployeeSummary[]>('/api/employees');

export const fetchEmployee = (id: number | string) => request<EmployeeDetail>(`/api/employees/${id}`);

export async function fetchNextCode(): Promise<string> {
	const { employeeCode } = await request<{ employeeCode: string }>('/api/employees/next-code');
	return employeeCode;
}

export const createEmployee = (payload: unknown) =>
	request<EmployeeSummary>('/api/employees', { method: 'POST', body: JSON.stringify(payload) });

export const patchDocument = (
	employeeId: number,
	docId: number,
	patch: Partial<Pick<EmployeeDocument, 'status' | 'fileAttached'>>
) =>
	request<{ document: EmployeeDocument; onboardingStatus: EmployeeSummary['onboardingStatus'] }>(
		`/api/employees/${employeeId}/documents/${docId}`,
		{ method: 'PATCH', body: JSON.stringify(patch) }
	);

export function uploadDocumentFile(employeeId: number, docId: number, file: File) {
	const form = new FormData();
	form.append('file', file);
	return request<EmployeeDocument>(`/api/employees/${employeeId}/documents/${docId}/file`, {
		method: 'POST',
		body: form
	});
}

/** Fetches the file (Authorization header attached automatically) and hands it to the browser as a download. */
export async function downloadDocumentFile(employeeId: number, docId: number, fileName: string) {
	const res = await fetchWithAuth(`/api/employees/${employeeId}/documents/${docId}/file`, {});
	if (!res.ok) throw new Error('Could not download the file');
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.click();
	URL.revokeObjectURL(url);
}

export const updateEmployee = (id: number, patch: unknown) =>
	request<EmployeeDetail>(`/api/employees/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteEmployee = (id: number) =>
	request<{ deleted: boolean; employeeCode: string }>(`/api/employees/${id}`, { method: 'DELETE' });

// ── Self-Service Upload Link helpers ────────────────────────────────────────

export interface UploadLinkMeta {
	token: string;
	expiresAt: string;
	url: string;
}

export interface DocumentRecord {
	id: number;
	docType: string;
	status: string;
	fileAttached: boolean;
	fileName: string | null;
	fileSize: number | null;
	updatedAt: string;
}

export interface VerifyResult {
	verified: true;
	employee: {
		id: number;
		employeeCode: string;
		fullNameLatin: string;
		fullNameAmharic: string;
		department: string;
		role: string;
	};
	documents: DocumentRecord[];
	expiresAt: string;
}

/** HR: generate / renew the unique upload link for an employee */
export const generateUploadLink = (employeeId: number) =>
	request<UploadLinkMeta>(`/api/employees/${employeeId}/upload-link`, { method: 'POST' });

/** Employee portal: verify identity using last 4 digits of employee code */
export const verifyUploadLink = (token: string, last4: string) =>
	request<VerifyResult>(`/api/upload-links/${token}/verify`, {
		method: 'POST',
		body: JSON.stringify({ last4 })
	});

/**
 * Employee portal: upload a file for a specific document. last4 travels with
 * every call, not just the initial verify — the server re-checks it each time.
 */
export const uploadEmployeeFile = async (
	token: string,
	docId: number,
	file: File,
	last4: string
): Promise<DocumentRecord> => {
	const form = new FormData();
	form.append('file', file);
	form.append('last4', last4);
	const res = await fetch(apiUrl(`/api/upload-links/${token}/documents/${docId}/file`), {
		method: 'POST',
		body: form
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(err.error ?? 'Upload failed');
	}
	return res.json();
};

/** Employee portal: poll for latest document statuses */
export const pollUploadStatus = (token: string, last4: string) =>
	request<{
		employee: { fullNameLatin: string; onboardingStatus: string };
		documents: DocumentRecord[];
		expiresAt: string;
	}>(`/api/upload-links/${token}/status?last4=${encodeURIComponent(last4)}`);
