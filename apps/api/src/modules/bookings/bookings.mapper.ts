import type { BookingCancellationDto, BookingDto, BookingStatusHistoryDto } from '@unigate/types';
import { toMoneyString, toRateString } from '@/common/money.js';
import type { BookingRow, HistoryRow } from './booking.repository.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * `showFinancial` — the owner and staff see the split; the customer only ever sees the total
 * they agreed to (api.md §8.14). Snapshot fields are authoritative for display (BRIEF-§13).
 */
export function toBookingDto(b: BookingRow, showFinancial: boolean): BookingDto {
  const f = b.financialSnapshot;
  return {
    id: b.id,
    bookingNumber: b.bookingNumber,
    tripRequestId: b.tripRequestId,
    requestNumber: b.tripRequest.requestNumber,
    bidId: b.bidId,
    customerProfileId: b.customerProfileId,
    ownerProfileId: b.ownerProfileId,
    vehicleId: b.vehicleId,
    driverProfileId: b.driverProfileId,
    vehiclePlateSnapshot: b.vehiclePlateSnapshot,
    vehicleDescriptionSnapshot: b.vehicleDescriptionSnapshot,
    vehicleCategoryCodeSnapshot: b.vehicleCategoryCodeSnapshot,
    ownerNameSnapshot: b.ownerNameSnapshot,
    transportType: b.transportType,
    pickup: { addressLine: b.pickupAddressLine, cityId: b.pickupCityId, latitude: b.pickupLatitude.toNumber(), longitude: b.pickupLongitude.toNumber(), placeId: null },
    dropoff: { addressLine: b.dropoffAddressLine, cityId: b.dropoffCityId, latitude: b.dropoffLatitude.toNumber(), longitude: b.dropoffLongitude.toNumber(), placeId: null },
    scheduledStartAt: b.scheduledStartAt.toISOString(),
    scheduledEndAt: b.scheduledEndAt.toISOString(),
    agreedBaseAmount: toMoneyString(b.agreedBaseAmount),
    agreedExtrasAmount: toMoneyString(b.agreedExtrasAmount),
    vatRate: toRateString(b.vatRate),
    vatAmount: toMoneyString(b.vatAmount),
    totalAmount: toMoneyString(b.totalAmount),
    currency: b.currency,
    billingMode: b.billingMode,
    invoiceId: b.invoiceLineLinks[0]?.invoiceLine.invoice.id ?? null,
    invoiceNumber: b.invoiceLineLinks[0]?.invoiceLine.invoice.invoiceNumber ?? null,
    creditTermsDaysSnapshot: b.creditTermsDaysSnapshot,
    fulfilmentSequence: b.fulfilmentSequence,
    status: b.status,
    paymentStatus: b.paymentStatus,
    paymentDueBy: iso(b.paymentDueBy),
    nonCircumventionUntil: iso(b.nonCircumventionUntil),
    confirmedAt: iso(b.confirmedAt),
    cancelledAt: iso(b.cancelledAt),
    completedAt: iso(b.completedAt),
    driverName: b.driverProfile?.user.fullNameEn ?? null,
    trip: b.trip ? { id: b.trip.id, tripNumber: b.trip.tripNumber, status: b.trip.status } : null,
    cancellation: b.cancellation ? toCancellationDto(b.cancellation) : null,
    financial:
      showFinancial && f
        ? {
            grossAmount: toMoneyString(f.grossAmount),
            netOfVatAmount: toMoneyString(f.netOfVatAmount),
            commissionAmount: toMoneyString(f.commissionAmount),
            commissionVatAmount: toMoneyString(f.commissionVatAmount),
            commissionSource: f.commissionSource,
            paymentFeeAmount: toMoneyString(f.paymentFeeAmount),
            ownerNetAmount: toMoneyString(f.ownerNetAmount),
            vatTreatment: f.vatTreatment,
          }
        : null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function toCancellationDto(c: NonNullable<BookingRow['cancellation']>): BookingCancellationDto {
  return {
    cancelledByRole: c.cancelledByRole,
    eventType: c.eventType,
    reasonCode: c.reasonCode,
    reasonText: c.reasonText,
    hoursBeforePickup: c.hoursBeforePickup.toFixed(2),
    feePayer: c.feePayer,
    cancellationFeeAmount: toMoneyString(c.cancellationFeeAmount),
    refundAmount: toMoneyString(c.refundAmount),
    currency: c.currency,
    feeSource: c.feeSource,
    feeRuleSnapshot: (c.feeRuleSnapshot ?? {}) as Record<string, unknown>,
    feeWaivedAt: iso(c.feeWaivedAt),
    feeWaivedReason: c.feeWaivedReason,
    cancelledAt: c.cancelledAt.toISOString(),
  };
}

export function toHistoryDto(h: HistoryRow): BookingStatusHistoryDto {
  return { id: h.id, fromStatus: h.fromStatus, toStatus: h.toStatus, actorType: h.actorType, changedByUserId: h.changedByUserId, reason: h.reason, metadata: (h.metadata ?? {}) as Record<string, unknown>, occurredAt: h.occurredAt.toISOString() };
}
