import { readFileSync } from 'fs';
import path from 'path';
import { Pool } from 'pg';

const sqlFile = (name: string) => readFileSync(path.join(__dirname, '..', '..', 'db', name), 'utf8');

export function createPool(databaseUrl: string): Pool {
  if (!databaseUrl) throw new Error('DATABASE_URL is required when STORAGE=postgres');
  return new Pool({ connectionString: databaseUrl, max: 10 });
}

/** Creates tables if missing. Retries while the DB container is still starting. */
export async function migrate(pool: Pool, attempts = 15): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query(sqlFile('schema.sql'));
      return;
    } catch (e) {
      if (i >= attempts) throw e;
      console.log(`[db] not ready (${(e as Error).message}), retry ${i}/${attempts}...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function seed(pool: Pool): Promise<void> {
  await pool.query(sqlFile('seed.sql'));
}
