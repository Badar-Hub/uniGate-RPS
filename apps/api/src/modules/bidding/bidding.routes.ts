import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { acceptBidBody, assignPlatformVehicleBody, awardBody, createBidBody, idParams, listBidsQuery, listRequestBidsQuery, patchBidBody, rejectBidBody, withdrawBidBody } from '@unigate/validation';
import { ok, paginated, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { routeTier } from '@/middleware/rate-limit.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import { acceptBid, assignPlatformVehicle, awardRequest } from './award.service.js';
import * as bids from './bid.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/**
 * api.md §8.13 `/bids`, plus the bidding sub-resources of `/trip-requests/{id}` (§8.11): the
 * comparison list and the all-or-nothing award. Owners and customers both hold bids.read; the
 * repository scope decides which rows each of them can see.
 */
export function biddingRouter(): Router {
  const r = Router({ strict: true });
  r.use(['/bids', '/trip-requests'], authenticate(), csrfGuard());

  /** own → global; the repository's OWN scope already spans both parties (owner rows, customer's requests). */
  const readScope = (req: Request) => scopeFor(req, 'bids.read_any', 'OWN');

  r.get('/bids', requirePermission('bids.read'), validate({ query: listBidsQuery }), h(async (req, res: Response) => {
    const { query } = (req as R<unknown, z.infer<typeof listBidsQuery>>).validated;
    const { items, total } = await bids.listBids(readScope(req), query, query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/bids', requirePermission('bids.create'), routeTier('bid-submission', { limit: 60, seconds: 3600 }), idempotent({ required: true }), validate({ body: createBidBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createBidBody>>).validated;
    const dto = await bids.submitBid(scopeFor(req, undefined, 'OWN'), body);
    res.setHeader('Location', `/api/v1/bids/${dto.id}`);
    res.status(201).json(ok(dto));
  }));
  r.get('/bids/:id', requirePermission('bids.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await bids.getBid(readScope(req), params.id));
  }));
  r.patch('/bids/:id', requirePermission('bids.update'), validate({ params: idParams, body: patchBidBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchBidBody>, unknown, Id>).validated;
    sendOk(res, await bids.reviseBid(scopeFor(req, undefined, 'OWN'), params.id, body));
  }));
  r.post('/bids/:id/withdraw', requirePermission('bids.withdraw'), validate({ params: idParams, body: withdrawBidBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof withdrawBidBody>, unknown, Id>).validated;
    sendOk(res, await bids.withdrawBid(scopeFor(req, undefined, 'OWN'), params.id, body.reason));
  }));
  r.post('/bids/:id/reject', requirePermission('bids.accept'), validate({ params: idParams, body: rejectBidBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof rejectBidBody>, unknown, Id>).validated;
    sendOk(res, await bids.rejectBid(scopeFor(req, 'bids.read_any', 'OWN'), params.id, body.reason));
  }));
  r.post('/bids/:id/accept', requirePermission('bids.accept'), idempotent({ required: true }), validate({ params: idParams, body: acceptBidBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof acceptBidBody>, unknown, Id>).validated;
    const result = await acceptBid(scopeFor(req, 'bids.read_any', 'OWN'), params.id, body);
    res.setHeader('Location', `/api/v1/bookings/${result.booking.id}`);
    res.status(201).json(ok(result));
  }));

  // ── request-level bidding sub-resources ──────────────────────────────────
  r.get('/trip-requests/:id/bids', requirePermission('bids.read'), validate({ params: idParams, query: listRequestBidsQuery }), h(async (req, res: Response) => {
    const { params, query } = (req as R<unknown, z.infer<typeof listRequestBidsQuery>, Id>).validated;
    const { items, total } = await bids.listRequestBids(readScope(req), params.id, query, query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/trip-requests/:id/award', requirePermission('bids.accept'), idempotent({ required: true }), validate({ params: idParams, body: awardBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof awardBody>, unknown, Id>).validated;
    res.status(201).json(ok(await awardRequest(scopeFor(req, 'bids.read_any', 'OWN'), params.id, body)));
  }));
  // A-57: ops dispatch one of UniGate's own vehicles without a bid; the award path is reused, the snapshot carries no commission.
  r.post('/trip-requests/:id/assign-platform-vehicle', requirePermission('bookings.manage'), idempotent({ required: true }), validate({ params: idParams, body: assignPlatformVehicleBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof assignPlatformVehicleBody>, unknown, Id>).validated;
    res.status(201).json(ok(await assignPlatformVehicle(scopeFor(req, 'bookings.manage'), params.id, body)));
  }));

  return r;
}
