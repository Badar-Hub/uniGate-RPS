import type { Prisma } from '@prisma/client';
import type { AcceptBidResultDto, ActorScope, AnyScope, AwardResultDto, BookingDto, TripRequestDto } from '@unigate/types';
import type { acceptBidBody, assignPlatformVehicleBody, awardBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { money } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { createAwardedBooking, creditExposureOf, getBooking } from '@/modules/bookings/booking.service.js';
import { platformFleetOwnerId } from '@/modules/profiles/owner.service.js';
import { getTripRequest, recordAward, requestOccupancyWindow, requestRowForBidding } from '@/modules/demand/trip-request.service.js';
import { resolveCommission, type CommissionOverride, type ResolvedCommission } from '@/modules/finance/commission.service.js';
import { vehicleForAward } from '@/modules/fleet/vehicle.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { billingProfileOf } from '@/modules/profiles/customer.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { ownerDisplayName } from './bidding.mapper.js';
import { assertRequestOpenForBids, biddingSystemScope, computeTotals, rejectLiveBidsOnRequest, requestOverride } from './bid.service.js';
import * as repo from './bid.repository.js';

/**
 * The acceptance transaction (api.md §6.4 `POST /bids/{id}/accept` and `POST /trip-requests/{id}/award`).
 * One transaction, lock order trip_requests → bids → vehicles → corporate_customer_profiles, so two
 * concurrent awards cannot deadlock and cannot both pass a check only one of them fits. The vehicle
 * calendar's EXCLUDE constraint is the final arbiter: a 23P01 anywhere rolls the whole set back.
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

type RequestRow = NonNullable<Awaited<ReturnType<typeof requestRowForBidding>>>;

interface AwardSettings {
  bufferMinutes: number;
  paymentWindowMinutes: number;
  nonCircumventionMonths: number;
  basisDefault: 'GROSS' | 'NET_OF_VAT';
}

async function awardSettings(): Promise<AwardSettings> {
  const [bufferMinutes, paymentWindowMinutes, nonCircumventionMonths, basisDefault] = await Promise.all([
    getSettingValue<number>('booking.turnaround_buffer_minutes', 60),
    getSettingValue<number>('booking.payment_window_minutes', 30),
    getSettingValue<number>('bidding.non_circumvention_months', 12),
    getSettingValue<'GROSS' | 'NET_OF_VAT'>('finance.commission_basis_default', 'NET_OF_VAT'),
  ]);
  return { bufferMinutes, paymentWindowMinutes, nonCircumventionMonths, basisDefault };
}

function awardOverride(scope: ActorScope, o: z.infer<typeof acceptBidBody>['commissionOverride']): CommissionOverride | null {
  if (!o) return null;
  if (!scope.actor.permissions.has('commissions.override')) throw new ForbiddenError('COMMISSION_OVERRIDE_FORBIDDEN', 'commissions.override is required to set an award-time commission override');
  return { type: o.type, value: o.value, basis: o.basis, reason: o.reason, setByUserId: scope.actor.userId, setAt: new Date().toISOString() };
}

/** The customer (OWN) or staff (GLOBAL) — an owner can never accept. */
function assertCustomerOf(scope: ActorScope, r: RequestRow): void {
  if (scope.kind === 'GLOBAL') return;
  if (r.customerProfileId !== scope.actor.customerProfileId) throw new NotFoundError();
}

/** Steps 1–2 of §6.4: lock, then read the locked row; assert open, unfilled, and the deadline. */
async function lockedRequest(scope: ActorScope, id: string, tx: Prisma.TransactionClient, now: Date): Promise<RequestRow> {
  if (!(await repo.lockTripRequest(scope, id, tx))) throw new NotFoundError();
  const r = await requestRowForBidding(scope, id, tx);
  if (!r) throw new NotFoundError();
  assertCustomerOf(scope, r);
  if (r.vehiclesAwarded >= r.vehiclesRequired) throw new ConflictError('TRIP_REQUEST_FULLY_AWARDED', 'Every vehicle on this request has already been awarded', { vehiclesRequired: r.vehiclesRequired, vehiclesAwarded: r.vehiclesAwarded });
  assertRequestOpenForBids(r, now);
  return r;
}

/** Step 3: the bids, locked in ascending id order, each SUBMITTED, unexpired and on this request. */
async function lockedBids(scope: AnyScope, r: RequestRow, ids: string[], tx: Prisma.TransactionClient, now: Date): Promise<repo.BidRow[]> {
  const locked = await repo.lockBids(scope, ids, tx);
  const rows: repo.BidRow[] = [];
  for (const id of ids) {
    if (!locked.includes(id)) throw new NotFoundError('NOT_FOUND', 'Bid not found', { bidId: id });
    const b = await repo.findBid(scope, id, tx);
    if (b?.tripRequestId !== r.id) throw new NotFoundError('NOT_FOUND', 'Bid not found on this request', { bidId: id });
    if (b.status !== 'SUBMITTED') throw new BusinessRuleError('BID_INVALID_TRANSITION', `Bid ${b.bidNumber} is ${b.status}, not SUBMITTED`, { bidId: id, status: b.status });
    if (b.validUntil <= now) throw new BusinessRuleError('BID_EXPIRED', `Bid ${b.bidNumber} expired at ${b.validUntil.toISOString()}`, { bidId: id, validUntil: b.validUntil.toISOString() });
    rows.push(b);
  }
  const vehicles = new Set(rows.map((b) => b.vehicleId));
  if (vehicles.size !== rows.length) throw new BusinessRuleError('VALIDATION_FAILED', 'Two bids in the set offer the same vehicle', { fieldErrors: { bidIds: ['duplicate vehicle'] }, formErrors: [] });
  return rows;
}

/** Step 6: only when INVOICED — status must be APPROVED and exposure + this award must fit under the limit. */
async function creditCheck(scope: AnyScope, r: RequestRow, total: ReturnType<typeof money>, tx: Prisma.TransactionClient) {
  await repo.lockCorporateProfile(scope, r.customerProfileId, tx);
  const billing = await billingProfileOf(scope, r.customerProfileId, tx);
  if (billing.mode !== 'INVOICED') return billing;
  if (billing.creditStatus !== 'APPROVED') throw new BusinessRuleError('RULE_CREDIT_NOT_APPROVED', `Credit status is ${billing.creditStatus}; INVOICED bookings need APPROVED credit`, { creditStatus: billing.creditStatus });
  const exposure = await creditExposureOf(scope, r.customerProfileId, tx);
  const outstanding = money(exposure.receivable).add(money(exposure.uninvoiced));
  const limit = money(billing.creditLimitAmount);
  if (outstanding.add(total).gt(limit)) {
    throw new BusinessRuleError('RULE_CREDIT_LIMIT_EXCEEDED', 'This award would exceed the customer’s credit limit', { creditLimitAmount: limit.toFixed(2), outstanding: outstanding.toFixed(2), thisAward: total.toFixed(2) });
  }
  return billing;
}

/** Steps 4, 7–10 for one bid. */
async function bookOne(scope: ActorScope, r: RequestRow, b: repo.BidRow, seq: number, billing: Awaited<ReturnType<typeof billingProfileOf>>, override: CommissionOverride | null, s: AwardSettings, tx: Prisma.TransactionClient, now: Date) {
  const v = await vehicleForAward(b.vehicleId, r.pickupAt);
  if (!v) throw new NotFoundError('NOT_FOUND', 'Vehicle no longer exists', { vehicleId: b.vehicleId });
  if (!v.dispatch.ok) throw new BusinessRuleError('VEHICLE_NOT_DISPATCHABLE', `Vehicle ${v.plateNumberEn} is no longer dispatchable`, { bidId: b.id, vehicleId: v.id, reasons: v.dispatch.reasons });
  // A-57: UniGate's own fleet earns no commission from itself — the whole fare is transport revenue, not an owner payable.
  const commission: ResolvedCommission = b.ownerProfile.isPlatformFleet
    ? { source: 'NONE', type: 'NONE', value: null, basis: s.basisDefault, minAmount: null, maxAmount: null, rule: null, override: null }
    : await resolveCommission(scope, { ownerProfileId: b.ownerProfileId, vehicleCategoryId: v.vehicleCategoryId, transportType: r.transportType, at: now, awardOverride: override, requestOverride: requestOverride(r), basisDefault: s.basisDefault }, tx);
  const window = requestOccupancyWindow(r, b.estimatedDurationMinutes);
  const nonCircumventionUntil = s.nonCircumventionMonths > 0 ? new Date(new Date(now).setUTCMonth(now.getUTCMonth() + s.nonCircumventionMonths)) : null;
  const booking = await createAwardedBooking(
    scope,
    {
      request: r,
      bid: { id: b.id, vehicleId: b.vehicleId, driverProfileId: b.driverProfileId, baseAmount: b.baseAmount, extrasAmount: b.extrasAmount, vatRate: b.vatRate, vatAmount: b.vatAmount, totalAmount: b.totalAmount, currency: b.currency },
      vehicle: { plateNumberEn: v.plateNumberEn, description: v.description, categoryCode: v.categoryCode },
      owner: { id: b.ownerProfileId, name: ownerDisplayName(b.ownerProfile), isVatRegistered: b.ownerProfile.isVatRegistered, vatNumber: b.ownerProfile.vatNumber },
      schedule: { startAt: window.from, endAt: window.to, bufferMinutes: s.bufferMinutes },
      billing: { mode: billing.mode, creditTermsDays: billing.creditTermsDays, paymentWindowMinutes: s.paymentWindowMinutes },
      commission, fulfilmentSequence: seq, nonCircumventionUntil, actorUserId: scope.actor.userId, now,
    },
    tx,
  );
  await tx.bid.update({ where: { id: b.id }, data: { status: 'ACCEPTED', decidedAt: now } });
  await writeAudit({ ...audit(scope), action: 'bid.accepted', entityType: 'bid', entityId: b.id, severity: 'NOTICE', afterValue: { bookingId: booking.id, bookingNumber: booking.bookingNumber, billingMode: billing.mode, commissionSource: commission.source, actedFor: scope.kind === 'GLOBAL' ? 'customer' : 'self' } }, tx);
  await publishEvent('booking', booking.id, 'booking.created', { bookingNumber: booking.bookingNumber, tripRequestId: r.id, bidId: b.id, customerProfileId: r.customerProfileId, ownerProfileId: b.ownerProfileId, vehicleId: b.vehicleId, status: booking.status, billingMode: billing.mode, totalAmount: booking.totalAmount.toFixed(2) }, tx);
  return booking;
}

async function finish(scope: ActorScope, r: RequestRow, awardedBidIds: string[], tx: Prisma.TransactionClient): Promise<void> {
  const after = await recordAward(scope, r, awardedBidIds.length, tx);
  if (after.status === 'FULLY_AWARDED') await rejectLiveBidsOnRequest(biddingSystemScope, r.id, 'request fully awarded', tx, awardedBidIds);
  await publishEvent('trip_request', r.id, after.status === 'FULLY_AWARDED' ? 'trip_request.fully_awarded' : 'trip_request.partially_awarded', { requestNumber: r.requestNumber, vehiclesRequired: r.vehiclesRequired, vehiclesAwarded: after.vehiclesAwarded, awardedBidIds }, tx);
}

const TX = { maxWait: 10_000, timeout: 30_000 } as const;

/** POST /bids/{id}/accept — one bid, one booking; the partial-fulfilment path. */
export async function acceptBid(scope: ActorScope, bidId: string, body: z.infer<typeof acceptBidBody>): Promise<AcceptBidResultDto> {
  const override = awardOverride(scope, body.commissionOverride);
  const s = await awardSettings();
  const now = new Date();
  const peek = await repo.findBid(scope, bidId);
  if (!peek) throw new NotFoundError();
  const bookingId = await prisma().$transaction(async (tx) => {
    const r = await lockedRequest(scope, peek.tripRequestId, tx, now);
    if (!r.allowPartialFulfilment && r.vehiclesRequired > 1) {
      throw new BusinessRuleError('RULE_PARTIAL_AWARD_NOT_ALLOWED', 'This request must be awarded as a whole', { tripRequestId: r.id, vehiclesRequired: r.vehiclesRequired, vehiclesAwarded: r.vehiclesAwarded, remainder: r.vehiclesRequired - r.vehiclesAwarded, awardEndpoint: `POST /api/v1/trip-requests/${r.id}/award` });
    }
    const [b] = await lockedBids(scope, r, [bidId], tx, now);
    if (!b) throw new NotFoundError();
    await repo.lockVehicles(scope, [b.vehicleId], tx);
    const billing = await creditCheck(scope, r, b.totalAmount, tx);
    const booking = await bookOne(scope, r, b, r.vehiclesAwarded + 1, billing, override, s, tx, now);
    await finish(scope, r, [b.id], tx);
    return booking.id;
  }, TX);
  return { booking: await getBooking(scope, bookingId), tripRequest: await getTripRequest(scope, peek.tripRequestId) };
}

/**
 * POST /trip-requests/{id}/assign-platform-vehicle — ops put one of UniGate's own vehicles on a
 * request without a bid (A-57 / FR-FLEET-13). A bid row is still written, marked as the ops
 * decision, so the award path, the reservation and the frozen snapshot are exactly the ones every
 * subcontracted booking goes through; the snapshot simply carries no commission.
 */
export async function assignPlatformVehicle(scope: ActorScope, tripRequestId: string, body: z.infer<typeof assignPlatformVehicleBody>): Promise<AcceptBidResultDto> {
  const s = await awardSettings();
  const now = new Date();
  const platformOwnerId = await platformFleetOwnerId(scope);
  if (!platformOwnerId) throw new BusinessRuleError('PLATFORM_FLEET_VEHICLE_REQUIRED', 'No platform-fleet owner is configured');
  const v = await vehicleForAward(body.vehicleId, now);
  if (!v) throw new NotFoundError('NOT_FOUND', 'Vehicle not found', { vehicleId: body.vehicleId });
  if (v.ownerProfileId !== platformOwnerId) throw new BusinessRuleError('PLATFORM_FLEET_VEHICLE_REQUIRED', `Vehicle ${v.plateNumberEn} is not part of UniGate's own fleet; subcontracted vehicles are awarded through their bids`, { vehicleId: v.id });
  const totals = await computeTotals(body.baseAmount, body.extrasBreakdown);
  const bidId = newId();
  const bookingId = await prisma().$transaction(async (tx) => {
    const r = await lockedRequest(scope, tripRequestId, tx, now);
    if (v.vehicleCategoryId !== r.vehicleCategoryId) throw new BusinessRuleError('BID_NOT_ELIGIBLE', `Vehicle category ${v.categoryCode} does not match the request`, { vehicleId: v.id, categoryCode: v.categoryCode });
    const bidNumber = await repo.nextBidNumber(scope, tx);
    await tx.bid.create({
      data: {
        id: bidId, bidNumber, tripRequestId: r.id, ownerProfileId: platformOwnerId, vehicleId: v.id, driverProfileId: body.driverProfileId ?? null,
        baseAmount: totals.baseAmount, extrasAmount: totals.extrasAmount, extrasBreakdown: body.extrasBreakdown, vatRate: totals.vatRate, vatAmount: totals.vatAmount, totalAmount: totals.totalAmount, currency: r.currency,
        estimatedDurationMinutes: body.estimatedDurationMinutes ?? null, validUntil: new Date(now.getTime() + 60_000), ownerNotes: body.notes ?? 'Platform fleet — direct assignment by operations', status: 'SUBMITTED', version: 1, submittedAt: now,
      },
    });
    const [b] = await lockedBids(scope, r, [bidId], tx, now);
    if (!b) throw new NotFoundError();
    await repo.lockVehicles(scope, [b.vehicleId], tx);
    const billing = await creditCheck(scope, r, b.totalAmount, tx);
    const booking = await bookOne(scope, r, b, r.vehiclesAwarded + 1, billing, null, s, tx, now);
    await writeAudit({ ...audit(scope), action: 'trip_request.platform_vehicle_assigned', entityType: 'trip_request', entityId: r.id, severity: 'NOTICE', afterValue: { vehicleId: v.id, plate: v.plateNumberEn, bookingId: booking.id, bookingNumber: booking.bookingNumber, totalAmount: totals.totalAmount.toFixed(2) } }, tx);
    await finish(scope, r, [bidId], tx);
    return booking.id;
  }, TX);
  return { booking: await getBooking(scope, bookingId), tripRequest: await getTripRequest(scope, tripRequestId) };
}

/** POST /trip-requests/{id}/award — all-or-nothing: the bid set must cover the remainder exactly. */
export async function awardRequest(scope: ActorScope, tripRequestId: string, body: z.infer<typeof awardBody>): Promise<AwardResultDto> {
  const override = awardOverride(scope, body.commissionOverride);
  const s = await awardSettings();
  const now = new Date();
  const ids = [...body.bidIds].sort();
  const bookingIds = await prisma().$transaction(async (tx) => {
    const r = await lockedRequest(scope, tripRequestId, tx, now);
    const remainder = r.vehiclesRequired - r.vehiclesAwarded;
    if (ids.length !== remainder) throw new BusinessRuleError('RULE_AWARD_SET_INCOMPLETE', `The bid set must cover the remainder exactly (${remainder}), got ${ids.length}`, { remainder, suppliedBidCount: ids.length });
    const bids = await lockedBids(scope, r, ids, tx, now);
    await repo.lockVehicles(scope, bids.map((b) => b.vehicleId).sort(), tx);
    const total = bids.reduce((acc, b) => acc.add(b.totalAmount), money(0));
    const billing = await creditCheck(scope, r, total, tx);
    const out: string[] = [];
    let seq = r.vehiclesAwarded;
    for (const b of bids) out.push((await bookOne(scope, r, b, ++seq, billing, override, s, tx, now)).id);
    await finish(scope, r, bids.map((b) => b.id), tx);
    return out;
  }, TX);
  const bookings: BookingDto[] = [];
  for (const id of bookingIds) bookings.push(await getBooking(scope, id));
  const tripRequest: TripRequestDto = await getTripRequest(scope, tripRequestId);
  return { bookings, tripRequest };
}
