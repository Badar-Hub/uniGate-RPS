import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, ComplaintDto, RatingDto, RatingEligibleBookingDto, RatingEligibleSubjectDto, RatingSummaryDto } from '@unigate/types';
import type { complaintNoteBody, complaintStatusBody, createComplaintBody, createRatingBody, listComplaintsQuery, listRatingsQuery, moderateRatingBody, patchComplaintBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { isUniqueViolation, prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { toComplaintDto, toRatingDto } from './engagement.mapper.js';
import * as repo from './engagement.repository.js';

/**
 * Engagement (api.md §8.24–8.25, BRIEF-§22). Ratings: eligibility is the booking's parties, its
 * COMPLETED state and the rating window; aggregates are recomputed after publish (not by
 * trigger). Complaints: raiser-owned rows, a staff lifecycle, internal notes that never leave
 * the admin portal.
 */

type RaterRole = 'CUSTOMER' | 'OWNER' | 'DRIVER';
type SubjectType = 'DRIVER' | 'VEHICLE' | 'OWNER' | 'CUSTOMER' | 'TRIP';
type ComplaintStatus = 'OPEN' | 'IN_REVIEW' | 'AWAITING_RESPONSE' | 'RESOLVED' | 'REJECTED' | 'CLOSED';

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

// ── ratings ──────────────────────────────────────────────────────────────────

async function windowDays(): Promise<number> {
  return getSettingValue<number>('booking.rating_window_days', 14);
}

/** Which subjects each role may rate: customers rate the supply side, the supply side rates the customer; everyone may rate the trip. */
const RATEABLE: Record<RaterRole, SubjectType[]> = {
  CUSTOMER: ['DRIVER', 'VEHICLE', 'OWNER', 'TRIP'],
  OWNER: ['CUSTOMER', 'TRIP'],
  DRIVER: ['CUSTOMER', 'TRIP'],
};

function partyRole(scope: ActorScope, b: { customerProfileId: string; ownerProfileId: string; driverProfileId: string | null }, claimed: RaterRole): boolean {
  switch (claimed) {
    case 'CUSTOMER':
      return Boolean(scope.actor.customerProfileId) && scope.actor.customerProfileId === b.customerProfileId;
    case 'OWNER':
      return Boolean(scope.actor.ownerProfileId) && scope.actor.ownerProfileId === b.ownerProfileId;
    case 'DRIVER':
      return Boolean(scope.actor.driverProfileId) && scope.actor.driverProfileId === b.driverProfileId;
  }
}

function subjectsOf(b: { customerProfileId: string; ownerProfileId: string; driverProfileId: string | null; vehicleId: string; trip: { id: string } | null }, role: RaterRole): { subjectType: SubjectType; subjectId: string }[] {
  const all: { subjectType: SubjectType; subjectId: string | null }[] = [
    { subjectType: 'DRIVER', subjectId: b.driverProfileId }, { subjectType: 'VEHICLE', subjectId: b.vehicleId }, { subjectType: 'OWNER', subjectId: b.ownerProfileId },
    { subjectType: 'CUSTOMER', subjectId: b.customerProfileId }, { subjectType: 'TRIP', subjectId: b.trip?.id ?? null },
  ];
  return all.filter((s): s is { subjectType: SubjectType; subjectId: string } => s.subjectId !== null && RATEABLE[role].includes(s.subjectType));
}

export async function listRatings(scope: AnyScope, q: z.infer<typeof listRatingsQuery>): Promise<{ items: RatingDto[]; total: number }> {
  const { items, total } = await repo.listRatings(scope, q, q);
  const names = await repo.userNames(scope, items.map((r) => r.raterUserId));
  return { items: items.map((r) => toRatingDto(r, names.get(r.raterUserId) ?? '')), total };
}

export async function ratingSummary(scope: AnyScope, q: { subjectType: SubjectType; subjectId: string }): Promise<RatingSummaryDto> {
  const a = await repo.aggregate(scope, q.subjectType, q.subjectId);
  return { subjectType: q.subjectType, subjectId: q.subjectId, ratingAvg: a.avg.toFixed(2), ratingCount: a.count, histogram: a.histogram };
}

/** Completed bookings the actor may still rate, with the subjects on each and the deadline (drives the "rate your trip" prompt). */
export async function eligibleBookings(scope: ActorScope): Promise<RatingEligibleBookingDto[]> {
  const days = await windowDays();
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await repo.completedBookingsFor(scope, { customerProfileId: scope.actor.customerProfileId, ownerProfileId: scope.actor.ownerProfileId, driverProfileId: scope.actor.driverProfileId }, since);
  const rated = await repo.ratingsForBookingByRater(scope, rows.map((r) => r.id), scope.actor.userId);
  const out: RatingEligibleBookingDto[] = [];
  for (const b of rows) {
    const roles: RaterRole[] = (['CUSTOMER', 'OWNER', 'DRIVER'] as const).filter((r) => partyRole(scope, b, r));
    for (const role of roles) {
      const subjects: RatingEligibleSubjectDto[] = subjectsOf(b, role).map((s) => ({
        ...s,
        label: s.subjectType === 'DRIVER' ? (b.driverProfile?.user.fullNameEn ?? '') : s.subjectType === 'VEHICLE' ? b.vehiclePlateSnapshot : s.subjectType === 'OWNER' ? b.ownerNameSnapshot : s.subjectType === 'CUSTOMER' ? b.customerProfile.user.fullNameEn : b.bookingNumber,
        alreadyRated: rated.some((x) => x.bookingId === b.id && x.subjectType === s.subjectType && x.subjectId === s.subjectId),
      }));
      const completedAt = b.completedAt ?? new Date();
      const deadline = new Date(completedAt.getTime() + days * 86_400_000);
      if (deadline < new Date() || subjects.every((s) => s.alreadyRated)) continue;
      out.push({ bookingId: b.id, bookingNumber: b.bookingNumber, tripId: b.trip?.id ?? null, raterRole: role, completedAt: completedAt.toISOString(), deadline: deadline.toISOString(), subjects });
    }
  }
  return out;
}

export async function createRating(scope: ActorScope, body: z.infer<typeof createRatingBody>): Promise<RatingDto> {
  const b = await repo.bookingParties(scope, body.bookingId);
  // Not a party → 404, never 403 (a 403 would confirm the booking exists — database.md §13.2).
  if (!b || !partyRole(scope, b, body.raterRole)) throw new NotFoundError();
  if (b.status !== 'COMPLETED') throw new BusinessRuleError('RATING_NOT_ELIGIBLE', 'Only completed bookings can be rated', { status: b.status });
  const days = await windowDays();
  const deadline = new Date((b.completedAt ?? new Date()).getTime() + days * 86_400_000);
  if (deadline < new Date()) throw new BusinessRuleError('RATING_WINDOW_CLOSED', `The rating window closed on ${deadline.toISOString()}`, { deadline: deadline.toISOString(), windowDays: days });
  if (!subjectsOf(b, body.raterRole).some((s) => s.subjectType === body.subjectType && s.subjectId === body.subjectId)) throw new BusinessRuleError('RATING_SUBJECT_INVALID', 'That subject is not one this role may rate on this booking', { allowed: subjectsOf(b, body.raterRole) });
  const reviewBelow = await getSettingValue<number>('booking.rating_review_below_score', 0);
  const status = body.comment && reviewBelow > 0 && body.score <= reviewBelow ? 'PENDING_REVIEW' : 'PUBLISHED';
  const id = newId();
  try {
    await prisma().$transaction(async (tx) => {
      await repo.insertRating(scope, { id, bookingId: b.id, tripId: b.trip?.id ?? null, raterUserId: scope.actor.userId, raterRole: body.raterRole, subjectType: body.subjectType, subjectId: body.subjectId, score: body.score, comment: body.comment ?? null, status }, tx);
      await writeAudit({ ...audit(scope), action: 'rating.created', entityType: 'rating', entityId: id, afterValue: { bookingId: b.id, subjectType: body.subjectType, subjectId: body.subjectId, score: body.score, status } }, tx);
      await publishEvent('rating', id, 'rating.created', { bookingId: b.id, subjectType: body.subjectType, subjectId: body.subjectId, score: body.score, status }, tx);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError('RATING_ALREADY_SUBMITTED', 'You already rated this subject on this booking');
    throw e;
  }
  // Aggregates after commit, not by trigger (database.md §13.2).
  if (status === 'PUBLISHED') await recomputeAggregate(scope, body.subjectType, body.subjectId);
  const row = await repo.findRating(scope, id);
  if (!row) throw new NotFoundError();
  return toRatingDto(row, scope.actor.userId === row.raterUserId ? (await repo.userNames(scope, [row.raterUserId])).get(row.raterUserId) ?? '' : '');
}

export async function recomputeAggregate(scope: AnyScope, subjectType: SubjectType, subjectId: string): Promise<void> {
  const a = await repo.aggregate(scope, subjectType, subjectId);
  await repo.writeAggregate(scope, subjectType, subjectId, a.avg, a.count);
}

export async function moderateRating(scope: ActorScope, id: string, body: z.infer<typeof moderateRatingBody>): Promise<RatingDto> {
  const r = await repo.findRating(scope, id);
  if (!r) throw new NotFoundError();
  await prisma().$transaction(async (tx) => {
    await repo.setRatingStatus(scope, id, body.status, scope.actor.userId, tx);
    await writeAudit({ ...audit(scope), action: 'rating.moderated', entityType: 'rating', entityId: id, severity: 'NOTICE', beforeValue: { status: r.status }, afterValue: { status: body.status, reason: body.reason } }, tx);
  });
  await recomputeAggregate(scope, r.subjectType, r.subjectId);
  const after = await repo.findRating(scope, id);
  if (!after) throw new NotFoundError();
  return toRatingDto(after, (await repo.userNames(scope, [after.raterUserId])).get(after.raterUserId) ?? '');
}

export async function hideRating(scope: ActorScope, id: string): Promise<void> {
  await moderateRating(scope, id, { status: 'HIDDEN', reason: 'Hidden by moderator' });
}

// ── complaints ───────────────────────────────────────────────────────────────

const TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  OPEN: ['IN_REVIEW', 'REJECTED'],
  IN_REVIEW: ['AWAITING_RESPONSE', 'RESOLVED', 'REJECTED'],
  AWAITING_RESPONSE: ['IN_REVIEW', 'RESOLVED', 'REJECTED'],
  RESOLVED: ['CLOSED', 'IN_REVIEW'],
  REJECTED: ['CLOSED', 'IN_REVIEW'],
  CLOSED: [],
};

async function respondBy(c: { status: string; severity: string; createdAt: Date }): Promise<Date | null> {
  if (c.status !== 'OPEN') return null;
  const sla = await getSettingValue<Record<string, number>>('platform.complaint_sla_hours', { LOW: 120, MEDIUM: 72, HIGH: 24, CRITICAL: 4 });
  return new Date(c.createdAt.getTime() + (sla[c.severity] ?? 72) * 3_600_000);
}

function canSeeInternal(scope: AnyScope): boolean {
  return scope.kind === 'SYSTEM' || (scope.kind === 'GLOBAL' && scope.actor.permissions.has('complaints.manage'));
}

async function present(scope: AnyScope, c: repo.ComplaintRow): Promise<ComplaintDto> {
  const names = await repo.userNames(scope, [c.raisedByUserId, ...(c.assignedToUserId ? [c.assignedToUserId] : []), ...c.notes.map((n) => n.authorUserId)]);
  return toComplaintDto(c, names, { includeInternal: canSeeInternal(scope), respondBy: await respondBy(c) });
}

export async function listComplaints(scope: AnyScope, q: z.infer<typeof listComplaintsQuery>): Promise<{ items: ComplaintDto[]; total: number }> {
  const { items, total } = await repo.listComplaints(scope, q, q);
  const dtos = await Promise.all(items.map((c) => present(scope, c)));
  return { items: q.overdueOnly ? dtos.filter((d) => d.overdue) : dtos, total };
}

export async function getComplaint(scope: AnyScope, id: string): Promise<ComplaintDto> {
  const c = await repo.findComplaint(scope, id);
  if (!c) throw new NotFoundError();
  return present(scope, c);
}

export async function createComplaint(scope: ActorScope, body: z.infer<typeof createComplaintBody>): Promise<ComplaintDto> {
  const categories = await getSettingValue<string[]>('platform.complaint_categories', ['OTHER']);
  if (!categories.includes(body.category)) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown complaint category', { fieldErrors: { category: [`one of ${categories.join(', ')}`] }, formErrors: [] });
  let bookingId: string | null = null;
  let tripId: string | null = body.tripId ?? null;
  if (body.bookingId) {
    const b = await repo.bookingParties(scope, body.bookingId);
    // Raiser must be a party to the booking — otherwise 404 (never confirm existence).
    if (!b || !(partyRole(scope, b, 'CUSTOMER') || partyRole(scope, b, 'OWNER') || partyRole(scope, b, 'DRIVER'))) throw new NotFoundError();
    bookingId = b.id;
    tripId ??= b.trip?.id ?? null;
  }
  const id = newId();
  await prisma().$transaction(async (tx) => {
    const complaintNumber = await repo.nextComplaintNumber(scope, tx);
    await repo.insertComplaint(scope, { id, complaintNumber, raisedByUserId: scope.actor.userId, bookingId, tripId, againstType: body.againstType, againstId: body.againstId ?? null, category: body.category, subject: body.subject, description: body.description, severity: body.severity ?? 'MEDIUM', status: 'OPEN' }, tx);
    await writeAudit({ ...audit(scope), action: 'complaint.raised', entityType: 'complaint', entityId: id, afterValue: { complaintNumber, againstType: body.againstType, category: body.category, severity: body.severity ?? 'MEDIUM', bookingId } }, tx);
    await publishEvent('complaint', id, 'complaint.raised', { complaintNumber, raisedByUserId: scope.actor.userId, againstType: body.againstType, category: body.category, severity: body.severity ?? 'MEDIUM', bookingId, subject: body.subject }, tx);
  });
  return getComplaint(scope, id);
}

export async function patchComplaint(scope: ActorScope, id: string, body: z.infer<typeof patchComplaintBody>): Promise<ComplaintDto> {
  const c = await repo.findComplaint(scope, id);
  if (!c) throw new NotFoundError();
  await prisma().$transaction(async (tx) => {
    await repo.updateComplaint(scope, id, { ...(body.severity ? { severity: body.severity } : {}), ...(body.category ? { category: body.category } : {}), ...(body.assignedToUserId !== undefined ? { assignedToUserId: body.assignedToUserId } : {}) }, tx);
    await writeAudit({ ...audit(scope), action: 'complaint.updated', entityType: 'complaint', entityId: id, beforeValue: { severity: c.severity, category: c.category, assignedToUserId: c.assignedToUserId }, afterValue: { ...body }, changedFields: Object.keys(body) }, tx);
  });
  return getComplaint(scope, id);
}

export async function assignComplaint(scope: ActorScope, id: string, assignedToUserId: string | null): Promise<ComplaintDto> {
  const c = await repo.findComplaint(scope, id);
  if (!c) throw new NotFoundError();
  await prisma().$transaction(async (tx) => {
    // Picking a complaint up moves it out of OPEN — the SLA clock stops on first response.
    await repo.updateComplaint(scope, id, { assignedToUserId, ...(c.status === 'OPEN' && assignedToUserId ? { status: 'IN_REVIEW' } : {}) }, tx);
    await writeAudit({ ...audit(scope), action: 'complaint.assigned', entityType: 'complaint', entityId: id, beforeValue: { assignedToUserId: c.assignedToUserId }, afterValue: { assignedToUserId } }, tx);
  });
  return getComplaint(scope, id);
}

export async function transitionComplaint(scope: ActorScope, id: string, body: z.infer<typeof complaintStatusBody>): Promise<ComplaintDto> {
  const c = await repo.findComplaint(scope, id);
  if (!c) throw new NotFoundError();
  if (!TRANSITIONS[c.status].includes(body.status)) throw new BusinessRuleError('COMPLAINT_INVALID_TRANSITION', `A ${c.status} complaint cannot move to ${body.status}`, { from: c.status, to: body.status, allowed: TRANSITIONS[c.status] });
  if (body.status === 'RESOLVED' && !body.resolution && !c.resolution) throw new BusinessRuleError('COMPLAINT_RESOLUTION_REQUIRED', 'A resolution is required to resolve a complaint');
  const closing = body.status === 'RESOLVED' || body.status === 'REJECTED';
  await prisma().$transaction(async (tx) => {
    await repo.updateComplaint(scope, id, { status: body.status, ...(body.resolution ? { resolution: body.resolution } : {}), ...(closing ? { resolvedAt: new Date() } : {}), ...(body.status === 'IN_REVIEW' && !c.assignedToUserId ? { assignedToUserId: scope.actor.userId } : {}) }, tx);
    if (body.note) await repo.insertNote(scope, { id: newId(), complaintId: id, authorUserId: scope.actor.userId, body: body.note, isInternal: true }, tx);
    await writeAudit({ ...audit(scope), action: 'complaint.status_changed', entityType: 'complaint', entityId: id, beforeValue: { status: c.status }, afterValue: { status: body.status, resolution: body.resolution ?? c.resolution } }, tx);
    if (closing) await publishEvent('complaint', id, 'complaint.resolved', { complaintNumber: c.complaintNumber, raisedByUserId: c.raisedByUserId, status: body.status, resolution: body.resolution ?? c.resolution }, tx);
    if (body.status === 'AWAITING_RESPONSE') await publishEvent('complaint', id, 'complaint.awaiting_response', { complaintNumber: c.complaintNumber, raisedByUserId: c.raisedByUserId }, tx);
  });
  return getComplaint(scope, id);
}

export async function addNote(scope: ActorScope, id: string, body: z.infer<typeof complaintNoteBody>): Promise<ComplaintDto> {
  const c = await repo.findComplaint(scope, id);
  if (!c) throw new NotFoundError();
  if (body.isInternal && !canSeeInternal(scope)) throw new ForbiddenError('PERM_DENIED', 'Internal notes require complaints.manage');
  if (c.status === 'CLOSED') throw new BusinessRuleError('COMPLAINT_INVALID_TRANSITION', 'A closed complaint takes no more notes', { from: c.status });
  await repo.insertNote(scope, { id: newId(), complaintId: id, authorUserId: scope.actor.userId, body: body.body, isInternal: body.isInternal });
  // A raiser replying to a waiting complaint hands it back to staff.
  if (!body.isInternal && c.status === 'AWAITING_RESPONSE' && c.raisedByUserId === scope.actor.userId) {
    await prisma().$transaction(async (tx) => {
      await repo.updateComplaint(scope, id, { status: 'IN_REVIEW' }, tx);
      await writeAudit({ ...audit(scope), action: 'complaint.status_changed', entityType: 'complaint', entityId: id, beforeValue: { status: c.status }, afterValue: { status: 'IN_REVIEW', by: 'raiser-reply' } }, tx);
    });
  }
  return getComplaint(scope, id);
}

// ── booking disputes (called by the bookings module) ─────────────────────────

/** Opens the complaint behind a booking dispute; the bookings service has already verified the actor is a party (or staff). */
export async function openDisputeComplaint(scope: ActorScope, input: { bookingId: string; tripId: string | null; againstType: 'OWNER' | 'CUSTOMER' | 'PLATFORM'; againstId: string | null; category: string; subject: string; description: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }, tx: Prisma.TransactionClient): Promise<string> {
  const id = newId();
  const complaintNumber = await repo.nextComplaintNumber(scope, tx);
  await repo.insertComplaint(scope, { id, complaintNumber, raisedByUserId: scope.actor.userId, bookingId: input.bookingId, tripId: input.tripId, againstType: input.againstType, againstId: input.againstId, category: input.category, subject: input.subject, description: input.description, severity: input.severity, status: 'OPEN' }, tx);
  await writeAudit({ ...audit(scope), action: 'complaint.raised', entityType: 'complaint', entityId: id, afterValue: { complaintNumber, againstType: input.againstType, category: input.category, severity: input.severity, bookingId: input.bookingId, dispute: true } }, tx);
  await publishEvent('complaint', id, 'complaint.raised', { complaintNumber, raisedByUserId: scope.actor.userId, againstType: input.againstType, category: input.category, severity: input.severity, bookingId: input.bookingId, subject: input.subject, dispute: true }, tx);
  return id;
}

/** Resolves every open complaint on a booking with the dispute outcome. */
export async function resolveDisputeComplaints(scope: ActorScope, bookingId: string, resolution: string, tx: Prisma.TransactionClient): Promise<string[]> {
  const open = await tx.complaint.findMany({ where: { bookingId, status: { in: ['OPEN', 'IN_REVIEW', 'AWAITING_RESPONSE'] } }, select: { id: true, complaintNumber: true, raisedByUserId: true, status: true } });
  for (const c of open) {
    await repo.updateComplaint(scope, c.id, { status: 'RESOLVED', resolution, resolvedAt: new Date(), ...(scope.actor.userId ? { assignedToUserId: scope.actor.userId } : {}) }, tx);
    await writeAudit({ ...audit(scope), action: 'complaint.status_changed', entityType: 'complaint', entityId: c.id, beforeValue: { status: c.status }, afterValue: { status: 'RESOLVED', resolution, by: 'dispute-resolution' } }, tx);
    await publishEvent('complaint', c.id, 'complaint.resolved', { complaintNumber: c.complaintNumber, raisedByUserId: c.raisedByUserId, status: 'RESOLVED', resolution }, tx);
  }
  return open.map((c) => c.id);
}
