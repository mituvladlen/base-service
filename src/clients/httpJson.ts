import { AppError } from '../errors';

/** How outgoing calls through the Gateway are made. */
export interface HttpOptions {
  /** Service JWT; the Gateway validates it on every route. */
  token?: string;
  timeoutMs?: number;
}

/** fetch through the Gateway: adds the service token, 504 when too slow, 503 when unreachable. */
export async function gatewayFetch(url: string, service: string, init: RequestInit, opts: HttpOptions = {}): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {})
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3000)
    });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new AppError(504, 'UPSTREAM_TIMEOUT', `${service} did not answer in time`);
    throw new AppError(503, 'UPSTREAM_UNAVAILABLE', `${service} is unreachable`);
  }
}

/** GET a JSON resource. Returns null on 404, throws 503/504 when the upstream is unreachable or slow. */
export async function getJson<T>(url: string, service: string, opts: HttpOptions = {}): Promise<T | null> {
  const res = await gatewayFetch(url, service, { method: 'GET' }, opts);
  if (res.status === 404) return null;
  if (!res.ok) throw new AppError(502, 'UPSTREAM_ERROR', `${service} answered ${res.status}`);
  return (await res.json()) as T;
}
