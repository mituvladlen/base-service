import { RequestHandler } from 'express';

/** Rejects requests above `max` in flight with 429. */
export function concurrencyLimit(max: number): RequestHandler {
  let active = 0;
  return (_req, res, next) => {
    if (active >= max) {
      res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: `Server is already handling ${max} requests, try again later` });
      return;
    }
    active++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active--;
      }
    };
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}

/** Demo only: delays every request by `ms` so 408/429 are easy to show live. 0 = off. */
export function simulatedLatency(ms: number): RequestHandler {
  return (_req, _res, next) => (ms > 0 ? setTimeout(next, ms) : next());
}

/** Responds 408 if the handler hasn't answered within `ms`. */
export function requestTimeout(ms: number): RequestHandler {
  return (_req, res, next) => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      res.status(408).json({ error: 'REQUEST_TIMEOUT', message: `Request took longer than ${ms} ms` });
      // A slow handler that answers later must not crash with "headers already sent".
      res.json = (() => res) as typeof res.json;
      res.send = (() => res) as typeof res.send;
    }, ms);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  };
}
