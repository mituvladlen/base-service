import { conflict, notFound } from '../errors';
import { Base, BaseActionRecord } from '../domain/types';
import { ActionKey, BaseRepository, Mutation, MutationOutcome } from './baseRepository';

const clone = <T>(x: T): T => structuredClone(x);

export class MemoryBaseRepository implements BaseRepository {
  private bases = new Map<string, Base>();
  private actions = new Map<string, BaseActionRecord>();
  private locks = new Map<string, Promise<unknown>>();

  async create(base: Base) {
    if ([...this.bases.values()].some((b) => b.playerId === base.playerId)) {
      throw conflict('BASE_EXISTS', `Player '${base.playerId}' already has a base`);
    }
    this.bases.set(base.id, clone(base));
    return clone(base);
  }
  async getById(id: string) {
    const b = this.bases.get(id);
    return b ? clone(b) : null;
  }
  async getByPlayer(playerId: string) {
    const b = [...this.bases.values()].find((x) => x.playerId === playerId);
    return b ? clone(b) : null;
  }
  async list() {
    return [...this.bases.values()].map(clone);
  }
  async delete(id: string) {
    for (const [k, a] of this.actions) if (a.baseId === id) this.actions.delete(k);
    return this.bases.delete(id);
  }
  async getAction(actionId: string) {
    return this.actions.get(actionId) ?? null;
  }

  async mutate<T extends Record<string, unknown>>(baseId: string, action: ActionKey | null, fn: Mutation<T>) {
    return this.withLock(baseId, async (): Promise<MutationOutcome<T>> => {
      const current = this.bases.get(baseId);
      if (!current) throw notFound('BASE_NOT_FOUND', `Base '${baseId}' not found`);

      if (action) {
        const prev = this.actions.get(action.actionId);
        if (prev) {
          if (prev.baseId !== baseId || prev.fingerprint !== action.fingerprint) {
            throw conflict('ACTION_ID_REUSED', `actionId '${action.actionId}' was already used for a different request`);
          }
          return { base: clone(current), result: clone(prev.result) as T, duplicate: true };
        }
      }

      const { base, result } = await fn(clone(current)); // throws => nothing saved
      base.updatedAt = new Date().toISOString();
      this.bases.set(baseId, clone(base));
      if (action) {
        this.actions.set(action.actionId, {
          ...action,
          baseId,
          result: clone(result),
          createdAt: base.updatedAt
        });
      }
      return { base: clone(base), result, duplicate: false };
    });
  }

  /** Serializes async work per base (fn awaits the Resource Service, so we need a real lock). */
  private async withLock<R>(key: string, work: () => Promise<R>): Promise<R> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(work, work);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}
