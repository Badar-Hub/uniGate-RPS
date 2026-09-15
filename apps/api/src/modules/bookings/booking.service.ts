import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, BookingDisputeResultDto, BookingDto, BookingFinancialsDto, BookingStatusHistoryDto, CancelBookingResultDto, CancellationQuoteDto } from '@unigate/types';
import { BOOKING_TRANSITIONS, CANCELLATION_REASONS_BY_ROLE } from '@unigate/types';
import type { cancelBookingBody, disputeBookingBody, noShowBody, resolveDisputeBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { type Decimal, money, round2, round4, toMoneyString, toRateString } from '@/common/money.js';
import { isExclusionViolation, prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { recordBookingCancellation } from '@/modules/demand/trip-request.service.js';
import { computeFee, resolvePolicy, type FeeOverride, type FeeVerdict } from '@/modules/finance/cancellation-policy.service.js';
import { CALCULATION_VERSION, computeFinancials, ruleSnapshot, type ResolvedCommission } from '@/modules/finance/commission.service.js';
import { isDriverAssignedToVehicle } from '@/modules/fleet/vehicle.service.js';
import { getComplaint, openDisputeComplaint, resolveDisputeComplaints } from '@/modules/engagement/engagement.service.js';
import { requestRefundForCancellation } from '@/modules/payments/refund.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { driverNominationCheck } from '@/modules/profiles/driver.service.js';
import { toBookingDto, toCancellationDto, toHistoryDto } from './bookings.mapper.js';
import * as repo from './booking.repository.js';

/**
 * Bookings (database.md §10, api.md §8.14): creation at award (called from the bidding award
 * service inside its transaction), reads projected per party, the lifecycle — confirm, dispatch,
 * ready, cancel with the admin-configured fee policy — and the payment-window sweeper. Every
 * transition is asserted against BOOKING_TRANSITIONS and writes booking_status_history.
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}
const systemScope: AnyScope = { kind: 'SYSTEM', jobName: 'bookings', requestId: 'internal' };
type Status = repo.BookingRow['status'];

function assertTransition(b: Pick<repo.BookingRow, 'billingMode' | 'status' | 'bookingNumber'>, to: Status): void {
  const allowed = BOOKING_TRANSITIONS[b.billingMode][b.status];
  if (!allowed.includes(to)) throw new BusinessRuleError('BOOKING_INVALID_TRANSITION', `Booking ${b.bookingNumber} cannot move from ${b.status} to ${to}`, { from: b.status, to, allowed: [...allowed] });
}

async function transition(scope: AnyScope, b: repo.BookingRow, to: Status, reason: string, extra: Prisma.BookingUpdateInput, tx: Prisma.TransactionClient, metadata: Record<string, unknown> = {}): Promise<void> {
  assertTransition(b, to);
  await tx.booking.update({ where: { id: b.id }, data: { status: to, ...extra } });
  await tx.bookingStatusHistory.create({ data: { id: newId(), bookingId: b.id, fromStatus: b.status, toStatus: to, changedByUserId: scope.kind === 'SYSTEM' ? null : scope.actor.userId, actorType: scope.kind === 'SYSTEM' ? 'JOB' : 'USER', reason, metadata: metadata as Prisma.InputJsonValue } });
}

// ── creation (award) ─────────────────────────────────────────────────────────

export interface AwardedBookingInput {
  request: {
    id: string; requestNumber: string; customerProfileId: string; attributedSpoProfileId: string | null; transportType: 'PASSENGER' | 'GOODS';
    pickupAddressLine: string; pickupCityId: string; pickupLatitude: Decimal; pickupLongitude: Decimal;
    dropoffAddressLine: string; dropoffCityId: string; dropoffLatitude: Decimal; dropoffLongitude: Decimal;
  };
  bid: { id: string; vehicleId: string; driverProfileId: string | null; baseAmount: Decimal; extrasAmount: Decimal; vatRate: Decimal; vatAmount: Decimal; totalAmount: Decimal; currency: string };
  vehicle: { plateNumberEn: string; description: string; categoryCode: string };
  owner: { id: string; name: string; isVatRegistered: boolean; vatNumber: string | null };
  schedule: { startAt: Date; endAt: Date; bufferMinutes: number };
  billing: { mode: 'PREPAID' | 'INVOICED'; creditTermsDays: number | null; paymentWindowMinutes: number };
  commission: ResolvedCommission;
  fulfilmentSequence: number;
  nonCircumventionUntil: Date | null;
  actorUserId: string | null;
  now: Date;
}

/** Inserts booking + status history + calendar reservation + financial snapshot (api.md §6.4 steps 8–10). */
export async function createAwardedBooking(scope: AnyScope, input: AwardedBookingInput, tx: Prisma.TransactionClient): Promise<repo.BookingRow> {
  const { request: r, bid, billing, now } = input;
  const id = newId();
  const bookingNumber = await repo.nextBookingNumber(scope, tx);
  // Entry state is keyed on billing mode (A-46): INVOICED never passes through PENDING_PAYMENT.
  const prepaid = billing.mode === 'PREPAID';
  const status = prepaid ? 'PENDING_PAYMENT' : 'CONFIRMED';
  const figures = computeFinancials({ grossAmount: bid.totalAmount, vatRate: bid.vatRate, vatAmount: bid.vatAmount, commission: input.commission, ownerIsVatRegistered: input.owner.isVatRegistered });

  await tx.booking.create({
    data: {
      id, bookingNumber, tripRequestId: r.id, bidId: bid.id, customerProfileId: r.customerProfileId, ownerProfileId: input.owner.id, vehicleId: bid.vehicleId, driverProfileId: bid.driverProfileId, attributedSpoProfileId: r.attributedSpoProfileId,
      vehiclePlateSnapshot: input.vehicle.plateNumberEn, vehicleDescriptionSnapshot: input.vehicle.description.slice(0, 160), vehicleCategoryCodeSnapshot: input.vehicle.categoryCode, ownerNameSnapshot: input.owner.name.slice(0, 160), transportType: r.transportType,
      pickupAddressLine: r.pickupAddressLine, pickupCityId: r.pickupCityId, pickupLatitude: r.pickupLatitude, pickupLongitude: r.pickupLongitude,
      dropoffAddressLine: r.dropoffAddressLine, dropoffCityId: r.dropoffCityId, dropoffLatitude: r.dropoffLatitude, dropoffLongitude: r.dropoffLongitude,
      scheduledStartAt: input.schedule.startAt, scheduledEndAt: input.schedule.endAt,
      agreedBaseAmount: bid.baseAmount, agreedExtrasAmount: bid.extrasAmount, vatRate: round4(bid.vatRate), vatAmount: bid.vatAmount, totalAmount: bid.totalAmount, currency: bid.currency,
      billingMode: billing.mode, creditTermsDaysSnapshot: billing.creditTermsDays, fulfilmentSequence: input.fulfilmentSequence,
      status, paymentStatus: prepaid ? 'UNPAID' : 'INVOICED', paymentDueBy: prepaid ? new Date(now.getTime() + billing.paymentWindowMinutes * 60_000) : null,
      nonCircumventionUntil: input.nonCircumventionUntil, confirmedAt: prepaid ? null : now,
    },
  });
  await tx.bookingStatusHistory.create({ data: { id: newId(), bookingId: id, fromStatus: null, toStatus: status, changedByUserId: input.actorUserId, actorType: 'USER', reason: 'bid accepted', metadata: { bidId: bid.id, billingMode: billing.mode } } });

  try {
    await repo.insertReservation(scope, { id: newId(), vehicleId: bid.vehicleId, bookingId: id, from: input.schedule.startAt, to: input.schedule.endAt, bufferMinutes: input.schedule.bufferMinutes, createdByUserId: input.actorUserId }, tx);
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError('BID_VEHICLE_UNAVAILABLE', 'The vehicle was reserved for an overlapping window while this award was in flight', { vehicleId: bid.vehicleId, bidId: bid.id });
    throw e;
  }

  await tx.bookingFinancialSnapshot.create({
    data: {
      id: newId(), bookingId: id, grossAmount: figures.grossAmount, vatRate: figures.vatRate, vatAmount: figures.vatAmount, netOfVatAmount: figures.netOfVatAmount,
      commissionRuleId: input.commission.rule?.id ?? null, commissionRuleSnapshot: ruleSnapshot(input.commission) as Prisma.InputJsonValue, commissionBasis: figures.commissionBasis, commissionRate: figures.commissionRate, commissionAmount: figures.commissionAmount,
      commissionSource: figures.commissionSource, ...(input.commission.override ? { commissionOverrideSnapshot: input.commission.override as unknown as Prisma.InputJsonValue } : {}), commissionVatAmount: figures.commissionVatAmount,
      paymentFeeAmount: figures.paymentFeeAmount, paymentFeeSnapshot: {}, ownerGrossAmount: figures.ownerGrossAmount, ownerNetAmount: figures.ownerNetAmount,
      spoCommissionAmount: money(0), spoRuleSnapshot: { basis: 'NONE', note: 'SPO commission lands in Phase 11' }, vatTreatment: figures.vatTreatment,
      ownerVatRegisteredSnapshot: input.owner.isVatRegistered, ownerVatNumberSnapshot: input.owner.isVatRegistered ? input.owner.vatNumber : null, currency: bid.currency, computedAt: now, calculationVersion: CALCULATION_VERSION,
    },
  });

  const row = await repo.findBooking(scope, id, tx);
  if (!row) throw new NotFoundError();
  return row;
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Owners and staff see the financial split; the customer (and a driver) sees only the agreed total. */
export function bookingDtoFor(scope: AnyScope, b: repo.BookingRow): BookingDto {
  const staff = scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL';
  const owner = !staff && scope.actor.ownerProfileId === b.ownerProfileId;
  return toBookingDto(b, staff || owner);
}

export async function getBooking(scope: AnyScope, id: string): Promise<BookingDto> {
  const b = await repo.findBooking(scope, id);
  if (!b) throw new NotFoundError();
  return bookingDtoFor(scope, b);
}

export async function listBookings(scope: AnyScope, f: repo.BookingFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listBookings(scope, f, page);
  return { items: items.map((b) => bookingDtoFor(scope, b)), total };
}

export async function listStatusHistory(scope: AnyScope, id: string): Promise<BookingStatusHistoryDto[]> {
  const rows = await repo.listStatusHistory(scope, id);
  if (!rows) throw new NotFoundError();
  return rows.map(toHistoryDto);
}

/** Projected by role: customer → price only; owner → their net; staff with global scope → everything. */
export async function getFinancials(scope: AnyScope, id: string): Promise<BookingFinancialsDto> {
  const b = await repo.findFinancialSnapshot(scope, id);
  if (!b?.financialSnapshot) throw new NotFoundError();
  const f = b.financialSnapshot;
  const staff = scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL';
  const owner = !staff && scope.actor.ownerProfileId === b.ownerProfileId;
  return {
    bookingId: b.id,
    grossAmount: toMoneyString(f.grossAmount), vatRate: toRateString(f.vatRate), vatAmount: toMoneyString(f.vatAmount), netOfVatAmount: toMoneyString(f.netOfVatAmount), currency: f.currency, computedAt: f.computedAt.toISOString(),
    owner: staff || owner ? { commissionAmount: toMoneyString(f.commissionAmount), commissionVatAmount: toMoneyString(f.commissionVatAmount), paymentFeeAmount: toMoneyString(f.paymentFeeAmount), ownerGrossAmount: toMoneyString(f.ownerGrossAmount), ownerNetAmount: toMoneyString(f.ownerNetAmount), vatTreatment: f.vatTreatment } : null,
    finance: staff ? { commissionSource: f.commissionSource, commissionBasis: f.commissionBasis, commissionRate: f.commissionRate ? toRateString(f.commissionRate) : null, commissionRuleId: f.commissionRuleId, commissionRuleSnapshot: (f.commissionRuleSnapshot ?? {}) as Record<string, unknown>, commissionOverrideSnapshot: (f.commissionOverrideSnapshot as Record<string, unknown> | null) ?? null, spoCommissionAmount: toMoneyString(f.spoCommissionAmount), ownerVatRegisteredSnapshot: f.ownerVatRegisteredSnapshot, calculationVersion: f.calculationVersion } : null,
  };
}

export async function creditExposureOf(scope: AnyScope, customerProfileId: string, tx: Prisma.TransactionClient): Promise<{ receivable: string; uninvoiced: string }> {
  return repo.creditExposure(scope, customerProfileId, tx);
}

// ── cancellation ─────────────────────────────────────────────────────────────

type CancellerRole = 'CUSTOMER' | 'OWNER' | 'ADMIN';

/** Who is cancelling, from the scope: staff with global scope act as ADMIN; otherwise the party the actor is on this booking. */
function cancellerRole(scope: ActorScope, b: repo.BookingRow): CancellerRole {
  if (scope.kind === 'GLOBAL') return 'ADMIN';
  if (scope.actor.customerProfileId === b.customerProfileId) return 'CUSTOMER';
  if (scope.actor.ownerProfileId === b.ownerProfileId) return 'OWNER';
  throw new NotFoundError();
}

function hoursBefore(b: repo.BookingRow, now: Date): Decimal {
  return round2(money(b.scheduledStartAt.getTime() - now.getTime()).div(3_600_000));
}

/** Steps 1–2 of the cancellation, shared by the quote and the cancel so they cannot disagree. */
async function assess(scope: ActorScope, b: repo.BookingRow, override: FeeOverride | null, now: Date, tx: Prisma.TransactionClient | null): Promise<{ role: CancellerRole; hours: Decimal; verdict: FeeVerdict }> {
  const role = cancellerRole(scope, b);
  const hours = hoursBefore(b, now);
  // The policy is keyed on the party that cancels; an admin cancelling on someone's behalf charges nothing unless they override (OQ-05).
  const policy = role === 'ADMIN' ? null : await resolvePolicy(scope, { eventType: 'CANCELLATION', role, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, vehicleCategoryId: b.tripRequest.vehicleCategoryId, at: now }, tx);
  const verdict = computeFee({ total: b.totalAmount, hoursBeforePickup: hours, policy, override });
  return { role, hours, verdict };
}

function feeOverrideFor(scope: ActorScope, o: z.infer<typeof cancelBookingBody>['feeOverride']): FeeOverride | null {
  if (!o) return null;
  if (scope.kind !== 'GLOBAL' || !scope.actor.permissions.has('bookings.manage')) throw new ForbiddenError('CANCELLATION_FEE_OVERRIDE_FORBIDDEN', 'A fee override needs bookings.manage with global scope');
  return { type: o.type, value: o.value, reason: o.reason, setByUserId: scope.actor.userId };
}

export async function cancellationQuote(scope: ActorScope, id: string): Promise<CancellationQuoteDto> {
  const b = await repo.findBooking(scope, id);
  if (!b) throw new NotFoundError();
  assertTransition(b, 'CANCELLED');
  const { role, hours, verdict } = await assess(scope, b, null, new Date(), null);
  return { bookingId: b.id, cancelledByRole: role, hoursBeforePickup: hours.toFixed(2), feeAmount: toMoneyString(verdict.feeAmount), refundAmount: toMoneyString(verdict.refundAmount), currency: b.currency, feeSource: verdict.feeSource, feeRuleSnapshot: verdict.ruleSnapshot, windowPassed: verdict.windowPassed, allowedReasonCodes: [...CANCELLATION_REASONS_BY_ROLE[role]] };
}

/** POST /bookings/{id}/cancel — one transaction (api.md §6.4). */
export async function cancelBooking(scope: ActorScope, id: string, body: z.infer<typeof cancelBookingBody>): Promise<CancelBookingResultDto> {
  const override = feeOverrideFor(scope, body.feeOverride);
  if (body.waiveFee && (scope.kind !== 'GLOBAL' || !scope.actor.permissions.has('bookings.manage'))) throw new ForbiddenError('PERM_DENIED', 'waiveFee needs bookings.manage with global scope');
  const now = new Date();
  const peek = await repo.findBooking(scope, id);
  if (!peek) throw new NotFoundError();
  const role = cancellerRole(scope, peek);
  if (!CANCELLATION_REASONS_BY_ROLE[role].includes(body.reasonCode)) throw new BusinessRuleError('CANCELLATION_REASON_NOT_ALLOWED', `${body.reasonCode} is not a reason a ${role.toLowerCase()} can give`, { allowed: [...CANCELLATION_REASONS_BY_ROLE[role]] });

  await prisma().$transaction(async (tx) => {
    await repo.lockBooking(scope, id, tx);
    const b = await repo.findBooking(scope, id, tx);
    if (!b) throw new NotFoundError();
    if (b.status === 'CANCELLED') throw new ConflictError('BOOKING_ALREADY_CANCELLED', `Booking ${b.bookingNumber} is already cancelled`);
    assertTransition(b, 'CANCELLED');
    const { hours, verdict } = await assess(scope, b, override, now, tx);
    if (verdict.windowPassed) throw new BusinessRuleError('BOOKING_CANCELLATION_WINDOW_PASSED', 'Inside the no-cancellation window for this booking', { hoursBeforePickup: hours.toFixed(2), noCancelWindowHours: verdict.ruleSnapshot['noCancelWindowHours'] ?? null });
    const waived = Boolean(body.waiveFee);
    const fee = waived ? money(0) : verdict.feeAmount;
    const refund = round2(b.totalAmount.sub(fee));
    await tx.bookingCancellation.create({
      data: {
        bookingId: b.id, cancelledByUserId: scope.actor.userId, cancelledByRole: role, eventType: 'CANCELLATION', reasonCode: body.reasonCode, reasonText: body.reasonText ?? null, hoursBeforePickup: hours,
        feePayer: fee.gt(0) ? (role === 'OWNER' ? 'OWNER' : 'CUSTOMER') : 'NONE', cancellationFeeAmount: fee, refundAmount: refund, currency: b.currency, feeSource: waived ? 'NONE' : verdict.feeSource,
        feeRuleSnapshot: verdict.ruleSnapshot as Prisma.InputJsonValue, ...(verdict.overrideSnapshot ? { feeOverrideSnapshot: verdict.overrideSnapshot as Prisma.InputJsonValue } : {}),
        ...(waived ? { feeWaivedAt: now, feeWaivedByUserId: scope.actor.userId, feeWaivedReason: body.reasonText ?? null } : {}),
      },
    });
    await transition(scope, b, 'CANCELLED', body.reasonCode, { cancelledAt: now }, tx, { role, feeAmount: fee.toFixed(2), actedFor: role === 'ADMIN' ? 'staff' : 'self' });
    await repo.releaseReservation(scope, b.id, tx);
    await recordBookingCancellation(scope, b.tripRequestId, tx);
    // A captured payment gets a REQUESTED refund for the refundable amount; it is processed through the refund approval flow, never here.
    const refundRow = body.requestRefund ? await requestRefundForCancellation(scope, b.id, refund, scope.actor.userId, tx) : null;
    await writeAudit({ ...audit(scope), action: 'booking.cancelled', entityType: 'booking', entityId: b.id, severity: waived || override ? 'NOTICE' : 'INFO', beforeValue: { status: b.status }, afterValue: { status: 'CANCELLED', role, reasonCode: body.reasonCode, feeAmount: fee.toFixed(2), refundAmount: refund.toFixed(2), feeSource: waived ? 'NONE' : verdict.feeSource, waived, override: verdict.overrideSnapshot, refundRequested: refundRow?.refundNumber ?? null } }, tx);
    await publishEvent('booking', b.id, 'booking.cancelled', { bookingNumber: b.bookingNumber, tripRequestId: b.tripRequestId, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, driverProfileId: b.driverProfileId, role, reasonCode: body.reasonCode, feeAmount: fee.toFixed(2), refundAmount: refund.toFixed(2) }, tx);
  });
  const after = await repo.findBooking(scope, id);
  if (!after?.cancellation) throw new NotFoundError();
  const refundRow = await prisma().refund.findFirst({ where: { bookingId: id, reasonCode: 'BOOKING_CANCELLED' }, orderBy: { createdAt: 'desc' }, select: { id: true, refundNumber: true, status: true, amount: true, currency: true } });
  return { booking: bookingDtoFor(scope, after), cancellation: toCancellationDto(after.cancellation), refund: refundRow ? { id: refundRow.id, refundNumber: refundRow.refundNumber, status: refundRow.status, amount: toMoneyString(refundRow.amount), currency: refundRow.currency } : null, calendarEntryReleased: after.calendarEntry?.status === 'RELEASED' };
}

/** POST /bookings/{id}/cancellation/waive-fee — admin, before the refund/settlement line is processed. */
export async function waiveCancellationFee(scope: ActorScope, id: string, reason: string): Promise<CancelBookingResultDto> {
  const b = await repo.findBooking(scope, id);
  if (!b?.cancellation) throw new NotFoundError();
  const c = b.cancellation;
  if (c.feeWaivedAt) throw new ConflictError('CANCELLATION_FEE_LOCKED', 'The fee was already waived');
  if (b.paymentStatus === 'REFUNDED' || b.paymentStatus === 'PARTIALLY_REFUNDED') throw new ConflictError('CANCELLATION_FEE_LOCKED', 'The refund has been processed; adjust through settlement instead');
  const now = new Date();
  await prisma().$transaction(async (tx) => {
    await tx.bookingCancellation.update({ where: { bookingId: id }, data: { cancellationFeeAmount: 0, refundAmount: b.totalAmount, feePayer: 'NONE', feeWaivedAt: now, feeWaivedByUserId: scope.actor.userId, feeWaivedReason: reason } });
    await writeAudit({ ...audit(scope), action: 'booking.cancellation_fee_waived', entityType: 'booking', entityId: id, severity: 'NOTICE', beforeValue: { feeAmount: c.cancellationFeeAmount.toFixed(2) }, afterValue: { feeAmount: '0.00', reason } }, tx);
  });
  const after = await repo.findBooking(scope, id);
  if (!after?.cancellation) throw new NotFoundError();
  return { booking: bookingDtoFor(scope, after), cancellation: toCancellationDto(after.cancellation), refund: null, calendarEntryReleased: after.calendarEntry?.status === 'RELEASED' };
}

// ── no-show ──────────────────────────────────────────────────────────────────

/**
 * POST /bookings/{id}/no-show — ops records a customer or owner no-show (api.md §8.15, OQ-05).
 * A NO_SHOW cancellation row is written with the policy charge for the party that failed to
 * show: a customer no-show is charged out of the customer's payment (refund = total − fee); an
 * owner no-show refunds the customer in full and the fee becomes a PENALTY line on the owner's
 * next settlement (the builder picks up unsettled owner-payable fees).
 */
export async function recordNoShow(scope: ActorScope, id: string, body: z.infer<typeof noShowBody>): Promise<CancelBookingResultDto> {
  if (scope.kind !== 'GLOBAL') throw new ForbiddenError('PERM_DENIED', 'No-show is recorded by operations');
  const override = body.feeOverride ? feeOverrideFor(scope, body.feeOverride) : null;
  const now = new Date();
  const reasonCode = body.party === 'CUSTOMER' ? 'CUSTOMER_NO_SHOW' : 'OWNER_NO_SHOW';
  await prisma().$transaction(async (tx) => {
    await repo.lockBooking(scope, id, tx);
    const b = await repo.findBooking(scope, id, tx);
    if (!b) throw new NotFoundError();
    if (b.status === 'CANCELLED') throw new ConflictError('BOOKING_ALREADY_CANCELLED', `Booking ${b.bookingNumber} is already cancelled`);
    assertTransition(b, 'CANCELLED');
    const hours = hoursBefore(b, now);
    const policy = await resolvePolicy(scope, { eventType: 'NO_SHOW', role: body.party, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, vehicleCategoryId: b.tripRequest.vehicleCategoryId, at: now }, tx);
    const verdict = computeFee({ total: b.totalAmount, hoursBeforePickup: hours, policy, override });
    const fee = verdict.feeAmount;
    // The customer is refunded in full when the owner failed to show; their own no-show costs them the fee.
    const refund = body.party === 'OWNER' ? b.totalAmount : round2(b.totalAmount.sub(fee));
    await tx.bookingCancellation.create({
      data: {
        bookingId: b.id, cancelledByUserId: scope.actor.userId, cancelledByRole: 'ADMIN', eventType: 'NO_SHOW', reasonCode, reasonText: body.reasonText ?? null, hoursBeforePickup: hours,
        feePayer: fee.gt(0) ? body.party : 'NONE', cancellationFeeAmount: fee, refundAmount: refund, currency: b.currency, feeSource: verdict.feeSource,
        feeRuleSnapshot: verdict.ruleSnapshot as Prisma.InputJsonValue, ...(verdict.overrideSnapshot ? { feeOverrideSnapshot: verdict.overrideSnapshot as Prisma.InputJsonValue } : {}),
      },
    });
    await transition(scope, b, 'CANCELLED', reasonCode, { cancelledAt: now }, tx, { role: 'ADMIN', noShowParty: body.party, feeAmount: fee.toFixed(2) });
    await repo.releaseReservation(scope, b.id, tx);
    await recordBookingCancellation(scope, b.tripRequestId, tx);
    const refundRow = body.requestRefund ? await requestRefundForCancellation(scope, b.id, refund, scope.actor.userId, tx, body.party === 'OWNER' ? 'OWNER_NO_SHOW' : 'BOOKING_CANCELLED') : null;
    await writeAudit({ ...audit(scope), action: 'booking.no_show', entityType: 'booking', entityId: b.id, severity: 'NOTICE', beforeValue: { status: b.status }, afterValue: { status: 'CANCELLED', party: body.party, feeAmount: fee.toFixed(2), refundAmount: refund.toFixed(2), feeSource: verdict.feeSource, override: verdict.overrideSnapshot, refundRequested: refundRow?.refundNumber ?? null } }, tx);
    await publishEvent('booking', b.id, 'booking.cancelled', { bookingNumber: b.bookingNumber, tripRequestId: b.tripRequestId, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, driverProfileId: b.driverProfileId, role: 'ADMIN', reasonCode, feeAmount: fee.toFixed(2), refundAmount: refund.toFixed(2) }, tx);
  });
  const after = await repo.findBooking(scope, id);
  if (!after?.cancellation) throw new NotFoundError();
  const refundRow = await prisma().refund.findFirst({ where: { bookingId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, refundNumber: true, status: true, amount: true, currency: true } });
  return { booking: bookingDtoFor(scope, after), cancellation: toCancellationDto(after.cancellation), refund: refundRow ? { id: refundRow.id, refundNumber: refundRow.refundNumber, status: refundRow.status, amount: toMoneyString(refundRow.amount), currency: refundRow.currency } : null, calendarEntryReleased: after.calendarEntry?.status === 'RELEASED' };
}

// ── disputes ─────────────────────────────────────────────────────────────────

/** POST /bookings/{id}/dispute — IN_PROGRESS / COMPLETED → DISPUTED with a linked complaint (api.md §8.15). */
export async function disputeBooking(scope: ActorScope, id: string, body: z.infer<typeof disputeBookingBody>): Promise<BookingDisputeResultDto> {
  let complaintId = '';
  await prisma().$transaction(async (tx) => {
    await repo.lockBooking(scope, id, tx);
    const b = await repo.findBooking(scope, id, tx);
    if (!b) throw new NotFoundError();
    // Who is disputing decides who it is against; staff disputes are against the platform's own handling.
    const raiser = scope.kind === 'GLOBAL' ? 'ADMIN' : cancellerRole(scope, b);
    const against = raiser === 'CUSTOMER' ? { againstType: 'OWNER' as const, againstId: b.ownerProfileId } : raiser === 'OWNER' ? { againstType: 'CUSTOMER' as const, againstId: b.customerProfileId } : { againstType: 'PLATFORM' as const, againstId: null };
    await transition(scope, b, 'DISPUTED', 'dispute opened', {}, tx, { raiser, category: body.category });
    complaintId = await openDisputeComplaint(scope, { bookingId: b.id, tripId: b.trip?.id ?? null, ...against, category: body.category, subject: body.subject, description: body.description, severity: body.severity ?? 'HIGH' }, tx);
    await writeAudit({ ...audit(scope), action: 'booking.disputed', entityType: 'booking', entityId: b.id, severity: 'NOTICE', beforeValue: { status: b.status }, afterValue: { status: 'DISPUTED', complaintId, raiser } }, tx);
    await publishEvent('booking', b.id, 'booking.disputed', { bookingNumber: b.bookingNumber, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, complaintId, raiser }, tx);
  });
  return { booking: await getBooking(scope, id), complaint: await getComplaint(scope.kind === 'GLOBAL' ? scope : { ...scope, kind: 'OWN' }, complaintId), refund: null };
}

/** POST /bookings/{id}/resolve-dispute — DISPUTED → COMPLETED, or a refund request whose completion moves it to REFUNDED. */
export async function resolveDispute(scope: ActorScope, id: string, body: z.infer<typeof resolveDisputeBody>): Promise<BookingDisputeResultDto> {
  const done = await prisma().$transaction(async (tx) => {
    let refundRow: { id: string; refundNumber: string } | null = null;
    await repo.lockBooking(scope, id, tx);
    const b = await repo.findBooking(scope, id, tx);
    if (!b) throw new NotFoundError();
    if (b.status !== 'DISPUTED') throw new BusinessRuleError('BOOKING_INVALID_TRANSITION', `Booking ${b.bookingNumber} is not disputed`, { from: b.status });
    if (body.outcome === 'COMPLETED') {
      await transition(scope, b, 'COMPLETED', 'dispute resolved — service stands', {}, tx, { resolution: body.resolution });
    } else {
      const amount = body.refundAmount ? round2(money(body.refundAmount)) : b.totalAmount;
      if (amount.lte(0) || amount.gt(b.totalAmount)) throw new BusinessRuleError('VALIDATION_FAILED', 'The refund must be between 0.01 and the booking total', { fieldErrors: { refundAmount: [`≤ ${b.totalAmount.toFixed(2)}`] }, formErrors: [] });
      refundRow = await requestRefundForCancellation(scope, b.id, amount, scope.actor.userId, tx, 'DISPUTE_RESOLVED');
      if (!refundRow) throw new BusinessRuleError('PAYMENT_NOT_REFUNDABLE', 'No captured payment to refund on this booking — resolve as COMPLETED and settle through an invoice credit note');
      // The booking stays DISPUTED until the gateway confirms; applyRefundCompleted moves it to REFUNDED.
    }
    const complaintIds = await resolveDisputeComplaints(scope, b.id, body.resolution, tx);
    await writeAudit({ ...audit(scope), action: 'booking.dispute_resolved', entityType: 'booking', entityId: b.id, severity: 'NOTICE', beforeValue: { status: 'DISPUTED' }, afterValue: { outcome: body.outcome, resolution: body.resolution, refund: refundRow?.refundNumber ?? null, complaints: complaintIds } }, tx);
    return { refundId: refundRow?.id ?? null, complaintIds };
  });
  const r = done.refundId ? await prisma().refund.findUniqueOrThrow({ where: { id: done.refundId }, select: { id: true, refundNumber: true, status: true, amount: true, currency: true } }) : null;
  const complaint = done.complaintIds[0] ? await getComplaint(scope, done.complaintIds[0]) : null;
  if (!complaint) throw new NotFoundError('NOT_FOUND', 'No open complaint was linked to this dispute');
  return { booking: await getBooking(scope, id), complaint, refund: r ? { id: r.id, refundNumber: r.refundNumber, status: r.status, amount: toMoneyString(r.amount), currency: r.currency } : null };
}

// ── confirm / dispatch / ready ───────────────────────────────────────────────

/** Ops override PENDING_PAYMENT → CONFIRMED (offline payment reconciled). Never needed for INVOICED (A-46). */
export async function confirmBooking(scope: ActorScope, id: string, reason: string): Promise<BookingDto> {
  const b = await repo.findBooking(scope, id);
  if (!b) throw new NotFoundError();
  await prisma().$transaction(async (tx) => {
    await transition(scope, b, 'CONFIRMED', reason, { confirmedAt: new Date(), paymentDueBy: null }, tx, { opsOverride: true });
    await writeAudit({ ...audit(scope), action: 'booking.confirmed_by_ops', entityType: 'booking', entityId: id, severity: 'NOTICE', afterValue: { reason } }, tx);
    await publishEvent('booking', id, 'booking.confirmed', { bookingNumber: b.bookingNumber, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, opsOverride: true }, tx);
  });
  return getBooking(scope, id);
}

/** CONFIRMED → DRIVER_ASSIGNED: the driver must be approved, licensed, assigned to the vehicle and free for the window; creates the trip row. */
export async function assignDriver(scope: ActorScope, id: string, driverProfileId: string): Promise<BookingDto> {
  const b = await repo.findBooking(scope, id);
  if (!b) throw new NotFoundError();
  if (scope.kind !== 'GLOBAL' && scope.actor.ownerProfileId !== b.ownerProfileId) throw new NotFoundError();
  assertTransition(b, 'DRIVER_ASSIGNED');
  const check = await driverNominationCheck(scope, driverProfileId, b.ownerProfileId, b.scheduledStartAt, b.transportType);
  if (!check.ok) {
    if (check.code === 'NOT_FOUND') throw new NotFoundError('NOT_FOUND', 'Driver not found', { driverProfileId });
    throw new BusinessRuleError(check.code, check.code === 'DRIVER_NOT_APPROVED' ? (check.vertical ? `The driver is not approved for ${check.vertical} transport` : 'The driver is not approved') : 'The driver’s licence has expired', { driverProfileId, ...(check.vertical ? { vertical: check.vertical } : {}) });
  }
  if (!(await isDriverAssignedToVehicle(b.vehicleId, driverProfileId))) throw new BusinessRuleError('DRIVER_NOT_ASSIGNED_TO_VEHICLE', 'The driver is not assigned to this vehicle', { vehicleId: b.vehicleId, driverProfileId });
  const conflicts = await repo.driverConflicts(scope, driverProfileId, b.scheduledStartAt, b.scheduledEndAt, b.id);
  if (conflicts.length) throw new BusinessRuleError('DRIVER_ALREADY_ON_TRIP', 'The driver is dispatched on an overlapping booking', { conflicts: conflicts.map((c) => c.bookingNumber) });
  await prisma().$transaction(async (tx) => {
    await transition(scope, b, 'DRIVER_ASSIGNED', 'driver assigned', { driverProfile: { connect: { id: driverProfileId } } }, tx, { driverProfileId });
    const tripNumber = await repo.nextTripNumber(scope, tx);
    // The trip row carries the driver snapshotted at dispatch — never rewritten (database.md §11.1).
    await tx.trip.upsert({ where: { bookingId: b.id }, create: { id: newId(), tripNumber, bookingId: b.id, vehicleId: b.vehicleId, driverProfileId, transportType: b.transportType, status: 'DRIVER_ASSIGNED' }, update: { driverProfileId, status: 'DRIVER_ASSIGNED' } });
    await writeAudit({ ...audit(scope), action: 'booking.driver_assigned', entityType: 'booking', entityId: id, afterValue: { driverProfileId, tripNumber } }, tx);
    await publishEvent('booking', id, 'booking.driver_assigned', { bookingNumber: b.bookingNumber, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, driverProfileId, tripNumber }, tx);
  });
  return getBooking(scope, id);
}

/** DRIVER_ASSIGNED → READY: the owner (or ops) declares the pre-dispatch checks done. */
export async function markReady(scope: ActorScope, id: string, notes?: string): Promise<BookingDto> {
  const b = await repo.findBooking(scope, id);
  if (!b) throw new NotFoundError();
  if (scope.kind !== 'GLOBAL' && scope.actor.ownerProfileId !== b.ownerProfileId) throw new NotFoundError();
  await prisma().$transaction(async (tx) => {
    await transition(scope, b, 'READY', notes ?? 'ready', {}, tx);
    await writeAudit({ ...audit(scope), action: 'booking.ready', entityType: 'booking', entityId: id, afterValue: { notes: notes ?? null } }, tx);
    await publishEvent('booking', id, 'booking.ready', { bookingNumber: b.bookingNumber, customerProfileId: b.customerProfileId, driverProfileId: b.driverProfileId }, tx);
  });
  return getBooking(scope, id);
}

// ── jobs ─────────────────────────────────────────────────────────────────────

/** PENDING_PAYMENT past payment_due_by → CANCELLED, reservation released, order reopened. INVOICED bookings never have a window. */
export async function expireUnpaidBookings(): Promise<number> {
  const stale = await repo.listPaymentExpired(systemScope, new Date());
  let n = 0;
  for (const s of stale) {
    await prisma().$transaction(async (tx) => {
      await repo.lockBooking(systemScope, s.id, tx);
      const b = await repo.findBooking(systemScope, s.id, tx);
      if (b?.status !== 'PENDING_PAYMENT') return;
      const now = new Date();
      await tx.bookingCancellation.create({ data: { bookingId: b.id, cancelledByUserId: null, cancelledByRole: 'SYSTEM', eventType: 'CANCELLATION', reasonCode: 'PAYMENT_WINDOW_EXPIRED', hoursBeforePickup: hoursBefore(b, now), feePayer: 'NONE', cancellationFeeAmount: 0, refundAmount: 0, currency: b.currency, feeSource: 'NONE', feeRuleSnapshot: {} } });
      await transition(systemScope, b, 'CANCELLED', 'PAYMENT_WINDOW_EXPIRED', { cancelledAt: now }, tx);
      await repo.releaseReservation(systemScope, b.id, tx);
      await recordBookingCancellation(systemScope, b.tripRequestId, tx);
      await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: 'booking.payment_window_expired', entityType: 'booking', entityId: b.id, beforeValue: { status: 'PENDING_PAYMENT', paymentDueBy: b.paymentDueBy?.toISOString() ?? null }, afterValue: { status: 'CANCELLED' } }, tx);
      await publishEvent('booking', b.id, 'booking.cancelled', { bookingNumber: b.bookingNumber, tripRequestId: b.tripRequestId, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, role: 'SYSTEM', reasonCode: 'PAYMENT_WINDOW_EXPIRED' }, tx);
      n++;
    });
  }
  return n;
}

// ── payment integration (Phase 9) ────────────────────────────────────────────

export interface BookingPaymentView {
  id: string;
  bookingNumber: string;
  customerProfileId: string;
  ownerProfileId: string;
  status: Status;
  paymentStatus: repo.BookingRow['paymentStatus'];
  billingMode: repo.BookingRow['billingMode'];
  totalAmount: Decimal;
  currency: string;
  paymentDueBy: Date | null;
  /** A-57: UniGate's own vehicle — the fare is transport revenue, never an owner payable. */
  ownerIsPlatformFleet: boolean;
  /** The frozen split the ledger postings follow; null only for a booking created before snapshots existed. */
  split: { grossAmount: Decimal; vatAmount: Decimal; commissionAmount: Decimal; commissionVatAmount: Decimal; paymentFeeAmount: Decimal; ownerNetAmount: Decimal; vatTreatment: string } | null;
}

/** The booking as the payments module sees it (scoped). */
export async function bookingForPayment(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<BookingPaymentView | null> {
  const b = await repo.findBooking(scope, id, tx);
  if (!b) return null;
  const f = b.financialSnapshot;
  return {
    id: b.id, bookingNumber: b.bookingNumber, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, status: b.status, paymentStatus: b.paymentStatus, billingMode: b.billingMode, totalAmount: b.totalAmount, currency: b.currency, paymentDueBy: b.paymentDueBy, ownerIsPlatformFleet: b.ownerProfile.isPlatformFleet,
    split: f ? { grossAmount: f.grossAmount, vatAmount: b.vatAmount, commissionAmount: f.commissionAmount, commissionVatAmount: f.commissionVatAmount, paymentFeeAmount: f.paymentFeeAmount, ownerNetAmount: f.ownerNetAmount, vatTreatment: f.vatTreatment } : null,
  };
}

/** The gateway confirmed capture: payment_status PAID and PENDING_PAYMENT → CONFIRMED (the normal PREPAID path). Idempotent. */
export async function applyPaymentCaptured(scope: AnyScope, bookingId: string, tx: Prisma.TransactionClient): Promise<{ confirmedNow: boolean }> {
  await repo.lockBooking(scope, bookingId, tx);
  const b = await repo.findBooking(scope, bookingId, tx);
  if (!b) throw new NotFoundError();
  if (b.paymentStatus !== 'PAID') await tx.booking.update({ where: { id: bookingId }, data: { paymentStatus: 'PAID' } });
  if (b.status !== 'PENDING_PAYMENT') return { confirmedNow: false };
  await transition(scope, b, 'CONFIRMED', 'payment captured', { confirmedAt: new Date(), paymentDueBy: null }, tx, { source: 'gateway' });
  await publishEvent('booking', bookingId, 'booking.confirmed', { bookingNumber: b.bookingNumber, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, opsOverride: false }, tx);
  return { confirmedNow: true };
}

/** A refund settled: payment_status REFUNDED / PARTIALLY_REFUNDED; a fully refunded CANCELLED booking moves to REFUNDED. */
export async function applyRefundCompleted(scope: AnyScope, bookingId: string, fullyRefunded: boolean, tx: Prisma.TransactionClient): Promise<void> {
  await repo.lockBooking(scope, bookingId, tx);
  const b = await repo.findBooking(scope, bookingId, tx);
  if (!b) throw new NotFoundError();
  await tx.booking.update({ where: { id: bookingId }, data: { paymentStatus: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
  if (fullyRefunded && b.status === 'CANCELLED') await transition(scope, b, 'REFUNDED', 'refund completed', {}, tx, { source: 'gateway' });
  if (b.status === 'DISPUTED') await transition(scope, b, 'REFUNDED', 'dispute refund completed', {}, tx, { source: 'gateway', fullyRefunded });
}

// ── trip integration (Phase 10) ──────────────────────────────────────────────

/** The trip is under way: READY → IN_PROGRESS (a DRIVER_ASSIGNED booking is advanced through READY when the ready check is off). */
export async function applyTripStarted(scope: AnyScope, bookingId: string, tx: Prisma.TransactionClient): Promise<void> {
  await repo.lockBooking(scope, bookingId, tx);
  let b = await repo.findBooking(scope, bookingId, tx);
  if (!b) throw new NotFoundError();
  if (b.status === 'DRIVER_ASSIGNED') {
    await transition(scope, b, 'READY', 'implicit: trip started without a ready check', {}, tx, { source: 'trip' });
    b = (await repo.findBooking(scope, bookingId, tx)) ?? b;
  }
  if (b.status === 'IN_PROGRESS') return;
  await transition(scope, b, 'IN_PROGRESS', 'trip started', {}, tx, { source: 'trip' });
  await publishEvent('booking', bookingId, 'booking.in_progress', { bookingNumber: b.bookingNumber, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId }, tx);
}

/** The trip completed: IN_PROGRESS → COMPLETED, reservation released so the vehicle is free at once. */
export async function applyTripCompleted(scope: AnyScope, bookingId: string, tx: Prisma.TransactionClient): Promise<void> {
  await repo.lockBooking(scope, bookingId, tx);
  const b = await repo.findBooking(scope, bookingId, tx);
  if (!b) throw new NotFoundError();
  if (b.status === 'COMPLETED') return;
  await transition(scope, b, 'COMPLETED', 'trip completed', { completedAt: new Date() }, tx, { source: 'trip' });
  await repo.releaseReservation(scope, bookingId, tx);
  await publishEvent('booking', bookingId, 'booking.completed', { bookingNumber: b.bookingNumber, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, totalAmount: b.totalAmount.toFixed(2) }, tx);
}

/**
 * Ops cancelled the trip (POST /trips/{id}/cancel, trips.manage): the booking is cancelled even from
 * IN_PROGRESS — the one path the transition map does not open to the parties themselves (api.md §6.4).
 * No cancellation fee here (fault is decided by the dispute, not by the cancel); a captured payment
 * gets a REQUESTED refund for the full amount.
 */
export async function cancelFromTrip(scope: ActorScope, bookingId: string, reason: string, tx: Prisma.TransactionClient): Promise<void> {
  await repo.lockBooking(scope, bookingId, tx);
  const b = await repo.findBooking(scope, bookingId, tx);
  if (!b) throw new NotFoundError();
  if (b.status === 'CANCELLED' || b.status === 'REFUNDED' || b.status === 'COMPLETED') return;
  const now = new Date();
  await tx.bookingCancellation.create({ data: { bookingId, cancelledByUserId: scope.actor.userId, cancelledByRole: 'ADMIN', eventType: 'CANCELLATION', reasonCode: 'ADMIN_INTERVENTION', reasonText: reason, hoursBeforePickup: hoursBefore(b, now), feePayer: 'NONE', cancellationFeeAmount: 0, refundAmount: b.totalAmount, currency: b.currency, feeSource: 'NONE', feeRuleSnapshot: { source: 'trip cancellation' } } });
  await tx.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED', cancelledAt: now } });
  await tx.bookingStatusHistory.create({ data: { id: newId(), bookingId, fromStatus: b.status, toStatus: 'CANCELLED', changedByUserId: scope.actor.userId, actorType: 'USER', reason: `trip cancelled: ${reason}`, metadata: { source: 'trip', bypassesMap: true } } });
  await repo.releaseReservation(scope, bookingId, tx);
  await recordBookingCancellation(scope, b.tripRequestId, tx);
  await requestRefundForCancellation(scope, bookingId, b.totalAmount, scope.actor.userId, tx);
  await writeAudit({ ...audit(scope), action: 'booking.cancelled', entityType: 'booking', entityId: bookingId, severity: 'NOTICE', beforeValue: { status: b.status }, afterValue: { status: 'CANCELLED', role: 'ADMIN', reasonCode: 'ADMIN_INTERVENTION', source: 'trip', reason } }, tx);
  await publishEvent('booking', bookingId, 'booking.cancelled', { bookingNumber: b.bookingNumber, tripRequestId: b.tripRequestId, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, driverProfileId: b.driverProfileId, role: 'ADMIN', reasonCode: 'ADMIN_INTERVENTION' }, tx);
}
