import type { Prisma } from '@prisma/client';
import type { AnyScope, BookingDto } from '@unigate/types';
import { ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { type Decimal, money, round4 } from '@/common/money.js';
import { isExclusionViolation } from '@/database/prisma.js';
import { CALCULATION_VERSION, computeFinancials, ruleSnapshot, type ResolvedCommission } from '@/modules/finance/commission.service.js';
import { toBookingDto } from './bookings.mapper.js';
import * as repo from './booking.repository.js';

/**
 * Booking creation — the part of the award transaction that this module owns (database.md §10,
 * api.md §6.4 steps 8–10). Called only from the bidding award service, inside its transaction, with
 * every row already locked in the global order. Reads and lifecycle transitions land in Phase 8.
 */

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

/** Inserts booking + status history + calendar reservation + financial snapshot. */
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

/** Owners and staff see the financial split; the customer sees only the agreed total. */
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

/** Credit exposure for the award's credit check; call with the corporate row locked. */
export async function creditExposureOf(scope: AnyScope, customerProfileId: string, tx: Prisma.TransactionClient): Promise<{ receivable: string; uninvoiced: string }> {
  return repo.creditExposure(scope, customerProfileId, tx);
}
