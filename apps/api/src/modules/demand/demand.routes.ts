import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { cancelTripRequestBody, closeRemainderBody, createTripRequestBody, dismissQuery, idParams, listOpportunitiesQuery, listTripRequestsQuery, patchTripRequestBody, remainderBody, requestCommissionBody } from '@unigate/validation';
import { ok, paginated, sendNoContent, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, requirePermissionOrProfile, scopeFor, type AuthenticatedRequest } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import { getRequestCommission, setRequestCommission } from '@/modules/finance/commission-admin.service.js';
import * as demand from './trip-request.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/**
 * api.md §8.11 `/trip-requests` and §8.12 `/opportunities`. Customers act on their own requests
 * (OWN); owners reach a request they were invited to through PARTY scope (redacted); staff open
 * GLOBAL through trip_requests.read_any.
 */
export function demandRouter(): Router {
  const r = Router({ strict: true });
  r.use(['/trip-requests', '/opportunities'], authenticate(), csrfGuard());

  /** own → party → global: an owner holding an invitation is a party to the request. */
  const readScope = (req: Request) => {
    const a = (req as AuthenticatedRequest).actor;
    if (a.permissions.has('trip_requests.read_any')) return scopeFor(req, 'trip_requests.read_any');
    return scopeFor(req, undefined, a.customerProfileId ? 'OWN' : 'PARTY');
  };

  r.get('/trip-requests', requirePermission('trip_requests.read'), validate({ query: listTripRequestsQuery }), h(async (req, res: Response) => {
    const { query } = (req as R<unknown, z.infer<typeof listTripRequestsQuery>>).validated;
    const { items, total } = await demand.listTripRequests(scopeFor(req, 'trip_requests.read_any'), query, query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/trip-requests', requirePermission('trip_requests.create'), idempotent({ required: true }), validate({ body: createTripRequestBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createTripRequestBody>>).validated;
    const { dto, degraded } = await demand.createTripRequest(scopeFor(req, 'trip_requests.read_any'), body);
    res.setHeader('Location', `/api/v1/trip-requests/${dto.id}`);
    res.status(201).json(ok(dto, degraded.length ? { degraded } : {}));
  }));
  r.get('/trip-requests/:id', requirePermissionOrProfile('trip_requests.read', 'owner'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await demand.getTripRequest(readScope(req), params.id));
  }));
  r.patch('/trip-requests/:id', requirePermission('trip_requests.update'), validate({ params: idParams, body: patchTripRequestBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchTripRequestBody>, unknown, Id>).validated;
    sendOk(res, await demand.patchTripRequest(scopeFor(req, 'trip_requests.read_any'), params.id, body));
  }));
  r.delete('/trip-requests/:id', requirePermission('trip_requests.cancel'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    await demand.deleteDraft(scopeFor(req, 'trip_requests.read_any'), params.id);
    sendNoContent(res);
  }));
  r.post('/trip-requests/:id/publish', requirePermission('trip_requests.update'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await demand.publishTripRequest(scopeFor(req, 'trip_requests.read_any'), params.id));
  }));
  r.post('/trip-requests/:id/cancel', requirePermission('trip_requests.cancel'), validate({ params: idParams, body: cancelTripRequestBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof cancelTripRequestBody>, unknown, Id>).validated;
    sendOk(res, await demand.cancelTripRequest(scopeFor(req, 'trip_requests.read_any'), params.id, body.reason));
  }));
  r.post('/trip-requests/:id/close-remainder', requirePermission('trip_requests.update'), idempotent({ required: false }), validate({ params: idParams, body: closeRemainderBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof closeRemainderBody>, unknown, Id>).validated;
    sendOk(res, await demand.closeRemainder(scopeFor(req, 'trip_requests.read_any'), params.id, body.reason));
  }));
  r.patch('/trip-requests/:id/remainder', requirePermission('trip_requests.update'), validate({ params: idParams, body: remainderBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof remainderBody>, unknown, Id>).validated;
    sendOk(res, await demand.adjustRemainder(scopeFor(req, 'trip_requests.read_any'), params.id, body));
  }));
  // The per-trip commission decision (api.md §8.20) lives on the request; the finance module owns the rules.
  r.get('/trip-requests/:id/commission', requirePermission('commissions.read', 'trip_requests.read_any'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await getRequestCommission(scopeFor(req, 'trip_requests.read_any'), params.id));
  }));
  r.patch('/trip-requests/:id/commission', requirePermission('commissions.override'), validate({ params: idParams, body: requestCommissionBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof requestCommissionBody>, unknown, Id>).validated;
    sendOk(res, await setRequestCommission(scopeFor(req, 'commissions.override'), params.id, body));
  }));
  r.get('/trip-requests/:id/invitations', requirePermission('trip_requests.read_any'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await demand.listInvitations(scopeFor(req, 'trip_requests.read_any'), params.id));
  }));

  // ── opportunities (owner) ─────────────────────────────────────────────────
  r.get('/opportunities', requirePermissionOrProfile('trip_requests.read', 'owner'), validate({ query: listOpportunitiesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listOpportunitiesQuery>>).validated;
    const { items, total } = await demand.listOpportunities(scopeFor(req, undefined, 'OWN'), query, query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.get('/opportunities/:id', requirePermissionOrProfile('trip_requests.read', 'owner'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await demand.getOpportunity(scopeFor(req, undefined, 'OWN'), params.id));
  }));
  r.post('/opportunities/:id/dismiss', requirePermission('opportunities.dismiss'), validate({ params: idParams, query: dismissQuery }), h(async (req, res) => {
    const { params, query } = (req as R<unknown, z.infer<typeof dismissQuery>, Id>).validated;
    sendOk(res, await demand.dismissOpportunity(scopeFor(req, undefined, 'OWN'), params.id, query.undo === true));
  }));

  return r;
}
