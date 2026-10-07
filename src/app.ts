import express, { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors';
import { concurrencyLimit, requestTimeout, simulatedLatency } from './middleware/limits';
import { baseRoutes } from './http/routes';
import { BaseService } from './services/baseService';

export interface AppLimits {
  requestTimeoutMs: number;
  maxConcurrentRequests: number;
  simulatedLatencyMs?: number;
}

export function createApp(svc: BaseService, limits: AppLimits = { requestTimeoutMs: 5000, maxConcurrentRequests: 100 }) {
  const app = express();

  // Health stays outside the limits so Docker health checks never get 429/408.
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'base-service' }));
  app.use(concurrencyLimit(limits.maxConcurrentRequests));
  app.use(requestTimeout(limits.requestTimeoutMs));
  app.use(simulatedLatency(limits.simulatedLatencyMs ?? 0));
  app.use(express.json({ limit: '100kb' }));
  app.use(baseRoutes(svc));

  app.use((_req, res) => res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' } }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return; // already answered, e.g. 408 after a timeout
    if (err instanceof ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues } });
    }
    if (err instanceof SyntaxError) {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Body is not valid JSON' } });
    }
    if (err instanceof AppError) {
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (err.status === 429 && retry) res.setHeader('Retry-After', String(retry));
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    console.error(err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
  });
  return app;
}
