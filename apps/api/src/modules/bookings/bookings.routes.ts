import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { cancelBookingBody, confirmBookingBody, dispatchDriverBody, disputeBookingBody, idParams, listBookingsQuery, noShowBody, readyBody, resolveDisputeBody, waiveFeeBody } from '@unigate/validation';
import { paginated, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, requirePermissionOrProfile, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as bookings from './booking.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/**
 * api.md §8.14 `/bookings`. Customers and owners reach their own rows (OWN); an assigned driver is
 * a party to the booking (PARTY); staff open GLOBAL through bookings.read_any / bookings.manage.
 */
export function bookingsRouter(): Router {
  const r = Router({ strict: true });
  r.use('/bookings', authenticate(), csrfGuard());

  const readScope = (req: Request) => scopeFor(req, 'bookings.read_any', 'PARTY');

  r.get('/bookings', requirePermission('bookings.read'), validate({ query: listBookingsQuery }), h(async (req, res: Response) => {
    const { query } = (req as R<unknown, z.infer<typeof listBookingsQuery>>).validated;
    const { items, total } = await bookings.listBookings(readScope(req), query, query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.get('/bookings/:id', requirePermission('bookings.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await bookings.getBooking(readScope(req), params.id));
  }));
  r.get('/bookings/:id/status-history', requirePermission('bookings.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await bookings.listStatusHistory(readScope(req), params.id));
  }));
  r.get('/bookings/:id/financials', requirePermission('bookings.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    // Staff (bookings.read_any) get the full snapshot incl. the rule; owners their net; customers the price.
    sendOk(res, await bookings.getFinancials(scopeFor(req, 'bookings.read_any', 'PARTY'), params.id));
  }));
  r.get('/bookings/:id/cancellation-quote', requirePermission('bookings.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await bookings.cancellationQuote(scopeFor(req, 'bookings.manage', 'PARTY'), params.id));
  }));
  r.post('/bookings/:id/cancel', requirePermission('bookings.cancel'), idempotent({ required: true }), validate({ params: idParams, body: cancelBookingBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof cancelBookingBody>, unknown, Id>).validated;
    sendOk(res, await bookings.cancelBooking(scopeFor(req, 'bookings.manage', 'PARTY'), params.id, body));
  }));
  r.post('/bookings/:id/no-show', requirePermission('bookings.cancel'), idempotent({ required: true }), validate({ params: idParams, body: noShowBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof noShowBody>, unknown, Id>).validated;
    sendOk(res, await bookings.recordNoShow(scopeFor(req, 'bookings.manage'), params.id, body));
  }));
  r.post('/bookings/:id/dispute', requirePermission('complaints.create'), idempotent({ required: false }), validate({ params: idParams, body: disputeBookingBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof disputeBookingBody>, unknown, Id>).validated;
    sendOk(res, await bookings.disputeBooking(scopeFor(req, 'complaints.manage', 'PARTY'), params.id, body));
  }));
  r.post('/bookings/:id/resolve-dispute', requirePermission('complaints.manage'), idempotent({ required: false }), validate({ params: idParams, body: resolveDisputeBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof resolveDisputeBody>, unknown, Id>).validated;
    sendOk(res, await bookings.resolveDispute(scopeFor(req, 'complaints.manage'), params.id, body));
  }));
  r.post('/bookings/:id/cancellation/waive-fee', requirePermission('bookings.manage'), idempotent({ required: false }), validate({ params: idParams, body: waiveFeeBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof waiveFeeBody>, unknown, Id>).validated;
    sendOk(res, await bookings.waiveCancellationFee(scopeFor(req, 'bookings.manage'), params.id, body.reason));
  }));
  r.post('/bookings/:id/confirm', requirePermission('bookings.manage'), validate({ params: idParams, body: confirmBookingBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof confirmBookingBody>, unknown, Id>).validated;
    sendOk(res, await bookings.confirmBooking(scopeFor(req, 'bookings.manage'), params.id, body.reason));
  }));
  r.post('/bookings/:id/assign-driver', requirePermission('bookings.assign_driver'), idempotent({ required: false }), validate({ params: idParams, body: dispatchDriverBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof dispatchDriverBody>, unknown, Id>).validated;
    sendOk(res, await bookings.assignDriver(scopeFor(req, 'bookings.manage', 'OWN'), params.id, body.driverProfileId));
  }));
  // own(owner) → global: an owner declares their own booking ready; ops hold bookings.manage.
  r.post('/bookings/:id/ready', requirePermissionOrProfile('bookings.manage', 'owner'), validate({ params: idParams, body: readyBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof readyBody>, unknown, Id>).validated;
    sendOk(res, await bookings.markReady(scopeFor(req, 'bookings.manage', 'OWN'), params.id, body.notes));
  }));

  return r;
}
