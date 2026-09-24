import { Base, BaseActionRecord } from '../domain/types';

export interface MutationOutcome<T> {
  base: Base;
  result: T;
  duplicate: boolean;
}

export type Mutation<T> = (base: Base) => Promise<{ base: Base; result: T }>;

export interface ActionKey {
  actionId: string;
  kind: string;
  fingerprint: string;
}

export interface BaseRepository {
  create(base: Base): Promise<Base>; // 409 if the player already has a base
  getById(id: string): Promise<Base | null>;
  getByPlayer(playerId: string): Promise<Base | null>;
  list(): Promise<Base[]>;
  delete(id: string): Promise<boolean>;
  getAction(actionId: string): Promise<BaseActionRecord | null>;

  /**
   * Runs `fn` on the base while holding an exclusive lock on it and saves the result.
   * With an action key, a retried actionId returns the stored result without running `fn` again.
   * If `fn` throws, nothing is saved. Throws 404 if the base does not exist.
   */
  mutate<T extends Record<string, unknown>>(baseId: string, action: ActionKey | null, fn: Mutation<T>): Promise<MutationOutcome<T>>;
}
