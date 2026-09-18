/**
 * HR officer seed data. Idempotent: existing usernames are skipped, only
 * missing accounts are inserted. Runs automatically on server start, or
 * manually via `bun run db:seed`.
 */
import { db } from './index';
import { hrOfficers } from './schema';

const DEFAULT_OFFICERS = [
  {
    username: 'abebe.g',
    password: 'Medicore@2026',
    fullName: 'Abebe G.',
    role: 'hr_officer' as const
  },
  {
    username: 'selam.t',
    password: 'Medicore@2026',
    fullName: 'Selam T.',
    role: 'hr_officer' as const
  },
  {
    username: 'admin',
    password: 'Admin@2026',
    fullName: 'System Administrator',
    role: 'admin' as const
  },
  {
    username: 'viewer',
    password: 'Viewer@2026',
    fullName: 'Compliance Viewer',
    role: 'viewer' as const
  }
];

export async function seedOfficers(verbose = false) {
  for (const o of DEFAULT_OFFICERS) {
    const passwordHash = await Bun.password.hash(o.password); // argon2id
    const inserted = await db
      .insert(hrOfficers)
      .values({ username: o.username, passwordHash, fullName: o.fullName, role: o.role })
      .onConflictDoNothing({ target: hrOfficers.username })
      .returning({ id: hrOfficers.id });

    if (inserted.length > 0) {
      console.log(`✔ Seeded officer ${o.username} (${o.role}) — password: ${o.password}`);
    } else if (verbose) {
      console.log(`• ${o.username} already exists — skipped`);
    }
  }
}

if (import.meta.main) {
  const { sql } = await import('./index');
  await seedOfficers(true);
  console.log('Seed complete.');
  await sql.end();
}
