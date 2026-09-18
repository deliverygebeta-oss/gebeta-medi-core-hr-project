import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { connectionString } from './index';
import { seedOfficers } from './seed';

/**
 * Runs on server start: applies any pending migrations (already-applied ones
 * are skipped via drizzle's journal table), then inserts missing seed rows
 * (existing data is never touched).
 */
export async function bootstrapDatabase() {
  // Auto-migrating on every boot is convenient for local dev but risky once
  // there's more than one instance, or a production DB no one wants touched
  // without a deliberate step. Default stays "on" so nothing already
  // deployed breaks; set AUTO_MIGRATE=false to require `bun run db:migrate`
  // as an explicit, separate action instead.
  if (process.env.AUTO_MIGRATE === 'false') {
    console.log('⚠ AUTO_MIGRATE=false — skipping automatic migrate/seed on boot.');
    return;
  }

  const client = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: join(import.meta.dir, '..', '..', 'drizzle')
    });
    console.log('✔ Database migrations up to date');
  } finally {
    await client.end();
  }
  await seedOfficers();
}
