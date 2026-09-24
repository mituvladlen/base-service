import { NextFunction, Request, Response, Router } from 'express';
import { z, ZodTypeAny } from 'zod';
import { BaseService } from '../services/baseService';
import * as V from './validation';

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const parse = <S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> => schema.parse(data);
/** 201 when something new happened, 200 when a retried actionId replays the stored result. */
const sendAction = (res: Response, out: { duplicate: boolean }) => res.status(out.duplicate ? 200 : 201).json(out);

export function baseRoutes(svc: BaseService): Router {
  const r = Router();

  r.get('/catalog', (_req, res) => res.json(svc.catalog()));

  // Base CRUD
  r.get('/bases', h(async (_req, res) => res.json(await svc.list())));
  r.post('/bases', h(async (req, res) => res.status(201).json(await svc.createBase(parse(V.createBaseSchema, req.body)))));
  r.get('/bases/:baseId', h(async (req, res) => res.json(await svc.get(req.params.baseId))));
  r.patch('/bases/:baseId', h(async (req, res) => res.json(await svc.rename(req.params.baseId, parse(V.renameSchema, req.body).name))));
  r.delete('/bases/:baseId', h(async (req, res) => {
    await svc.remove(req.params.baseId);
    res.status(204).end();
  }));
  r.get('/players/:playerId/base', h(async (req, res) => res.json(await svc.getByPlayer(req.params.playerId))));

  // Upgrade
  r.post('/bases/:baseId/upgrade', h(async (req, res) =>
    sendAction(res, await svc.upgrade(req.params.baseId, parse(V.actionOnly, req.body).actionId))));

  // Barricades
  r.get('/bases/:baseId/barricades', h(async (req, res) => res.json((await svc.get(req.params.baseId)).barricades)));
  r.post('/bases/:baseId/barricades', h(async (req, res) => {
    const b = parse(V.barricadeSchema, req.body);
    sendAction(res, await svc.buildBarricade(req.params.baseId, b.actionId, b.roomId));
  }));
  r.post('/bases/:baseId/barricades/:barricadeId/reinforce', h(async (req, res) =>
    sendAction(res, await svc.reinforceBarricade(req.params.baseId, parse(V.actionOnly, req.body).actionId, req.params.barricadeId))));
  r.delete('/bases/:baseId/barricades/:barricadeId', h(async (req, res) =>
    res.json(await svc.removeBarricade(req.params.baseId, req.params.barricadeId))));

  // Facilities
  r.get('/bases/:baseId/facilities', h(async (req, res) => res.json((await svc.get(req.params.baseId)).facilities)));
  r.post('/bases/:baseId/facilities', h(async (req, res) => {
    const b = parse(V.facilitySchema, req.body);
    sendAction(res, await svc.buildFacility(req.params.baseId, b.actionId, b.type));
  }));
  r.post('/bases/:baseId/facilities/:type/upgrade', h(async (req, res) =>
    sendAction(
      res,
      await svc.upgradeFacility(req.params.baseId, parse(V.actionOnly, req.body).actionId, parse(V.facilityTypeParam, req.params.type))
    )));

  // Storage
  r.get('/bases/:baseId/storage', h(async (req, res) => {
    const base = await svc.get(req.params.baseId);
    res.json({ storageCapacity: base.storageCapacity, level: base.level });
  }));
  r.post('/bases/:baseId/storage/expand', h(async (req, res) =>
    sendAction(res, await svc.expandStorage(req.params.baseId, parse(V.actionOnly, req.body).actionId))));

  // Decorations
  r.get('/bases/:baseId/decorations', h(async (req, res) => res.json((await svc.get(req.params.baseId)).decorations)));
  r.post('/bases/:baseId/decorations', h(async (req, res) => {
    const b = parse(V.decorationSchema, req.body);
    sendAction(res, await svc.addDecoration(req.params.baseId, b.actionId, b.type));
  }));
  r.delete('/bases/:baseId/decorations/:decorationId', h(async (req, res) =>
    res.json(await svc.removeDecoration(req.params.baseId, req.params.decorationId))));

  // Kiki
  r.get('/bases/:baseId/kiki', h(async (req, res) => {
    const base = await svc.get(req.params.baseId);
    res.json({ kiki: base.kiki, boosters: base.boosters });
  }));
  r.post('/bases/:baseId/kiki/interact', h(async (req, res) => {
    const b = parse(V.kikiSchema, req.body);
    sendAction(res, await svc.interactWithKiki(req.params.baseId, b.actionId, b.action));
  }));

  return r;
}
