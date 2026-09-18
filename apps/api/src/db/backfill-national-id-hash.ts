/**
 * One-time backfill: computes national_id_hash for employees registered
 * before the uniqueness check existed. Rows that already have a hash are
 * skipped, so this is safe to run repeatedly.
 *
 *   bun run db:backfill-national-id-hash
 */
import { eq, isNull } from 'drizzle-orm';
import { db, sql } from './index';
import { employees } from './schema';
import { decryptFieldSafe, hashField } from '../crypto-field';

async function backfill() {
  const rows = await db
    .select({ id: employees.id, nationalId: employees.nationalId })
    .from(employees)
    .where(isNull(employees.nationalIdHash));

  let updated = 0;
  for (const row of rows) {
    const plaintext = decryptFieldSafe(row.nationalId);
    try {
      await db.update(employees).set({ nationalIdHash: hashField(plaintext.trim()) }).where(eq(employees.id, row.id));
      updated++;
    } catch (err) {
      // Unique violation — this row's national ID duplicates one already
      // backfilled. Pre-existing dirty data; flag it instead of crashing.
      console.warn(`⚠ employee ${row.id} — national ID collides with an already-backfilled row, left unset:`, err);
    }
  }
  console.log(`✔ employees.nationalIdHash — backfilled ${updated} of ${rows.length} row(s)`);
}

if (import.meta.main) {
  await backfill();
  await sql.end();
}
