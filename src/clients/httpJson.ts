import { AppError } from '../errors';

/** GET a JSON resource. Returns null on 404, throws 503 when the upstream is unreachable. */
export async function getJson<T>(url: string, service: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new AppError(503, 'UPSTREAM_UNAVAILABLE', `${service} is unreachable`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new AppError(502, 'UPSTREAM_ERROR', `${service} answered ${res.status}`);
  return (await res.json()) as T;
}
