import request from 'supertest';
import { kikiRewardTable, pickWeighted } from '../src/domain/catalog';
import { makeApp } from './helpers';

describe('Kiki reward table', () => {
  it('picks by weight', () => {
    const table = kikiRewardTable(50, false); // NOTHING 30, ENERGY 25, NOTES 20, PAW 10, TICKET 5 -> total 90
    expect(table[0]).toEqual({ reward: 'NOTHING', weight: 30 });
    expect(pickWeighted(table, 0)).toBe('NOTHING');
    expect(pickWeighted(table, 29.9 / 90)).toBe('NOTHING');
    expect(pickWeighted(table, 30 / 90)).toBe('ENERGY_DRINK');
    expect(pickWeighted(table, 60 / 90)).toBe('STUDY_NOTES');
    expect(pickWeighted(table, 80 / 90)).toBe('LUCKY_PAW');
    expect(pickWeighted(table, 0.999)).toBe('GOLDEN_EXAM_TICKET');
    expect(pickWeighted(table, 1)).toBe('GOLDEN_EXAM_TICKET'); // defensive fallback
  });

  it('feeding and good mood make NOTHING less likely, never below 5', () => {
    expect(kikiRewardTable(0, false)[0].weight).toBe(40);
    expect(kikiRewardTable(50, true)[0].weight).toBe(10);
    expect(kikiRewardTable(100, true)[0].weight).toBe(5);
  });

  it('is roughly fair over many rolls', () => {
    const table = kikiRewardTable(50, false);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 9000; i++) {
      const r = pickWeighted(table, i / 9000);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    expect(counts.NOTHING).toBe(3000);
    expect(counts.GOLDEN_EXAM_TICKET).toBe(500);
  });
});

describe('POST /bases/:id/kiki/interact', () => {
  it('petting is free, raises mood and can give a booster', async () => {
    const { app, base, resources } = await makeApp({ random: () => 0.99 });
    const res = await request(app).post(`/bases/${base.id}/kiki/interact`).send({ actionId: 'k1', action: 'PET' });
    expect(res.status).toBe(201);
    expect(res.body.result).toMatchObject({ reward: 'GOLDEN_EXAM_TICKET', cost: [], kiki: { mood: 55, interactions: 1 } });
    expect(res.body.base.boosters[0].type).toBe('GOLDEN_EXAM_TICKET');
    expect(resources.calls).toHaveLength(0);
  });

  it('feeding costs 2 food and can give nothing', async () => {
    const { app, base, resources } = await makeApp({ random: () => 0 });
    const res = await request(app).post(`/bases/${base.id}/kiki/interact`).send({ actionId: 'k1', action: 'FEED' });
    expect(res.body.result).toMatchObject({ reward: 'NOTHING', booster: null, kiki: { mood: 70 } });
    expect(resources.calls[0]).toMatchObject({ reason: 'FEED_KIKI', items: [{ resourceTypeId: 'food', amount: 2 }] });
    expect((await request(app).get(`/bases/${base.id}/kiki`)).body.boosters).toEqual([]);
  });

  it('a retried actionId returns the same reward (no re-roll)', async () => {
    let roll = 0.99;
    const { app, base } = await makeApp({ random: () => roll });
    const first = await request(app).post(`/bases/${base.id}/kiki/interact`).send({ actionId: 'k1' });
    roll = 0;
    const retry = await request(app).post(`/bases/${base.id}/kiki/interact`).send({ actionId: 'k1' });
    expect(retry.status).toBe(200);
    expect(retry.body.result.reward).toBe(first.body.result.reward);
    expect(retry.body.base.boosters).toHaveLength(1);
  });

  it('enforces the cooldown with 429 + Retry-After', async () => {
    const { app, base, clock } = await makeApp();
    await request(app).post(`/bases/${base.id}/kiki/interact`).send({ actionId: 'k1' }).expect(201);
    clock.t = new Date(clock.t.getTime() + 10_000);
    const early = await request(app).post(`/bases/${base.id}/kiki/interact`).send({ actionId: 'k2' });
    expect(early.status).toBe(429);
    expect(early.headers['retry-after']).toBe('20');
    clock.t = new Date(clock.t.getTime() + 20_000);
    await request(app).post(`/bases/${base.id}/kiki/interact`).send({ actionId: 'k2' }).expect(201);
  });

  it('mood caps at 100 and feeding fails without food', async () => {
    const { app, base, resources, clock } = await makeApp({ kikiCooldownSeconds: 0 });
    for (let i = 0; i < 4; i++) {
      await request(app).post(`/bases/${base.id}/kiki/interact`).send({ actionId: `f${i}`, action: 'FEED' });
      clock.t = new Date(clock.t.getTime() + 1000);
    }
    expect((await request(app).get(`/bases/${base.id}/kiki`)).body.kiki.mood).toBe(100);
    resources.setBalance('player-1', 'food', 1);
    const hungry = await request(app).post(`/bases/${base.id}/kiki/interact`).send({ actionId: 'f9', action: 'FEED' });
    expect(hungry.body.error.code).toBe('INSUFFICIENT_RESOURCES');
    expect((await request(app).post(`/bases/${base.id}/kiki/interact`).send({ actionId: 'f10', action: 'DANCE' })).status).toBe(400);
  });
});
