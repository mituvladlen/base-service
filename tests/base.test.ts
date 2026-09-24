import request from 'supertest';
import { act, makeApp } from './helpers';

describe('base CRUD', () => {
  it('starts as the FAF Cab at level 1', async () => {
    const { app, base } = await makeApp();
    expect(base).toMatchObject({ playerId: 'player-1', name: 'FAF Cab', roomId: 'FAF_CAB', level: 1, storageCapacity: 100 });
    expect((await request(app).get(`/bases/${base.id}`)).body.id).toBe(base.id);
    expect((await request(app).get('/players/player-1/base')).body.id).toBe(base.id);
    expect((await request(app).get('/bases')).body).toHaveLength(1);
  });

  it('creates, renames and deletes bases', async () => {
    const { app } = await makeApp();
    const created = await request(app).post('/bases').send({ playerId: 'player-2', name: 'Bunker' });
    expect(created.status).toBe(201);
    expect((await request(app).post('/bases').send({ playerId: 'player-2' })).status).toBe(409);
    expect((await request(app).post('/bases').send({ playerId: 'ghost' })).body.error.code).toBe('PLAYER_NOT_FOUND');
    const renamed = await request(app).patch(`/bases/${created.body.id}`).send({ name: 'New name' });
    expect(renamed.body.name).toBe('New name');
    await request(app).delete(`/bases/${created.body.id}`).expect(204);
    expect((await request(app).get(`/bases/${created.body.id}`)).status).toBe(404);
    expect((await request(app).delete(`/bases/${created.body.id}`)).status).toBe(404);
    expect((await request(app).get('/players/player-2/base')).status).toBe(404);
    expect((await request(app).patch('/bases/nope').send({ name: 'x' })).status).toBe(404);
    expect((await request(app).patch(`/bases/nope`).send({})).status).toBe(400);
  });

  it('serves the catalog', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/catalog');
    expect(res.body.upgrades[0]).toEqual({
      fromLevel: 1,
      toLevel: 2,
      cost: [
        { resourceTypeId: 'wood', amount: 10 },
        { resourceTypeId: 'metal_scraps', amount: 5 },
        { resourceTypeId: 'paper', amount: 2 }
      ],
      storageBonus: 50
    });
    expect(res.body.facilities.map((f: { type: string }) => f.type)).toContain('GENERATOR');
  });
});

describe('upgrade', () => {
  it('charges the level cost and raises level + storage', async () => {
    const { app, base, resources } = await makeApp();
    const res = await request(app).post(`/bases/${base.id}/upgrade`).send({ actionId: 'up-1' });
    expect(res.status).toBe(201);
    expect(res.body.result).toMatchObject({ level: 2, storageCapacity: 150 });
    expect(resources.calls[0]).toEqual({
      actionId: 'base:up-1',
      playerId: 'player-1',
      reason: 'BASE_UPGRADE',
      items: [
        { resourceTypeId: 'wood', amount: 10 },
        { resourceTypeId: 'metal_scraps', amount: 5 },
        { resourceTypeId: 'paper', amount: 2 }
      ]
    });
    const second = await request(app).post(`/bases/${base.id}/upgrade`).send({ actionId: 'up-2' });
    expect(second.body.result.cost[0]).toEqual({ resourceTypeId: 'wood', amount: 20 }); // level 2 -> 3 costs double
    expect(resources.balance('player-1', 'wood')).toBe(1000 - 10 - 20);
  });

  it('is idempotent by actionId', async () => {
    const { app, base, resources } = await makeApp();
    await request(app).post(`/bases/${base.id}/upgrade`).send({ actionId: 'same' }).expect(201);
    const again = await request(app).post(`/bases/${base.id}/upgrade`).send({ actionId: 'same' });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.base.level).toBe(2);
    expect(resources.calls).toHaveLength(1);
  });

  it('handles concurrent retries of the same upgrade once', async () => {
    const { app, base, resources } = await makeApp();
    const results = await Promise.all(Array.from({ length: 4 }, () => request(app).post(`/bases/${base.id}/upgrade`).send({ actionId: 'race' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await request(app).get(`/bases/${base.id}`)).body.level).toBe(2);
    expect(resources.balance('player-1', 'wood')).toBe(990);
  });

  it('rejects when resources are missing and leaves the base unchanged', async () => {
    const { app, base, resources } = await makeApp();
    resources.setBalance('player-1', 'wood', 3);
    const res = await request(app).post(`/bases/${base.id}/upgrade`).send({ actionId: 'poor' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_RESOURCES');
    expect((await request(app).get(`/bases/${base.id}`)).body.level).toBe(1);
    // the actionId is not burned: once the player has wood the same action works
    resources.setBalance('player-1', 'wood', 50);
    await request(app).post(`/bases/${base.id}/upgrade`).send({ actionId: 'poor' }).expect(201);
  });

  it('stops at max level', async () => {
    const { app, base } = await makeApp();
    for (let i = 0; i < 4; i++) await request(app).post(`/bases/${base.id}/upgrade`).send({ actionId: act() }).expect(201);
    const res = await request(app).post(`/bases/${base.id}/upgrade`).send({ actionId: act() });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MAX_LEVEL_REACHED');
  });

  it('rejects actionId reuse for another operation, missing base and bad body', async () => {
    const { app, base } = await makeApp();
    await request(app).post(`/bases/${base.id}/upgrade`).send({ actionId: 'x1' });
    const reused = await request(app).post(`/bases/${base.id}/storage/expand`).send({ actionId: 'x1' });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('ACTION_ID_REUSED');
    expect((await request(app).post('/bases/nope/upgrade').send({ actionId: 'x2' })).status).toBe(404);
    expect((await request(app).post(`/bases/${base.id}/upgrade`).send({})).status).toBe(400);
  });
});
