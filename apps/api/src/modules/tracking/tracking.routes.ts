import express, { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { endSessionBody, fleetLiveQuery, idParams, trackingBatchBody, trackingHistoryQuery, trackingPingBody } from '@unigate/validation';
import { ok, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as tracking from './tracking.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/** api.md §8.16 `/tracking`. Bodies are capped at 256 KB; the ping is party-only (the assigned driver). */
export function trackingRouter(): Router {
  const r = Router({ strict: true });
  r.use('/tracking', express.json({ limit: '256kb' }), authenticate(), csrfGuard());
  const readScope = (req: Request) => scopeFor(req, 'tracking.read_any', 'PARTY');

  r.post('/tracking/ping', requirePermission('tracking.publish'), validate({ body: trackingPingBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof trackingPingBody>>).validated;
    res.status(202).json(ok(await tracking.ping(scopeFor(req, undefined, 'PARTY'), body)));
  }));
  r.post('/tracking/ping/batch', requirePermission('tracking.publish'), validate({ body: trackingBatchBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof trackingBatchBody>>).validated;
    res.status(202).json(ok(await tracking.pingBatch(scopeFor(req, undefined, 'PARTY'), body.points)));
  }));
  r.get('/tracking/trips/:id', requirePermission('tracking.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    const { dto, degraded } = await tracking.trackTrip(readScope(req), params.id);
    res.status(200).json(ok(dto, { computedAt: new Date().toISOString(), ...(degraded.length ? { degraded } : {}) }));
  }));
  r.get('/tracking/trips/:id/history', requirePermission('tracking.read'), validate({ params: idParams, query: trackingHistoryQuery }), h(async (req, res) => {
    const { params, query } = (req as R<unknown, z.infer<typeof trackingHistoryQuery>, Id>).validated;
    const { items, nextCursor } = await tracking.tripHistory(readScope(req), params.id, query);
    res.status(200).json(ok(items, { nextCursor }));
  }));
  r.get('/tracking/vehicles', requirePermission('tracking.read_any'), validate({ query: fleetLiveQuery }), h(async (req, res: Response) => {
    const { query } = (req as R<unknown, z.infer<typeof fleetLiveQuery>>).validated;
    sendOk(res, await tracking.fleetPositions(scopeFor(req, 'tracking.read_any'), query));
  }));
  r.get('/tracking/vehicles/:id', requirePermission('tracking.read_any'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await tracking.vehiclePosition(scopeFor(req, 'tracking.read_any'), params.id));
  }));
  r.post('/tracking/sessions/:id/end', requirePermission('tracking.publish'), validate({ params: idParams, body: endSessionBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof endSessionBody>, unknown, Id>).validated;
    sendOk(res, await tracking.endSession(scopeFor(req, 'tracking.read_any', 'PARTY'), params.id, body.reason));
  }));
  return r;
}
