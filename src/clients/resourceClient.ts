import { AppError } from '../errors';
import { Cost } from '../domain/types';

export interface ConsumeRequest {
  actionId: string;
  playerId: string;
  reason: 'BARRICADE' | 'BASE_UPGRADE' | 'FACILITY' | 'STORAGE' | 'DECORATION' | 'FEED_KIKI';
  items: Cost[];
}

/** Everything Base Service needs from Resource Service. */
export interface ResourceClient {
  /** Spends resources atomically. Idempotent by actionId. Throws 422 INSUFFICIENT_RESOURCES. */
  consume(req: ConsumeRequest): Promise<void>;
}

/** Mock: keeps its own balances. Unknown players start with `startingAmount` of everything. */
export class MockResourceClient implements ResourceClient {
  readonly calls: ConsumeRequest[] = [];
  private readonly balances = new Map<string, number>();
  private readonly done = new Set<string>();

  constructor(private readonly startingAmount = 1000) {}

  setBalance(playerId: string, resourceTypeId: string, amount: number) {
    this.balances.set(`${playerId}::${resourceTypeId}`, amount);
  }
  balance(playerId: string, resourceTypeId: string) {
    return this.balances.get(`${playerId}::${resourceTypeId}`) ?? this.startingAmount;
  }

  async consume(req: ConsumeRequest) {
    this.calls.push(req);
    if (this.done.has(req.actionId)) return; // idempotent, like the real service
    const missing = req.items
      .map((i) => ({ resourceTypeId: i.resourceTypeId, required: i.amount, available: this.balance(req.playerId, i.resourceTypeId) }))
      .filter((m) => m.available < m.required);
    if (missing.length) throw new AppError(422, 'INSUFFICIENT_RESOURCES', 'Not enough resources', { missing });
    for (const i of req.items) this.setBalance(req.playerId, i.resourceTypeId, this.balance(req.playerId, i.resourceTypeId) - i.amount);
    this.done.add(req.actionId);
  }
}

/** Real call to our Resource Service: POST {RESOURCE_SERVICE_URL}/consume */
export class HttpResourceClient implements ResourceClient {
  constructor(private readonly baseUrl: string) {}

  async consume(req: ConsumeRequest) {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/consume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req)
      });
    } catch {
      throw new AppError(503, 'UPSTREAM_UNAVAILABLE', 'Resource Service is unreachable');
    }
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; details?: unknown } };
    if (res.status === 422 || res.status === 404) {
      // e.g. INSUFFICIENT_RESOURCES or PLAYER_NOT_FOUND: forward the business error as-is
      throw new AppError(res.status, body.error?.code ?? 'RESOURCE_REJECTED', body.error?.message ?? 'Rejected', body.error?.details);
    }
    throw new AppError(502, 'UPSTREAM_ERROR', `Resource Service answered ${res.status}`);
  }
}
