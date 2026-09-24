import { Pool, PoolClient } from 'pg';
import { conflict, notFound } from '../errors';
import { Base, BaseActionRecord } from '../domain/types';
import { ActionKey, BaseRepository, Mutation, MutationOutcome } from './baseRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toBase = (r: any): Base => ({
  id: r.id,
  playerId: r.player_id,
  name: r.name,
  roomId: r.room_id,
  level: r.level,
  storageCapacity: r.storage_capacity,
  barricades: r.barricades,
  facilities: r.facilities,
  decorations: r.decorations,
  boosters: r.boosters,
  kiki: r.kiki,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString()
});
const toAction = (r: any): BaseActionRecord => ({
  actionId: r.action_id,
  baseId: r.base_id,
  kind: r.kind,
  fingerprint: r.fingerprint,
  result: r.result,
  createdAt: new Date(r.created_at).toISOString()
});
const j = (x: unknown) => JSON.stringify(x);

export class PostgresBaseRepository implements BaseRepository {
  constructor(private readonly pool: Pool) {}

  async create(b: Base) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO bases (id, player_id, name, room_id, level, storage_capacity, barricades, facilities, decorations, boosters, kiki)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [b.id, b.playerId, b.name, b.roomId, b.level, b.storageCapacity, j(b.barricades), j(b.facilities), j(b.decorations), j(b.boosters), j(b.kiki)]
      );
      return toBase(rows[0]);
    } catch (e: any) {
      if (e.code === '23505') throw conflict('BASE_EXISTS', `Player '${b.playerId}' already has a base`);
      throw e;
    }
  }
  async getById(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM bases WHERE id = $1', [id]);
    return rows[0] ? toBase(rows[0]) : null;
  }
  async getByPlayer(playerId: string) {
    const { rows } = await this.pool.query('SELECT * FROM bases WHERE player_id = $1', [playerId]);
    return rows[0] ? toBase(rows[0]) : null;
  }
  async list() {
    const { rows } = await this.pool.query('SELECT * FROM bases ORDER BY created_at, id');
    return rows.map(toBase);
  }
  async delete(id: string) {
    const res = await this.pool.query('DELETE FROM bases WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }
  async getAction(actionId: string) {
    const { rows } = await this.pool.query('SELECT * FROM base_actions WHERE action_id = $1', [actionId]);
    return rows[0] ? toAction(rows[0]) : null;
  }

  async mutate<T extends Record<string, unknown>>(baseId: string, action: ActionKey | null, fn: Mutation<T>): Promise<MutationOutcome<T>> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      // 1) lock the base row: concurrent changes to the same base wait here
      const locked = await c.query('SELECT * FROM bases WHERE id = $1 FOR UPDATE', [baseId]);
      if (!locked.rows[0]) throw notFound('BASE_NOT_FOUND', `Base '${baseId}' not found`);

      // 2) idempotency check happens AFTER the lock, so a retry waits for the first attempt
      if (action) {
        const prev = await c.query('SELECT * FROM base_actions WHERE action_id = $1', [action.actionId]);
        if (prev.rows[0]) {
          const p = toAction(prev.rows[0]);
          if (p.baseId !== baseId || p.fingerprint !== action.fingerprint) {
            throw conflict('ACTION_ID_REUSED', `actionId '${action.actionId}' was already used for a different request`);
          }
          await c.query('COMMIT');
          return { base: toBase(locked.rows[0]), result: p.result as T, duplicate: true };
        }
      }

      // 3) business logic (may call Resource Service /consume, which is itself idempotent)
      const { base, result } = await fn(toBase(locked.rows[0]));
      const saved = await this.save(c, base);
      if (action) {
        await c.query(
          'INSERT INTO base_actions (action_id, base_id, kind, fingerprint, result) VALUES ($1, $2, $3, $4, $5)',
          [action.actionId, baseId, action.kind, action.fingerprint, j(result)]
        );
      }
      await c.query('COMMIT');
      return { base: saved, result, duplicate: false };
    } catch (e: any) {
      await c.query('ROLLBACK');
      if (e.code === '23505') throw conflict('ACTION_ID_REUSED', 'actionId was already used for a different base');
      throw e;
    } finally {
      c.release();
    }
  }

  private async save(c: PoolClient, b: Base) {
    const { rows } = await c.query(
      `UPDATE bases SET name=$2, room_id=$3, level=$4, storage_capacity=$5, barricades=$6, facilities=$7,
         decorations=$8, boosters=$9, kiki=$10, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [b.id, b.name, b.roomId, b.level, b.storageCapacity, j(b.barricades), j(b.facilities), j(b.decorations), j(b.boosters), j(b.kiki)]
    );
    return toBase(rows[0]);
  }
}
