import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { cancelTripBody, idParams, listTripsQuery, patchTripBody, tripProofBody, tripStatusBody } from '@unigate/validation';
import { ok, paginated, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as trips from './trip.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/** api.md §8.15 `/trips`. Drivers, owners and customers reach their own trips; staff open GLOBAL through trips.read_any / trips.manage. */
export function tripsRouter(): Router {
  const r = Router({ strict: true });
  r.use('/trips', authenticate(), csrfGuard());
  const readScope = (req: Request) => scopeFor(req, 'trips.read_any', 'PARTY');

  r.get('/trips', requirePermission('trips.read'), validate({ query: listTripsQuery }), h(async (req, res: Response) => {
    const { query } = (req as R<unknown, z.infer<typeof listTripsQuery>>).validated;
    const { items, total } = await trips.listTrips(readScope(req), query, query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.get('/trips/active', requirePermission('trips.read'), validate({ query: listTripsQuery }), h(async (req, res: Response) => {
    const { query } = (req as R<unknown, z.infer<typeof listTripsQuery>>).validated;
    const { items, total } = await trips.listTrips(readScope(req), { ...query, activeOnly: true }, query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.get('/trips/:id', requirePermission('trips.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await trips.getTrip(readScope(req), params.id));
  }));
  r.post('/trips/:id/status', requirePermission('trips.update_status'), idempotent({ required: true }), validate({ params: idParams, body: tripStatusBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof tripStatusBody>, unknown, Id>).validated;
    sendOk(res, await trips.transitionTrip(scopeFor(req, 'trips.manage', 'PARTY'), params.id, body));
  }));
  r.get('/trips/:id/status-history', requirePermission('trips.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await trips.listHistory(readScope(req), params.id));
  }));
  r.patch('/trips/:id', requirePermission('trips.update_status'), validate({ params: idParams, body: patchTripBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchTripBody>, unknown, Id>).validated;
    sendOk(res, await trips.patchTrip(scopeFor(req, 'trips.manage', 'PARTY'), params.id, body));
  }));
  r.post('/trips/:id/cancel', requirePermission('trips.manage'), validate({ params: idParams, body: cancelTripBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof cancelTripBody>, unknown, Id>).validated;
    sendOk(res, await trips.cancelTrip(scopeFor(req, 'trips.manage'), params.id, body.reason));
  }));
  r.get('/trips/:id/proofs', requirePermission('trips.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await trips.listProofs(readScope(req), params.id));
  }));
  r.post('/trips/:id/proofs', requirePermission('trips.update_status'), validate({ params: idParams, body: tripProofBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof tripProofBody>, unknown, Id>).validated;
    res.status(201).json(ok(await trips.addProof(scopeFor(req, 'trips.manage', 'PARTY'), params.id, body)));
  }));
  return r;
}
