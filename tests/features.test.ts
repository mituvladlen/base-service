import request from 'supertest';
import { act, makeApp } from './helpers';

describe('barricades', () => {
  it('builds with the fixed cost, only in existing rooms', async () => {
    const { app, base, resources } = await makeApp();
    const res = await request(app).post(`/bases/${base.id}/barricades`).send({ actionId: 'b1', roomId: 'corridor-3' });
    expect(res.status).toBe(201);
    expect(res.body.result.cost).toEqual([
      { resourceTypeId: 'wood', amount: 5 },
      { resourceTypeId: 'metal_scraps', amount: 2 }
    ]);
    expect(res.body.result.barricade).toMatchObject({ roomId: 'corridor-3', level: 1, durability: 50 });
    expect(resources.calls[0].reason).toBe('BARRICADE');
    const missing = await request(app).post(`/bases/${base.id}/barricades`).send({ actionId: act(), roomId: 'narnia' });
    expect(missing.body.error.code).toBe('ROOM_NOT_FOUND');
    const twice = await request(app).post(`/bases/${base.id}/barricades`).send({ actionId: act(), roomId: 'corridor-3' });
    expect(twice.status).toBe(409);
    expect((await request(app).get(`/bases/${base.id}/barricades`)).body).toHaveLength(1);
  });

  it('limits barricades to baseLevel + 1', async () => {
    const { app, base } = await makeApp();
    await request(app).post(`/bases/${base.id}/barricades`).send({ actionId: act(), roomId: 'room-3-01' }).expect(201);
    await request(app).post(`/bases/${base.id}/barricades`).send({ actionId: act(), roomId: 'room-3-02' }).expect(201);
    const third = await request(app).post(`/bases/${base.id}/barricades`).send({ actionId: act(), roomId: 'staircase-b' });
    expect(third.status).toBe(422);
    expect(third.body.error.code).toBe('BARRICADE_LIMIT_REACHED');
  });

  it('reinforces with growing cost up to level 3, and can be removed', async () => {
    const { app, base } = await makeApp();
    const built = await request(app).post(`/bases/${base.id}/barricades`).send({ actionId: act(), roomId: 'FAF_CAB' });
    const id = built.body.result.barricade.id;
    const r1 = await request(app).post(`/bases/${base.id}/barricades/${id}/reinforce`).send({ actionId: act() });
    expect(r1.body.result.cost).toEqual([
      { resourceTypeId: 'wood', amount: 3 },
      { resourceTypeId: 'metal_scraps', amount: 2 }
    ]);
    expect(r1.body.result.barricade).toMatchObject({ level: 2, durability: 100 });
    const r2 = await request(app).post(`/bases/${base.id}/barricades/${id}/reinforce`).send({ actionId: act() });
    expect(r2.body.result.cost[0]).toEqual({ resourceTypeId: 'wood', amount: 6 });
    const r3 = await request(app).post(`/bases/${base.id}/barricades/${id}/reinforce`).send({ actionId: act() });
    expect(r3.body.error.code).toBe('MAX_LEVEL_REACHED');
    expect((await request(app).post(`/bases/${base.id}/barricades/nope/reinforce`).send({ actionId: act() })).status).toBe(404);
    const removed = await request(app).delete(`/bases/${base.id}/barricades/${id}`);
    expect(removed.body.barricades).toEqual([]);
    expect((await request(app).delete(`/bases/${base.id}/barricades/${id}`)).status).toBe(404);
  });

  it('does not build when the player cannot pay', async () => {
    const { app, base, resources } = await makeApp();
    resources.setBalance('player-1', 'metal_scraps', 1);
    const res = await request(app).post(`/bases/${base.id}/barricades`).send({ actionId: act(), roomId: 'FAF_CAB' });
    expect(res.status).toBe(422);
    expect((await request(app).get(`/bases/${base.id}/barricades`)).body).toEqual([]);
  });
});

describe('facilities', () => {
  it('builds, upgrades with multiplied cost and respects base level', async () => {
    const { app, base } = await makeApp();
    const wb = await request(app).post(`/bases/${base.id}/facilities`).send({ actionId: act(), type: 'WORKBENCH' });
    expect(wb.status).toBe(201);
    expect(wb.body.result.cost).toEqual([
      { resourceTypeId: 'wood', amount: 8 },
      { resourceTypeId: 'metal_scraps', amount: 4 }
    ]);
    expect((await request(app).post(`/bases/${base.id}/facilities`).send({ actionId: act(), type: 'WORKBENCH' })).status).toBe(409);
    const up = await request(app).post(`/bases/${base.id}/facilities/WORKBENCH/upgrade`).send({ actionId: act() });
    expect(up.body.result.cost[0]).toEqual({ resourceTypeId: 'wood', amount: 16 });
    await request(app).post(`/bases/${base.id}/facilities/WORKBENCH/upgrade`).send({ actionId: act() }).expect(201);
    expect((await request(app).post(`/bases/${base.id}/facilities/WORKBENCH/upgrade`).send({ actionId: act() })).status).toBe(422);
    expect((await request(app).post(`/bases/${base.id}/facilities/KITCHEN/upgrade`).send({ actionId: act() })).status).toBe(404);
    expect((await request(app).post(`/bases/${base.id}/facilities/SAUNA/upgrade`).send({ actionId: act() })).status).toBe(400);

    const gen = await request(app).post(`/bases/${base.id}/facilities`).send({ actionId: act(), type: 'GENERATOR' });
    expect(gen.body.error.code).toBe('BASE_LEVEL_TOO_LOW');
    expect((await request(app).get(`/bases/${base.id}/facilities`)).body).toHaveLength(1);
  });
});

describe('storage', () => {
  it('expands by 25 until the level limit', async () => {
    const { app, base } = await makeApp();
    const res = await request(app).post(`/bases/${base.id}/storage/expand`).send({ actionId: act() });
    expect(res.body.result).toMatchObject({ storageCapacity: 125, limit: 200 });
    for (let i = 0; i < 3; i++) await request(app).post(`/bases/${base.id}/storage/expand`).send({ actionId: act() }).expect(201);
    const full = await request(app).post(`/bases/${base.id}/storage/expand`).send({ actionId: act() });
    expect(full.body.error.code).toBe('STORAGE_LIMIT_REACHED');
    expect((await request(app).get(`/bases/${base.id}/storage`)).body).toEqual({ storageCapacity: 200, level: 1 });
  });
});

describe('decorations', () => {
  it('adds with a cost, respects the limit and removes', async () => {
    const { app, base } = await makeApp();
    const poster = await request(app).post(`/bases/${base.id}/decorations`).send({ actionId: act(), type: 'POSTER' });
    expect(poster.body.result.cost).toEqual([{ resourceTypeId: 'paper', amount: 2 }]);
    for (let i = 0; i < 4; i++) await request(app).post(`/bases/${base.id}/decorations`).send({ actionId: act(), type: 'PLANT' });
    const over = await request(app).post(`/bases/${base.id}/decorations`).send({ actionId: act(), type: 'LAMP' });
    expect(over.body.error.code).toBe('DECORATION_LIMIT_REACHED');
    const removed = await request(app).delete(`/bases/${base.id}/decorations/${poster.body.result.decoration.id}`);
    expect(removed.body.decorations).toHaveLength(4);
    expect((await request(app).delete(`/bases/${base.id}/decorations/nope`)).status).toBe(404);
    expect((await request(app).get(`/bases/${base.id}/decorations`)).body).toHaveLength(4);
    expect((await request(app).post(`/bases/${base.id}/decorations`).send({ actionId: act(), type: 'DISCO_BALL' })).status).toBe(400);
  });
});
