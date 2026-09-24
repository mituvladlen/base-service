import { randomUUID } from 'crypto';
import { AppError, notFound, unprocessable, conflict } from '../errors';
import * as C from '../domain/catalog';
import { Base, BoosterType, Cost, DecorationType, FacilityType, KikiReward } from '../domain/types';
import { PlayerClient } from '../clients/playerClient';
import { WorldClient } from '../clients/worldClient';
import { ConsumeRequest, ResourceClient } from '../clients/resourceClient';
import { BaseRepository, MutationOutcome } from '../repositories/baseRepository';

export interface BaseServiceOptions {
  kikiCooldownSeconds: number;
  random: () => number; // [0, 1), injectable for tests
  now: () => Date; // injectable for tests
}

export type KikiAction = 'PET' | 'FEED';

export class BaseService {
  private readonly opts: BaseServiceOptions;

  constructor(
    private readonly repo: BaseRepository,
    private readonly players: PlayerClient,
    private readonly world: WorldClient,
    private readonly resources: ResourceClient,
    opts: Partial<BaseServiceOptions> = {}
  ) {
    this.opts = { kikiCooldownSeconds: 30, random: Math.random, now: () => new Date(), ...opts };
  }

  // ---------- CRUD ----------
  /** `id` is only chosen by the seed (base-player-N); API-created bases get a UUID. */
  async createBase(input: { playerId: string; name?: string }, id: string = randomUUID()): Promise<Base> {
    if (!(await this.players.playerExists(input.playerId))) {
      throw notFound('PLAYER_NOT_FOUND', `Player '${input.playerId}' not found`);
    }
    const now = this.opts.now().toISOString();
    return this.repo.create({
      id,
      playerId: input.playerId,
      name: input.name ?? 'FAF Cab',
      roomId: C.START_ROOM,
      level: 1,
      storageCapacity: C.START_STORAGE,
      barricades: [],
      facilities: [],
      decorations: [],
      boosters: [],
      kiki: { mood: C.KIKI_START_MOOD, interactions: 0, lastInteractionAt: null },
      createdAt: now,
      updatedAt: now
    });
  }
  list() {
    return this.repo.list();
  }
  async get(id: string) {
    const b = await this.repo.getById(id);
    if (!b) throw notFound('BASE_NOT_FOUND', `Base '${id}' not found`);
    return b;
  }
  async getByPlayer(playerId: string) {
    const b = await this.repo.getByPlayer(playerId);
    if (!b) throw notFound('BASE_NOT_FOUND', `Player '${playerId}' has no base`);
    return b;
  }
  async rename(id: string, name: string) {
    return (await this.repo.mutate(id, null, async (base) => ({ base: { ...base, name }, result: {} }))).base;
  }
  async remove(id: string) {
    if (!(await this.repo.delete(id))) throw notFound('BASE_NOT_FOUND', `Base '${id}' not found`);
  }

  // ---------- upgrades ----------
  upgrade(baseId: string, actionId: string) {
    return this.paid(baseId, actionId, 'UPGRADE', {}, async (base) => {
      if (base.level >= C.MAX_BASE_LEVEL) throw unprocessable('MAX_LEVEL_REACHED', `Base is already level ${C.MAX_BASE_LEVEL}`);
      const cost = C.upgradeCost(base.level);
      await this.spend(base, actionId, 'BASE_UPGRADE', cost);
      base.level += 1;
      base.storageCapacity += C.STORAGE_PER_LEVEL;
      return { base, result: { cost, level: base.level, storageCapacity: base.storageCapacity } };
    });
  }

