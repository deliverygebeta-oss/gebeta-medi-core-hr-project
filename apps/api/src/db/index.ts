import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const connectionString =
  process.env.DATABASE_URL ?? 'postgres://medicore:medicore@localhost:5433/medicore_hr';

export const sql = postgres(connectionString);
export const db = drizzle(sql, { schema });
