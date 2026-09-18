import { describe, expect, test, beforeAll } from 'bun:test';

// crypto-field.ts throws at import time if ENCRYPTION_KEY isn't set, so seed
// a throwaway one before the module loads if the test env didn't provide one.
beforeAll(() => {
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  }
});

const { encryptField, decryptField, maskTail } = await import('../src/crypto-field');

describe('encryptField / decryptField', () => {
  test('round-trips plaintext', () => {
    const plaintext = 'KEB-04-118827';
    const encrypted = encryptField(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptField(encrypted)).toBe(plaintext);
  });

  test('two encryptions of the same value produce different ciphertext (random IV)', () => {
    const a = encryptField('same-value');
    const b = encryptField('same-value');
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe('same-value');
    expect(decryptField(b)).toBe('same-value');
  });

  test('tampered ciphertext fails to decrypt instead of returning garbage', () => {
    const encrypted = encryptField('POEPF-882910');
    const buf = Buffer.from(encrypted, 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a byte in the ciphertext
    const tampered = buf.toString('base64');
    expect(() => decryptField(tampered)).toThrow();
  });

  test('handles empty and unicode strings', () => {
    expect(decryptField(encryptField(''))).toBe('');
    expect(decryptField(encryptField('ሄለን ወርቁ'))).toBe('ሄለን ወርቁ');
  });
});

describe('maskTail', () => {
  test('keeps last 4 characters by default', () => {
    expect(maskTail('1000123456789')).toBe('*********6789');
  });

  test('masks entirely when value is shorter than keep length', () => {
    expect(maskTail('abc', 4)).toBe('***');
  });

  test('supports a custom keep length', () => {
    expect(maskTail('KEB-04-118827', 2)).toBe('***********27');
  });
});
