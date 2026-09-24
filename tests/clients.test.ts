import request from 'supertest';
import { HttpPlayerClient, MockPlayerClient } from '../src/clients/playerClient';
import { HttpWorldClient, MockWorldClient } from '../src/clients/worldClient';
import { HttpResourceClient, MockResourceClient } from '../src/clients/resourceClient';
import { loadConfig } from '../src/config';
import { makeApp } from './helpers';

const mockFetch = (impl: () => Promise<Partial<Response>>) =>
  jest.spyOn(global, 'fetch').mockImplementation(impl as unknown as typeof fetch);
afterEach(() => jest.restoreAllMocks());

const req = { actionId: 'a', playerId: 'p', reason: 'BARRICADE' as const, items: [{ resourceTypeId: 'wood', amount: 1 }] };

describe('HttpResourceClient', () => {
  it('succeeds on 2xx', async () => {
    const spy = mockFetch(async () => ({ ok: true, status: 201 }));
    await new HttpResourceClient('http://res').consume(req);
    expect(spy).toHaveBeenCalledWith('http://res/consume', expect.objectContaining({ method: 'POST' }));
  });
  it('forwards 422 business errors', async () => {
    mockFetch(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: 'INSUFFICIENT_RESOURCES', message: 'no', details: { missing: [] } } })
    }));
    await expect(new HttpResourceClient('http://res').consume(req)).rejects.toMatchObject({ status: 422, code: 'INSUFFICIENT_RESOURCES' });
    mockFetch(async () => ({ ok: false, status: 404, json: async () => { throw new Error('not json'); } }));
    await expect(new HttpResourceClient('http://res').consume(req)).rejects.toMatchObject({ status: 404, code: 'RESOURCE_REJECTED' });
  });
  it('maps other failures to 502/503', async () => {
    mockFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(new HttpResourceClient('http://res').consume(req)).rejects.toMatchObject({ status: 502 });
    mockFetch(async () => { throw new Error('down'); });
    await expect(new HttpResourceClient('http://res').consume(req)).rejects.toMatchObject({ status: 503 });
  });
  it('surfaces 503 through the API when Resource Service is down', async () => {
    const { BaseService } = await import('../src/services/baseService');
    const { MemoryBaseRepository } = await import('../src/repositories/memoryBaseRepository');
    const { createApp } = await import('../src/app');
    const svc = new BaseService(new MemoryBaseRepository(), new MockPlayerClient(), new MockWorldClient(), new HttpResourceClient('http://res'));
    const base = await svc.createBase({ playerId: 'player-1' });
    mockFetch(async () => { throw new Error('down'); });
    const res = await request(createApp(svc)).post(`/bases/${base.id}/upgrade`).send({ actionId: 'u' });
    expect(res.status).toBe(503);
    expect((await svc.get(base.id)).level).toBe(1);
  });
});

describe('Player/World HTTP clients and mocks', () => {
  it('work', async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    expect(await new HttpPlayerClient('http://p').playerExists('x')).toBe(true);
    mockFetch(async () => ({ ok: false, status: 404 }));
    expect(await new HttpWorldClient('http://w').roomExists('x')).toBe(false);
    mockFetch(async () => ({ ok: false, status: 500 }));
    await expect(new HttpWorldClient('http://w').roomExists('x')).rejects.toMatchObject({ status: 502 });
    expect(await new MockWorldClient(['r']).roomExists('r')).toBe(true);
    expect(await new MockPlayerClient(['a']).playerExists('b')).toBe(false);
  });
  it('mock resource client is idempotent', async () => {
    const m = new MockResourceClient(5);
    await m.consume({ ...req, items: [{ resourceTypeId: 'wood', amount: 5 }] });
    await m.consume({ ...req, items: [{ resourceTypeId: 'wood', amount: 5 }] });
    expect(m.balance('p', 'wood')).toBe(0);
  });
});

describe('config & plumbing', () => {
  it('reads env', () => {
    expect(loadConfig({})).toMatchObject({ port: 3002, storage: 'memory', resourceClient: 'mock', kikiCooldownSeconds: 30 });
    expect(
      loadConfig({ STORAGE: 'postgres', PLAYER_CLIENT: 'http', WORLD_CLIENT: 'http', RESOURCE_CLIENT: 'http', KIKI_COOLDOWN_SECONDS: '5', MOCK_PLAYERS: 'a,,b' })
    ).toMatchObject({ storage: 'postgres', playerClient: 'http', worldClient: 'http', resourceClient: 'http', kikiCooldownSeconds: 5, mockPlayers: ['a', 'b'] });
  });
  it('health, 404, bad json, 500', async () => {
    const { app, repo } = await makeApp();
    expect((await request(app).get('/health')).body.service).toBe('base-service');
    expect((await request(app).get('/zzz')).status).toBe(404);
    expect((await request(app).post('/bases').set('content-type', 'application/json').send('{')).status).toBe(400);
    jest.spyOn(repo, 'list').mockRejectedValueOnce(new Error('boom'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await request(app).get('/bases')).status).toBe(500);
  });
  it('default service options work', async () => {
    const { BaseService } = await import('../src/services/baseService');
    const { MemoryBaseRepository } = await import('../src/repositories/memoryBaseRepository');
    const svc = new BaseService(new MemoryBaseRepository(), new MockPlayerClient(), new MockWorldClient(), new MockResourceClient());
    const b = await svc.createBase({ playerId: 'player-1' });
    const out = await svc.interactWithKiki(b.id, 'k', 'PET');
    expect(out.duplicate).toBe(false);
  });
});
