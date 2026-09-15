import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, BidDto } from '@unigate/types';
import type { createBidBody, patchBidBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { type Decimal, money, round2, round4, vatOn } from '@/common/money.js';
import { isUniqueViolation, prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { biddingOpen, requestRowForBidding } from '@/modules/demand/trip-request.service.js';
import { describeCommission, resolveCommission, type CommissionOverride } from '@/modules/finance/commission.service.js';
import { vehicleForAward } from '@/modules/fleet/vehicle.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { driverNominationCheck } from '@/modules/profiles/driver.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { toBidDto } from './bidding.mapper.js';
import * as repo from './bid.repository.js';

/**
 * Bids (api.md §8.13, §6.4 `POST /bids`): submission, revision, withdrawal, courtesy rejection,
 * the comparison list and expiry. Totals are computed here and only here — the client's numbers
 * are not compared, they are not accepted. Acceptance and group award live in award.service.
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}
const systemScope: AnyScope = { kind: 'SYSTEM', jobName: 'bidding', requestId: 'internal' };

type RequestRow = NonNullable<Awaited<ReturnType<typeof requestRowForBidding>>>;

/** The request-level override as the finance module understands it, or null. */
export function requestOverride(r: RequestRow): CommissionOverride | null {
  if (!r.commissionOverrideType) return null;
  return { type: r.commissionOverrideType, value: r.commissionOverrideValue?.toString(), basis: r.commissionOverrideBasis ?? undefined, reason: r.commissionOverrideReason ?? 'request-level override', setByUserId: r.commissionOverrideSetByUserId, setAt: r.commissionOverrideSetAt?.toISOString() ?? null };
}

/** FR-FINANCE-22: the commission an owner priced against, when settings allow showing it. */
async function effectiveCommissionFor(scope: AnyScope, b: repo.BidRow): Promise<BidDto['effectiveCommission']> {
  const staff = scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL';
  const isOwner = !staff && scope.actor.ownerProfileId === b.ownerProfileId;
  if (!staff && !isOwner) return null;
  if (isOwner && !(await getSettingValue<boolean>('bidding.show_effective_commission_to_owners', true))) return null;
  const r = await requestRowForBidding(systemScope, b.tripRequestId);
  if (!r?.vehicleCategoryId) return null;
  const basisDefault = await getSettingValue<'GROSS' | 'NET_OF_VAT'>('finance.commission_basis_default', 'NET_OF_VAT');
  return describeCommission(await resolveCommission(scope, { ownerProfileId: b.ownerProfileId, vehicleCategoryId: r.vehicleCategoryId, transportType: r.transportType, at: new Date(), requestOverride: requestOverride(r), basisDefault }));
}

async function dto(scope: AnyScope, b: repo.BidRow): Promise<BidDto> {
  return toBidDto(b, await effectiveCommissionFor(scope, b));
}

export async function getBid(scope: AnyScope, id: string): Promise<BidDto> {
  const b = await repo.findBid(scope, id);
  if (!b) throw new NotFoundError();
  return dto(scope, b);
}

export async function listBids(scope: AnyScope, f: repo.BidFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listBids(scope, f, page);
  const dtos: BidDto[] = [];
  for (const b of items) dtos.push(await dto(scope, b));
  return { items: dtos, total };
}

/** The customer's comparison list; an owner reaches only their own rows through the same scope. */
export async function listRequestBids(scope: AnyScope, tripRequestId: string, f: { status?: string | undefined; sort: 'totalAmount' | 'submittedAt' | 'estimatedArrivalAt'; order: 'asc' | 'desc' }, page: { page: number; pageSize: number }) {
  // The customer owns the request; an invited owner is a party to it. Either may list — the bid scope then filters the rows.
  const r = await requestRowForBidding(scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? scope : { ...scope, kind: 'PARTY' }, tripRequestId);
  if (!r) throw new NotFoundError();
  const { items, total } = await repo.listRequestBids(scope, tripRequestId, f, page);
  const dtos: BidDto[] = [];
  for (const b of items) dtos.push(await dto(scope, b));
  return { items: dtos, total };
}

// ── totals ───────────────────────────────────────────────────────────────────

export interface Totals {
  baseAmount: Decimal;
  extrasAmount: Decimal;
  vatRate: Decimal;
  vatAmount: Decimal;
  totalAmount: Decimal;
}

/** extras = Σ extras; vat = round_half_up((base + extras) × rate); total = base + extras + vat — with the rate from settings, snapshotted. */
export async function computeTotals(baseAmount: string, extras: { amount: string }[]): Promise<Totals> {
  const base = round2(money(baseAmount));
  const extrasAmount = extras.reduce((acc, e) => acc.add(money(e.amount)), money(0));
  if (base.lte(0) || extrasAmount.lt(0)) throw new BusinessRuleError('BID_AMOUNT_INVALID', 'baseAmount must be positive and no extra may be negative');
  const vatPct = await getSettingValue<number>('finance.vat_rate_pct', 15);
  const vatRate = round4(money(vatPct).div(100));
  const vatAmount = vatOn(base.add(extrasAmount), vatRate);
  return { baseAmount: base, extrasAmount: round2(extrasAmount), vatRate, vatAmount, totalAmount: base.add(extrasAmount).add(vatAmount) };
}

// ── request gate ─────────────────────────────────────────────────────────────

/** api.md §6.4: TRIP_REQUEST_NOT_OPEN / _REMAINDER_CLOSED / _BIDDING_WINDOW_CLOSED. Returns the applicable deadline. */
export function assertRequestOpenForBids(r: RequestRow, at = new Date()): Date {
  if (r.status === 'CLOSED_PARTIAL') throw new BusinessRuleError('TRIP_REQUEST_REMAINDER_CLOSED', 'The customer has closed the unfilled balance of this request');
  if (r.status !== 'PUBLISHED' && r.status !== 'PARTIALLY_AWARDED') throw new BusinessRuleError('TRIP_REQUEST_NOT_OPEN', `Request is ${r.status}; bids are accepted while PUBLISHED or PARTIALLY_AWARDED`, { status: r.status });
  if (!biddingOpen(r, at)) {
    const deadlineField = r.status === 'PUBLISHED' ? 'biddingClosesAt' : 'remainderClosesAt';
    throw new BusinessRuleError('TRIP_REQUEST_BIDDING_WINDOW_CLOSED', 'The bidding window for this request has closed', { deadlineField, deadline: (deadlineField === 'biddingClosesAt' ? r.biddingClosesAt : r.remainderClosesAt)?.toISOString() ?? null });
  }
  return r.status === 'PUBLISHED' ? r.biddingClosesAt : (r.remainderClosesAt ?? new Date(r.pickupAt.getTime()));
}

function resolveValidUntil(requested: string | undefined, deadline: Date, validityHours: number, now: Date): Date {
  const cap = deadline;
  if (requested) {
    const v = new Date(requested);
    if (v <= now) throw new BusinessRuleError('BID_VALIDITY_INVALID', 'validUntil must be in the future', { validUntil: requested });
    if (v > cap) throw new BusinessRuleError('BID_VALIDITY_INVALID', 'validUntil is past the request deadline', { validUntil: requested, deadline: cap.toISOString() });
    return v;
  }
  return new Date(Math.min(now.getTime() + validityHours * 3_600_000, cap.getTime()));
}

// ── submit / revise / withdraw / reject ──────────────────────────────────────

export async function submitBid(scope: ActorScope, body: z.infer<typeof createBidBody>): Promise<BidDto> {
  const ownerProfileId = scope.actor.ownerProfileId;
  if (!ownerProfileId) throw new ForbiddenError('PERM_DENIED', 'Only a vehicle owner can bid');
  const now = new Date();
  // PARTY: the owner reaches the request through their invitation — no invitation, no request (404 → BID_NOT_ELIGIBLE below).
  const r = await requestRowForBidding({ ...scope, kind: 'PARTY' }, body.tripRequestId);
  if (!r) throw new BusinessRuleError('BID_NOT_ELIGIBLE', 'You were not invited to bid on this request', { tripRequestId: body.tripRequestId });
  const deadline = assertRequestOpenForBids(r, now);

  const v = await vehicleForAward(body.vehicleId, r.pickupAt);
  if (v?.ownerProfileId !== ownerProfileId) throw new NotFoundError('NOT_FOUND', 'Vehicle not found', { vehicleId: body.vehicleId });
  if (v.vehicleCategoryId !== r.vehicleCategoryId) throw new BusinessRuleError('BID_NOT_ELIGIBLE', `Vehicle category ${v.categoryCode} does not match the request`, { vehicleId: v.id, categoryCode: v.categoryCode });
  if (!v.dispatch.ok) {
    if (v.dispatch.reasons.includes('OWNER_NOT_APPROVED')) throw new BusinessRuleError('OWNER_NOT_APPROVED', 'The owner profile is not approved', { reasons: v.dispatch.reasons });
    throw new BusinessRuleError('VEHICLE_NOT_DISPATCHABLE', 'The vehicle cannot be dispatched', { reasons: v.dispatch.reasons });
  }

  const requiresDriver = await getSettingValue<boolean>('bidding.bid_requires_driver_nomination', false);
  if (requiresDriver && !body.driverProfileId) throw new BusinessRuleError('VALIDATION_FAILED', 'A driver must be nominated on the bid', { fieldErrors: { driverProfileId: ['required'] }, formErrors: [] });
  if (body.driverProfileId) await assertDriver(scope, body.driverProfileId, ownerProfileId, now);

  // Same vehicle twice is a 409 before the per-owner limit is a 422 — the partial unique index would say the same, later.
  if (await repo.hasLiveBidForVehicle(scope, r.id, v.id)) throw new ConflictError('BID_DUPLICATE_VEHICLE', 'This vehicle already has a live bid on this request', { vehicleId: v.id, tripRequestId: r.id });
  const maxActive = await getSettingValue<number>('bidding.max_active_bids_per_owner_per_request', 1);
  if ((await repo.countActiveForOwner(scope, r.id, ownerProfileId)) >= maxActive) throw new BusinessRuleError('BID_LIMIT_REACHED', `At most ${maxActive} live bid(s) per owner on a request; revise or withdraw the existing one`, { maxActive });

  const validityHours = await getSettingValue<number>('bidding.bid_validity_hours', 24);
  const validUntil = resolveValidUntil(body.validUntil, deadline, validityHours, now);
  const totals = await computeTotals(body.baseAmount, body.extrasBreakdown);
  const id = newId();
  try {
    await prisma().$transaction(async (tx) => {
      const bidNumber = await repo.nextBidNumber(scope, tx);
      await tx.bid.create({
        data: {
          id, bidNumber, tripRequestId: r.id, ownerProfileId, vehicleId: v.id, driverProfileId: body.driverProfileId ?? null,
          baseAmount: totals.baseAmount, extrasAmount: totals.extrasAmount, extrasBreakdown: body.extrasBreakdown, vatRate: totals.vatRate, vatAmount: totals.vatAmount, totalAmount: totals.totalAmount, currency: r.currency,
          estimatedArrivalAt: body.estimatedArrivalAt ? new Date(body.estimatedArrivalAt) : null, estimatedDurationMinutes: body.estimatedDurationMinutes ?? null, validUntil, ownerNotes: body.ownerNotes ?? null, status: 'SUBMITTED', version: 1, submittedAt: now,
        },
      });
      await writeAudit({ ...audit(scope), action: 'bid.submitted', entityType: 'bid', entityId: id, afterValue: { bidNumber, tripRequestId: r.id, vehicleId: v.id, totalAmount: totals.totalAmount.toFixed(2) } }, tx);
      await publishEvent('bid', id, 'bid.submitted', { bidNumber, tripRequestId: r.id, requestNumber: r.requestNumber, customerProfileId: r.customerProfileId, ownerProfileId, totalAmount: totals.totalAmount.toFixed(2) }, tx);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError('BID_DUPLICATE_VEHICLE', 'This vehicle already has a live bid on this request', { vehicleId: v.id, tripRequestId: r.id });
    throw e;
  }
  return getBid(scope, id);
}

async function assertDriver(scope: AnyScope, driverProfileId: string, ownerProfileId: string, at: Date): Promise<void> {
  const check = await driverNominationCheck(scope, driverProfileId, ownerProfileId, at);
  if (check.ok) return;
  if (check.code === 'NOT_FOUND') throw new NotFoundError('NOT_FOUND', 'Driver not found', { driverProfileId });
  throw new BusinessRuleError(check.code, check.code === 'DRIVER_NOT_APPROVED' ? 'The nominated driver is not approved' : 'The nominated driver’s licence has expired', { driverProfileId });
}

/** PATCH /bids/{id}: version++, totals recomputed, status stays SUBMITTED; refused after the deadline (V4). */
export async function reviseBid(scope: ActorScope, id: string, body: z.infer<typeof patchBidBody>): Promise<BidDto> {
  const b = await repo.findBid(scope, id);
  if (b?.ownerProfileId !== scope.actor.ownerProfileId) throw new NotFoundError();
  if (b.status !== 'SUBMITTED') throw new BusinessRuleError('BID_INVALID_TRANSITION', `Only a SUBMITTED bid can be revised (current: ${b.status})`, { status: b.status });
  const now = new Date();
  const r = await requestRowForBidding(systemScope, b.tripRequestId);
  if (!r) throw new NotFoundError();
  const deadline = assertRequestOpenForBids(r, now);
  if (body.driverProfileId) await assertDriver(scope, body.driverProfileId, b.ownerProfileId, now);
  const extras = body.extrasBreakdown ?? (Array.isArray(b.extrasBreakdown) ? (b.extrasBreakdown as { amount: string }[]) : []);
  const totals = await computeTotals(body.baseAmount ?? b.baseAmount.toFixed(2), extras);
  const validityHours = await getSettingValue<number>('bidding.bid_validity_hours', 24);
  const validUntil = body.validUntil ? resolveValidUntil(body.validUntil, deadline, validityHours, now) : b.validUntil;
  await prisma().$transaction(async (tx) => {
    await tx.bid.update({
      where: { id },
      data: {
        ...(body.driverProfileId !== undefined ? { driverProfileId: body.driverProfileId } : {}),
        baseAmount: totals.baseAmount, extrasAmount: totals.extrasAmount, ...(body.extrasBreakdown ? { extrasBreakdown: body.extrasBreakdown } : {}), vatRate: totals.vatRate, vatAmount: totals.vatAmount, totalAmount: totals.totalAmount,
        ...(body.estimatedArrivalAt !== undefined ? { estimatedArrivalAt: body.estimatedArrivalAt ? new Date(body.estimatedArrivalAt) : null } : {}),
        ...(body.estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes: body.estimatedDurationMinutes } : {}),
        ...(body.ownerNotes !== undefined ? { ownerNotes: body.ownerNotes } : {}),
        validUntil, version: { increment: 1 }, lastRevisedAt: now,
      },
    });
    await writeAudit({ ...audit(scope), action: 'bid.revised', entityType: 'bid', entityId: id, beforeValue: { version: b.version, totalAmount: b.totalAmount.toFixed(2) }, afterValue: { version: b.version + 1, totalAmount: totals.totalAmount.toFixed(2) }, changedFields: Object.keys(body) }, tx);
    await publishEvent('bid', id, 'bid.revised', { bidNumber: b.bidNumber, tripRequestId: b.tripRequestId, customerProfileId: b.tripRequest.customerProfileId, version: b.version + 1, totalAmount: totals.totalAmount.toFixed(2) }, tx);
  });
  return getBid(scope, id);
}

export async function withdrawBid(scope: ActorScope, id: string, reason?: string): Promise<BidDto> {
  const b = await repo.findBid(scope, id);
  if (b?.ownerProfileId !== scope.actor.ownerProfileId) throw new NotFoundError();
  if (b.status !== 'SUBMITTED') throw new BusinessRuleError('BID_INVALID_TRANSITION', `Only a SUBMITTED bid can be withdrawn (current: ${b.status})`, { status: b.status });
  await prisma().$transaction(async (tx) => {
    await tx.bid.update({ where: { id }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
    await writeAudit({ ...audit(scope), action: 'bid.withdrawn', entityType: 'bid', entityId: id, afterValue: { reason: reason ?? null } }, tx);
    await publishEvent('bid', id, 'bid.withdrawn', { bidNumber: b.bidNumber, tripRequestId: b.tripRequestId, customerProfileId: b.tripRequest.customerProfileId }, tx);
  });
  return getBid(scope, id);
}

/** Courtesy rejection by the customer (or staff). Siblings are auto-rejected only on full award. */
export async function rejectBid(scope: ActorScope, id: string, reason?: string): Promise<BidDto> {
  const b = await repo.findBid(scope, id);
  if (!b) throw new NotFoundError();
  if (scope.kind !== 'GLOBAL' && b.tripRequest.customerProfileId !== scope.actor.customerProfileId) throw new NotFoundError();
  if (b.status !== 'SUBMITTED') throw new BusinessRuleError('BID_INVALID_TRANSITION', `Only a SUBMITTED bid can be rejected (current: ${b.status})`, { status: b.status });
  await prisma().$transaction(async (tx) => {
    await tx.bid.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: reason ?? null, decidedAt: new Date() } });
    await writeAudit({ ...audit(scope), action: 'bid.rejected', entityType: 'bid', entityId: id, afterValue: { reason: reason ?? null, actedFor: scope.kind === 'GLOBAL' ? 'customer' : 'self' } }, tx);
    await publishEvent('bid', id, 'bid.rejected', { bidNumber: b.bidNumber, tripRequestId: b.tripRequestId, ownerProfileId: b.ownerProfileId, reason: reason ?? null }, tx);
  });
  return getBid(scope, id);
}

// ── cross-module facts ───────────────────────────────────────────────────────

/** Used by demand when a request is cancelled or its remainder closed; and by the award on full award. */
export async function rejectLiveBidsOnRequest(scope: AnyScope, tripRequestId: string, reason: string, tx: Prisma.TransactionClient, except: string[] = []): Promise<string[]> {
  const ids = await repo.rejectLiveBids(scope, tripRequestId, reason, tx, except);
  for (const id of ids) await publishEvent('bid', id, 'bid.rejected', { tripRequestId, reason }, tx);
  return ids;
}

export async function ownerHasAcceptedBid(scope: AnyScope, tripRequestId: string, ownerProfileId: string): Promise<boolean> {
  return repo.ownerHasAcceptedBid(scope, tripRequestId, ownerProfileId);
}

export async function ownerBidOnRequest(scope: AnyScope, tripRequestId: string, ownerProfileId: string): Promise<string | null> {
  return (await repo.findOwnerBidOnRequest(scope, tripRequestId, ownerProfileId))?.id ?? null;
}

// ── jobs ─────────────────────────────────────────────────────────────────────

/** SUBMITTED past valid_until → EXPIRED. */
export async function expireStaleBids(): Promise<number> {
  const stale = await repo.listExpired(systemScope, new Date());
  for (const b of stale) {
    await prisma().$transaction(async (tx) => {
      await tx.bid.updateMany({ where: { id: b.id, status: 'SUBMITTED' }, data: { status: 'EXPIRED', decidedAt: new Date() } });
      await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: 'bid.expired', entityType: 'bid', entityId: b.id, afterValue: { status: 'EXPIRED' } }, tx);
      await publishEvent('bid', b.id, 'bid.expired', { bidNumber: b.bidNumber, tripRequestId: b.tripRequestId, ownerProfileId: b.ownerProfileId }, tx);
    });
  }
  return stale.length;
}

export { systemScope as biddingSystemScope };
