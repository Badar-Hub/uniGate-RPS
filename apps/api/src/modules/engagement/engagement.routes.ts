import { Router, type Request } from 'express';
import type { z } from 'zod';
import { assignComplaintBody, complaintNoteBody, complaintStatusBody, createComplaintBody, createRatingBody, idParams, listComplaintsQuery, listRatingsQuery, moderateRatingBody, patchComplaintBody, ratingSummaryQuery } from '@unigate/validation';
import { ok, paginated, sendNoContent, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as e from './engagement.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/** api.md §8.24 `/ratings` and §8.25 `/complaints`. */
export function engagementRouter(): Router {
  const r = Router({ strict: true });
  r.use(['/ratings', '/complaints'], authenticate(), csrfGuard());
  const ratingScope = (req: Request) => scopeFor(req, 'ratings.moderate', 'PARTY');
  const complaintScope = (req: Request) => scopeFor(req, 'complaints.read_any', 'OWN');
  const manage = (req: Request) => scopeFor(req, 'complaints.manage');

  // ── ratings ────────────────────────────────────────────────────────────────
  r.get('/ratings', requirePermission('ratings.read'), validate({ query: listRatingsQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listRatingsQuery>>).validated;
    const { items, total } = await e.listRatings(ratingScope(req), query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/ratings', requirePermission('ratings.create'), idempotent({ required: false }), validate({ body: createRatingBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createRatingBody>>).validated;
    res.status(201).json(ok(await e.createRating(ratingScope(req), body)));
  }));
  r.get('/ratings/eligible', requirePermission('ratings.create'), h(async (req, res) => {
    sendOk(res, await e.eligibleBookings(ratingScope(req)));
  }));
  r.get('/ratings/summary', requirePermission('ratings.read'), validate({ query: ratingSummaryQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof ratingSummaryQuery>>).validated;
    sendOk(res, await e.ratingSummary(ratingScope(req), query));
  }));
  r.post('/ratings/:id/moderate', requirePermission('ratings.moderate'), validate({ params: idParams, body: moderateRatingBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof moderateRatingBody>, unknown, Id>).validated;
    sendOk(res, await e.moderateRating(scopeFor(req, 'ratings.moderate'), params.id, body));
  }));
  r.delete('/ratings/:id', requirePermission('ratings.moderate'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    await e.hideRating(scopeFor(req, 'ratings.moderate'), params.id);
    sendNoContent(res);
  }));

  // ── complaints ─────────────────────────────────────────────────────────────
  r.get('/complaints', requirePermission('complaints.read'), validate({ query: listComplaintsQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listComplaintsQuery>>).validated;
    const { items, total } = await e.listComplaints(complaintScope(req), query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/complaints', requirePermission('complaints.create'), idempotent({ required: false }), validate({ body: createComplaintBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createComplaintBody>>).validated;
    const dto = await e.createComplaint(complaintScope(req), body);
    res.setHeader('Location', `/api/v1/complaints/${dto.id}`);
    res.status(201).json(ok(dto));
  }));
  r.get('/complaints/:id', requirePermission('complaints.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await e.getComplaint(complaintScope(req), params.id));
  }));
  r.patch('/complaints/:id', requirePermission('complaints.manage'), validate({ params: idParams, body: patchComplaintBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchComplaintBody>, unknown, Id>).validated;
    sendOk(res, await e.patchComplaint(manage(req), params.id, body));
  }));
  r.post('/complaints/:id/assign', requirePermission('complaints.manage'), validate({ params: idParams, body: assignComplaintBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof assignComplaintBody>, unknown, Id>).validated;
    sendOk(res, await e.assignComplaint(manage(req), params.id, body.assignedToUserId));
  }));
  r.post('/complaints/:id/status', requirePermission('complaints.manage'), validate({ params: idParams, body: complaintStatusBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof complaintStatusBody>, unknown, Id>).validated;
    sendOk(res, await e.transitionComplaint(manage(req), params.id, body));
  }));
  r.get('/complaints/:id/notes', requirePermission('complaints.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, (await e.getComplaint(complaintScope(req), params.id)).notes);
  }));
  r.post('/complaints/:id/notes', requirePermission('complaints.read'), validate({ params: idParams, body: complaintNoteBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof complaintNoteBody>, unknown, Id>).validated;
    res.status(201).json(ok(await e.addNote(complaintScope(req), params.id, body)));
  }));

  return r;
}
