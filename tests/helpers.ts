import request from 'supertest';
import { createApp } from '../src/app';
import { MockPlayerClient } from '../src/clients/playerClient';
import { MockWorldClient } from '../src/clients/worldClient';
import { MockResourceClient } from '../src/clients/resourceClient';
import { MemoryBaseRepository } from '../src/repositories/memoryBaseRepository';
import { BaseRepository } from '../src/repositories/baseRepository';
import { BaseService, BaseServiceOptions } from '../src/services/baseService';

export async function makeApp(opts: Partial<BaseServiceOptions> = {}, repo: BaseRepository = new MemoryBaseRepository()) {
  const resources = new MockResourceClient(1000);
  const clock = { t: new Date('2026-01-01T10:00:00Z') };
  const svc = new BaseService(repo, new MockPlayerClient(), new MockWorldClient(), resources, {
    kikiCooldownSeconds: 30,
    random: () => 0.99,
    now: () => clock.t,
    ...opts
  });
  const app = createApp(svc);
  const base = await svc.createBase({ playerId: 'player-1' });
  return { app, svc, repo, resources, clock, base, api: request(app) };
}

let n = 0;
export const act = () => `act-${++n}`;