  // ---------- barricades ----------
  buildBarricade(baseId: string, actionId: string, roomId: string) {
    return this.paid(baseId, actionId, 'BARRICADE_BUILD', { roomId }, async (base) => {
      if (!(await this.world.roomExists(roomId))) throw notFound('ROOM_NOT_FOUND', `Room '${roomId}' not found`);
      if (base.barricades.some((b) => b.roomId === roomId)) {
        throw conflict('ROOM_ALREADY_BARRICADED', `Room '${roomId}' already has a barricade, reinforce it instead`);
      }
      if (base.barricades.length >= C.maxBarricades(base.level)) {
        throw unprocessable('BARRICADE_LIMIT_REACHED', `A level ${base.level} base can hold ${C.maxBarricades(base.level)} barricades`);
      }
      const cost = C.barricadeBuildCost();
      await this.spend(base, actionId, 'BARRICADE', cost);
      const barricade = {
        id: randomUUID(),
        roomId,
        level: 1,
        durability: C.BARRICADE_DURABILITY_PER_LEVEL,
        builtAt: this.opts.now().toISOString()
      };
      base.barricades.push(barricade);
      return { base, result: { cost, barricade } };
    });
  }

  reinforceBarricade(baseId: string, actionId: string, barricadeId: string) {
    return this.paid(baseId, actionId, 'BARRICADE_REINFORCE', { barricadeId }, async (base) => {
      const barricade = base.barricades.find((b) => b.id === barricadeId);
      if (!barricade) throw notFound('BARRICADE_NOT_FOUND', `Barricade '${barricadeId}' not found`);
      if (barricade.level >= C.MAX_BARRICADE_LEVEL) throw unprocessable('MAX_LEVEL_REACHED', 'Barricade is already at max level');
      const cost = C.barricadeReinforceCost(barricade.level);
      await this.spend(base, actionId, 'BARRICADE', cost);
      barricade.level += 1;
      barricade.durability = barricade.level * C.BARRICADE_DURABILITY_PER_LEVEL;
      return { base, result: { cost, barricade } };
    });
  }

  async removeBarricade(baseId: string, barricadeId: string) {
    return (
      await this.repo.mutate(baseId, null, async (base) => {
        if (!base.barricades.some((b) => b.id === barricadeId)) throw notFound('BARRICADE_NOT_FOUND', `Barricade '${barricadeId}' not found`);
        base.barricades = base.barricades.filter((b) => b.id !== barricadeId);
        return { base, result: {} };
      })
    ).base;
  }

  // ---------- facilities ----------
  buildFacility(baseId: string, actionId: string, type: FacilityType) {
    return this.paid(baseId, actionId, 'FACILITY_BUILD', { type }, async (base) => {
      if (base.facilities.some((f) => f.type === type)) throw conflict('FACILITY_EXISTS', `${type} is already built, upgrade it instead`);
      const def = C.FACILITIES[type];
      if (base.level < def.minBaseLevel) {
        throw unprocessable('BASE_LEVEL_TOO_LOW', `${type} requires base level ${def.minBaseLevel}`);
      }
      await this.spend(base, actionId, 'FACILITY', def.cost);
      const facility = { type, level: 1, builtAt: this.opts.now().toISOString() };
      base.facilities.push(facility);
      return { base, result: { cost: def.cost, facility } };
    });
  }

  upgradeFacility(baseId: string, actionId: string, type: FacilityType) {
    return this.paid(baseId, actionId, 'FACILITY_UPGRADE', { type }, async (base) => {
      const facility = base.facilities.find((f) => f.type === type);
      if (!facility) throw notFound('FACILITY_NOT_FOUND', `${type} is not built`);
      if (facility.level >= C.MAX_FACILITY_LEVEL) throw unprocessable('MAX_LEVEL_REACHED', `${type} is already at max level`);
      const cost = C.facilityUpgradeCost(type, facility.level);
      await this.spend(base, actionId, 'FACILITY', cost);
      facility.level += 1;
      return { base, result: { cost, facility } };
    });
  }

  // ---------- storage ----------
  expandStorage(baseId: string, actionId: string) {
    return this.paid(baseId, actionId, 'STORAGE_EXPAND', {}, async (base) => {
      const limit = C.maxStorage(base.level);
      if (base.storageCapacity + C.STORAGE_EXPANSION > limit) {
        throw unprocessable('STORAGE_LIMIT_REACHED', `Storage limit for a level ${base.level} base is ${limit}, upgrade the base first`);
      }
      const cost = C.storageExpansionCost();
      await this.spend(base, actionId, 'STORAGE', cost);
      base.storageCapacity += C.STORAGE_EXPANSION;
      return { base, result: { cost, storageCapacity: base.storageCapacity, limit } };
    });
  }

