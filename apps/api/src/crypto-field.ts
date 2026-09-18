import { randomBytes, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';

/**
 * Field-level encryption for the handful of columns that are genuinely
 * sensitive (national ID, bank account, pension, TIN) — a compromise of the
 * database alone should not hand over that data in plaintext.
 *
 * AES-256-GCM: 12-byte random IV + 16-byte auth tag + ciphertext, all
 * concatenated and base64-encoded into one string. GCM's tag makes tampering
 * detectable (decrypt throws rather than silently returning garbage).
 */
const KEY_HEX = process.env.ENCRYPTION_KEY;
if (!KEY_HEX || KEY_HEX.length !== 64) {
  throw new Error(
    'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate one with: openssl rand -hex 32'
  );
}
const KEY = Buffer.from(KEY_HEX, 'hex');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptField(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Value is too short to be valid ciphertext');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** True if `encoded` decodes and authenticates as ciphertext produced by encryptField(). */
export function isEncrypted(encoded: string): boolean {
  try {
    decryptField(encoded);
    return true;
  } catch {
    return false;
  }
}

let warnedLegacyPlaintext = false;

/**
 * Tolerant read path: rows created before this feature existed still hold
 * raw plaintext in what's now an "encrypted" column. Rather than crash the
 * whole request (a real incident this caused), fall back to treating an
 * undecryptable value as legacy plaintext and return it unchanged — correct
 * for old rows, and harmless for genuinely corrupt ones since the same value
 * was already unreadable either way. Run the backfill script
 * (`bun run db:backfill-encrypt`) to actually encrypt these rows at rest.
 */
export function decryptFieldSafe(encoded: string): string {
  try {
    return decryptField(encoded);
  } catch {
    if (!warnedLegacyPlaintext) {
      warnedLegacyPlaintext = true;
      console.warn(
        '⚠ Found a value that is not valid encrypted ciphertext — treating it as legacy plaintext. ' +
          'Run `bun run db:backfill-encrypt` to encrypt pre-existing rows at rest.'
      );
    }
    return encoded;
  }
}

/** Masks all but the last `keep` characters, e.g. maskTail("KEB-04-118827") -> "*********9827". */
export function maskTail(value: string, keep = 4): string {
  if (value.length <= keep) return '*'.repeat(value.length);
  return '*'.repeat(value.length - keep) + value.slice(-keep);
}

/**
 * Deterministic HMAC-SHA256 "blind index" for values that are encrypted at
 * rest (so a plain `WHERE column = ?` can't work — the ciphertext differs
 * every time thanks to the random IV) but still need a uniqueness check —
 * e.g. rejecting a duplicate national ID. Keyed by ENCRYPTION_KEY so the
 * hash can't be reversed or correlated without that same secret.
 */
export function hashField(plaintext: string): string {
  return createHmac('sha256', KEY).update(plaintext, 'utf8').digest('hex');
}
