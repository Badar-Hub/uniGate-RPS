import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, BookingDto, BookingFinancialsDto, BookingStatusHistoryDto, CancelBookingResultDto, CancellationQuoteDto } from '@unigate/types';
import { BOOKING_TRANSITIONS, CANCELLATION_REASONS_BY_ROLE } from '@unigate/types';
import type { cancelBookingBody } from '@unigate/validation';
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
    // A refund row needs a captured payment to refund against; that path lands with payments (Phase 9).
    await writeAudit({ ...audit(scope), action: 'booking.cancelled', entityType: 'booking', entityId: b.id, severity: waived || override ? 'NOTICE' : 'INFO', beforeValue: { status: b.status }, afterValue: { status: 'CANCELLED', role, reasonCode: body.reasonCode, feeAmount: fee.toFixed(2), refundAmount: refund.toFixed(2), feeSource: waived ? 'NONE' : verdict.feeSource, waived, override: verdict.overrideSnapshot } }, tx);
    await publishEvent('booking', b.id, 'booking.cancelled', { bookingNumber: b.bookingNumber, tripRequestId: b.tripRequestId, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, driverProfileId: b.driverProfileId, role, reasonCode: body.reasonCode, feeAmount: fee.toFixed(2), refundAmount: refund.toFixed(2) }, tx);
  });
  const after = await repo.findBooking(scope, id);
  if (!after?.cancellation) throw new NotFoundError();
  return { booking: bookingDtoFor(scope, after), cancellation: toCancellationDto(after.cancellation), refund: null, calendarEntryReleased: after.calendarEntry?.status === 'RELEASED' };
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
  const check = await driverNominationCheck(scope, driverProfileId, b.ownerProfileId, b.scheduledStartAt);
  if (!check.ok) {
    if (check.code === 'NOT_FOUND') throw new NotFoundError('NOT_FOUND', 'Driver not found', { driverProfileId });
    throw new BusinessRuleError(check.code, check.code === 'DRIVER_NOT_APPROVED' ? 'The driver is not approved' : 'The driver’s licence has expired', { driverProfileId });
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
