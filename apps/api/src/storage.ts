/**
 * Employee document file bucket.
 *
 * Files live under HR-EMP-FILE/, one folder per employee named
 * "<EmployeeCode>_<Employee Name>" (e.g. HR-EMP-FILE/HRM-2026-0001_Helen_Worku/),
 * so the bucket is browsable by humans and portable to S3-style storage later.
 */
import { join, extname } from 'node:path';
import { mkdir, readdir, rm } from 'node:fs/promises';

export const BUCKET_ROOT =
  process.env.FILE_BUCKET_DIR ?? join(process.cwd(), 'HR-EMP-FILE');

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

/**
 * Signature (magic-number) checks for each allowed type, keyed by the
 * Content-Type the client claims. The client's declared MIME type is never
 * trusted on its own — a renamed file with a spoofed Content-Type header
 * would otherwise sail past the allowlist above.
 */
const SIGNATURE_CHECKS: Record<string, (head: Uint8Array) => boolean> = {
  'application/pdf': (h) => startsWithAscii(h, '%PDF-'),
  'image/jpeg': (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  'image/png': (h) =>
    h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 && h[4] === 0x0d && h[5] === 0x0a,
  'image/webp': (h) => startsWithAscii(h, 'RIFF') && startsWithAscii(h.slice(8), 'WEBP')
};

function startsWithAscii(bytes: Uint8Array, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

async function matchesDeclaredType(file: File): Promise<boolean> {
  const check = SIGNATURE_CHECKS[file.type];
  if (!check) return false;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return check(head);
}

const sanitize = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');

/** Strips characters that could break out of a quoted Content-Disposition parameter. */
export const sanitizeHeaderFilename = (name: string) =>
  name.replace(/["\r\n]/g, '').slice(0, 200) || 'document';

export function employeeFolder(employeeCode: string, fullName: string): string {
  return `${employeeCode}_${sanitize(fullName)}`;
}

export interface StoredFile {
  fileName: string;
  filePath: string; // relative to BUCKET_ROOT
  mimeType: string;
  fileSize: number;
}

export async function saveDocumentFile(
  employeeCode: string,
  fullName: string,
  docType: string,
  file: File
): Promise<StoredFile> {
  if (file.size === 0) throw new StorageError('The selected file is empty');
  if (file.size > MAX_FILE_BYTES) throw new StorageError('File is larger than 10 MB');
  if (!ALLOWED_MIME.has(file.type)) {
    throw new StorageError('Only PDF, JPEG, PNG or WebP files are accepted');
  }
  if (!(await matchesDeclaredType(file))) {
    throw new StorageError(
      'This file does not look like a valid PDF or image — it may be corrupted or mislabeled'
    );
  }

  const folder = employeeFolder(employeeCode, fullName);
  const ext = extname(file.name) || '.' + (file.type.split('/')[1] ?? 'bin');
  const fileName = `${sanitize(docType)}${ext}`;
  const relPath = join(folder, fileName);
  const absDir = join(BUCKET_ROOT, folder);

  await mkdir(absDir, { recursive: true });
  await Bun.write(join(BUCKET_ROOT, relPath), file);

  return { fileName: file.name, filePath: relPath, mimeType: file.type, fileSize: file.size };
}

export function documentFile(relPath: string) {
  return Bun.file(join(BUCKET_ROOT, relPath));
}

/**
 * Removes every folder belonging to an employee. Matches by the employee-code
 * prefix rather than the current name — a renamed employee may have files in a
 * folder created under their old name.
 */
export async function deleteEmployeeFolders(employeeCode: string) {
  const entries = await readdir(BUCKET_ROOT).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((e) => e.startsWith(employeeCode + '_'))
      .map((e) => rm(join(BUCKET_ROOT, e), { recursive: true, force: true }))
  );
}

export class StorageError extends Error {}
