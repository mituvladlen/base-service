import { loadConfig } from './config';
import { createApp } from './app';
import { BaseService } from './services/baseService';
import { BaseRepository } from './repositories/baseRepository';
import { MemoryBaseRepository } from './repositories/memoryBaseRepository';
import { PostgresBaseRepository } from './repositories/postgresBaseRepository';
import { HttpPlayerClient, MockPlayerClient } from './clients/playerClient';
import { HttpWorldClient, MockWorldClient } from './clients/worldClient';
import { HttpResourceClient, MockResourceClient } from './clients/resourceClient';
import { createPool, migrate, seed } from './db/pool';

async function main() {
  const cfg = loadConfig();
  const players = cfg.playerClient === 'http' ? new HttpPlayerClient(cfg.playerServiceUrl) : new MockPlayerClient(cfg.mockPlayers);
  const world = cfg.worldClient === 'http' ? new HttpWorldClient(cfg.worldServiceUrl) : new MockWorldClient();
  const resources = cfg.resourceClient === 'http' ? new HttpResourceClient(cfg.resourceServiceUrl) : new MockResourceClient();

  let repo: BaseRepository;
  if (cfg.storage === 'postgres') {
    const pool = createPool(cfg.databaseUrl);
    await migrate(pool);
    await seed(pool); // no-op when the DB already has data
    repo = new PostgresBaseRepository(pool);
  } else {
    repo = new MemoryBaseRepository();
  }

  const svc = new BaseService(repo, players, world, resources, { kikiCooldownSeconds: cfg.kikiCooldownSeconds });
  if (cfg.storage === 'memory') {
    // Same starting data as db/seed.sql: one FAF Cab base for player-1..3.
    for (const playerId of ['player-1', 'player-2', 'player-3']) await svc.createBase({ playerId }, `base-${playerId}`);
  }

  createApp(svc).listen(cfg.port, () =>
    console.log(
      `[base-service] listening on :${cfg.port} (storage=${cfg.storage}, player=${cfg.playerClient}, world=${cfg.worldClient}, resource=${cfg.resourceClient})`
    )
  );
}

main().catch((e) => {
  console.error('[base-service] failed to start:', e);
  process.exit(1);
});
