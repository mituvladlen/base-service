/**
 * Integration test against a real PostgreSQL. Skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5434/base_test npx jest postgres
 */
import { Pool } from 'pg';
import { migrate, seed } from '../src/db/pool';
import { PostgresBaseRepository } from '../src/repositories/postgresBaseRepository';
import { BaseService } from '../src/services/baseService';
import { MockPlayerClient } from '../src/clients/playerClient';
import { MockWorldClient } from '../src/clients/worldClient';
import { MockResourceClient } from '../src/clients/resourceClient';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('PostgresBaseRepository', () => {
  let pool: Pool;
  let svc: BaseService;
  let resources: MockResourceClient;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS base_actions, bases');
    await migrate(pool);
    await seed(pool);
    await seed(pool); // second run is a no-op
    resources = new MockResourceClient(1000);
    svc = new BaseService(new PostgresBaseRepository(pool), new MockPlayerClient(['player-1', 'player-2', 'player-3', 'player-4']), new MockWorldClient(), resources, {
      kikiCooldownSeconds: 0
    });
  });
  afterAll(() => pool.end());

  it('seeded one FAF Cab per player, exactly once', async () => {
    const bases = await svc.list();
    expect(bases.map((b) => b.playerId)).toEqual(['player-1', 'player-2', 'player-3']);
    expect(bases[0]).toMatchObject({ roomId: 'FAF_CAB', level: 1, storageCapacity: 100, kiki: { mood: 50 } });
  });

  it('create / rename / delete / unique player', async () => {
    const b = await svc.createBase({ playerId: 'player-4' });
    await expect(svc.createBase({ playerId: 'player-4' })).rejects.toMatchObject({ status: 409 });
    expect((await svc.rename(b.id, 'Hideout')).name).toBe('Hideout');
    expect((await svc.getByPlayer('player-4')).id).toBe(b.id);
    await svc.remove(b.id);
    await expect(svc.get(b.id)).rejects.toMatchObject({ status: 404 });
  });

  it('concurrent retries of one upgrade apply once (row lock + ledger)', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => svc.upgrade('base-player-1', 'pg-up-1')));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect((await svc.get('base-player-1')).level).toBe(2);
    await expect(svc.expandStorage('base-player-1', 'pg-up-1')).rejects.toMatchObject({ code: 'ACTION_ID_REUSED' });
    await expect(svc.upgrade('base-player-2', 'pg-up-1')).rejects.toMatchObject({ code: 'ACTION_ID_REUSED' });
  });

  it('concurrent different upgrades serialize correctly', async () => {
    await Promise.all([svc.upgrade('base-player-3', 'a'), svc.upgrade('base-player-3', 'b'), svc.upgrade('base-player-3', 'c')]);
    expect((await svc.get('base-player-3')).level).toBe(4);
  });

  it('rolls back when resources are missing', async () => {
    resources.setBalance('player-2', 'wood', 0);
    await expect(svc.buildBarricade('base-player-2', 'pg-bar', 'FAF_CAB')).rejects.toMatchObject({ code: 'INSUFFICIENT_RESOURCES' });
    expect((await svc.get('base-player-2')).barricades).toEqual([]);
    resources.setBalance('player-2', 'wood', 100);
    const ok = await svc.buildBarricade('base-player-2', 'pg-bar', 'FAF_CAB');
    const again = await svc.buildBarricade('base-player-2', 'pg-bar', 'FAF_CAB');
    expect(again.duplicate).toBe(true);
    expect(again.result).toEqual(ok.result);
  });

  it('persists nested state (facilities, decorations, kiki boosters)', async () => {
    await svc.buildFacility('base-player-2', 'pg-f', 'KITCHEN');
    const deco = await svc.addDecoration('base-player-2', 'pg-d', 'FAF_BANNER');
    await svc.interactWithKiki('base-player-2', 'pg-k', 'FEED');
    const b = await svc.get('base-player-2');
    expect(b.facilities[0].type).toBe('KITCHEN');
    expect(b.decorations[0].id).toBe((deco.result.decoration as { id: string }).id);
    expect(b.kiki.interactions).toBe(1);
    await expect(svc.upgrade('nope', 'pg-x')).rejects.toMatchObject({ status: 404 });
  });
});
