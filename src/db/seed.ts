import { loadConfig } from '../config';
import { createPool, migrate, seed } from './pool';

/** `npm run seed` : create tables, then fill them only if the DB is empty. */
(async () => {
  const pool = createPool(loadConfig().databaseUrl);
  try {
    await migrate(pool);
    await seed(pool);
    console.log('[seed] done (skipped automatically if data already existed)');
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error('[seed] failed:', e);
  process.exit(1);
});
