/**
 * One-time backfill: encrypts any employees.nationalId / contracts.{bankAccountNumber,
 * pensionNumber,tinNumber} that still hold plaintext from before field-level
 * encryption existed. Already-encrypted rows are detected and skipped, so
 * this is safe to run repeatedly (e.g. after restoring a mixed-state backup).
 *
 *   bun run db:backfill-encrypt
 */
import { eq } from 'drizzle-orm';
import { db, sql } from './index';
import { employees, contracts } from './schema';
import { encryptField, isEncrypted } from '../crypto-field';

async function backfillEmployees() {
  const rows = await db.select({ id: employees.id, nationalId: employees.nationalId }).from(employees);
  let updated = 0;
  for (const row of rows) {
    if (isEncrypted(row.nationalId)) continue;
    await db.update(employees).set({ nationalId: encryptField(row.nationalId) }).where(eq(employees.id, row.id));
    updated++;
  }
  console.log(`✔ employees.nationalId — encrypted ${updated} of ${rows.length} row(s)`);
}

async function backfillContracts() {
  const rows = await db
    .select({
      id: contracts.id,
      bankAccountNumber: contracts.bankAccountNumber,
      pensionNumber: contracts.pensionNumber,
      tinNumber: contracts.tinNumber
    })
    .from(contracts);

  let updated = 0;
  for (const row of rows) {
    const patch: Record<string, string> = {};
    if (!isEncrypted(row.bankAccountNumber)) patch.bankAccountNumber = encryptField(row.bankAccountNumber);
    if (!isEncrypted(row.pensionNumber)) patch.pensionNumber = encryptField(row.pensionNumber);
    if (!isEncrypted(row.tinNumber)) patch.tinNumber = encryptField(row.tinNumber);
    if (Object.keys(patch).length === 0) continue;
    await db.update(contracts).set(patch).where(eq(contracts.id, row.id));
    updated++;
  }
  console.log(`✔ contracts (bank/pension/TIN) — touched ${updated} of ${rows.length} row(s)`);
}

if (import.meta.main) {
  await backfillEmployees();
  await backfillContracts();
  console.log('Backfill complete.');
  await sql.end();
}