  // ---------- decorations ----------
  addDecoration(baseId: string, actionId: string, type: DecorationType) {
    return this.paid(baseId, actionId, 'DECORATION_ADD', { type }, async (base) => {
      if (base.decorations.length >= C.maxDecorations(base.level)) {
        throw unprocessable('DECORATION_LIMIT_REACHED', `A level ${base.level} base can hold ${C.maxDecorations(base.level)} decorations`);
      }
      const cost = C.DECORATIONS[type];
      await this.spend(base, actionId, 'DECORATION', cost);
      const decoration = { id: randomUUID(), type, placedAt: this.opts.now().toISOString() };
      base.decorations.push(decoration);
      return { base, result: { cost, decoration } };
    });
  }

  async removeDecoration(baseId: string, decorationId: string) {
    return (
      await this.repo.mutate(baseId, null, async (base) => {
        if (!base.decorations.some((d) => d.id === decorationId)) throw notFound('DECORATION_NOT_FOUND', `Decoration '${decorationId}' not found`);
        base.decorations = base.decorations.filter((d) => d.id !== decorationId);
        return { base, result: {} };
      })
    ).base;
  }

  // ---------- Kiki ----------
  /** Pet or feed Kiki for a random reward. A retried actionId returns the SAME reward. */
  interactWithKiki(baseId: string, actionId: string, action: KikiAction) {
    return this.paid(baseId, actionId, 'KIKI', { action }, async (base) => {
      const now = this.opts.now();
      if (base.kiki.lastInteractionAt) {
        const elapsed = (now.getTime() - new Date(base.kiki.lastInteractionAt).getTime()) / 1000;
        if (elapsed < this.opts.kikiCooldownSeconds) {
          const retryAfterSeconds = Math.ceil(this.opts.kikiCooldownSeconds - elapsed);
          throw new AppError(429, 'KIKI_COOLDOWN', `Kiki needs a break. Try again in ${retryAfterSeconds}s`, { retryAfterSeconds });
        }
      }
      const fed = action === 'FEED';
      const cost: Cost[] = fed ? C.KIKI_FEED_COST : [];
      if (fed) await this.spend(base, actionId, 'FEED_KIKI', cost);

      const reward: KikiReward = C.pickWeighted(C.kikiRewardTable(base.kiki.mood, fed), this.opts.random());
      base.kiki = {
        mood: Math.min(100, base.kiki.mood + (fed ? C.KIKI_MOOD_FEED : C.KIKI_MOOD_PET)),
        interactions: base.kiki.interactions + 1,
        lastInteractionAt: now.toISOString()
      };
      let booster = null;
      if (reward !== 'NOTHING') {
        booster = { id: randomUUID(), type: reward as BoosterType, obtainedAt: now.toISOString() };
        base.boosters.push(booster);
      }
      return { base, result: { cost, action, reward, booster, kiki: base.kiki } };
    });
  }

  catalog() {
    return C.catalog();
  }

  // ---------- helpers ----------
  private async paid<T extends Record<string, unknown>>(
    baseId: string,
    actionId: string,
    kind: string,
    params: Record<string, unknown>,
    fn: (base: Base) => Promise<{ base: Base; result: T }>
  ) {
    const fingerprint = JSON.stringify({ kind, baseId, ...params });
    const out: MutationOutcome<T> = await this.repo.mutate(baseId, { actionId, kind, fingerprint }, fn);
    return { actionId, duplicate: out.duplicate, result: out.result, base: out.base };
  }

  /**
   * Resource Service is idempotent by actionId, so if our DB write fails after a
   * successful consume, retrying with the same actionId will not charge twice.
   * The prefix keeps our ids apart from other services' actionIds.
   */
  private spend(base: Base, actionId: string, reason: ConsumeRequest['reason'], items: Cost[]) {
    return this.resources.consume({ actionId: `base:${actionId}`, playerId: base.playerId, reason, items });
  }
}
