import express, { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors';
import { baseRoutes } from './http/routes';
import { BaseService } from './services/baseService';

export function createApp(svc: BaseService) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'base-service' }));
  app.use(baseRoutes(svc));

  app.use((_req, res) => res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' } }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
