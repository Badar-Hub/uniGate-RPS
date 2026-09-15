import type { BidDto, BidExtraDto } from '@unigate/types';
import { toMoneyString, toRateString } from '@/common/money.js';
import type { BidRow } from './bid.repository.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function ownerDisplayName(o: { businessNameEn: string | null; user: { fullNameEn: string } }): string {
  return o.businessNameEn ?? o.user.fullNameEn;
}

export function vehicleDescription(v: BidRow['vehicle']): string {
  return [v.make?.name, v.model?.name, String(v.modelYear), '—', v.category.nameEn].filter(Boolean).join(' ');
}

function extras(raw: unknown): BidExtraDto[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    if (!e || typeof e !== 'object') return [];
    const x = e as { labelEn?: unknown; labelAr?: unknown; amount?: unknown };
    if (typeof x.labelEn !== 'string' || typeof x.labelAr !== 'string' || typeof x.amount !== 'string') return [];
    return [{ labelEn: x.labelEn, labelAr: x.labelAr, amount: toMoneyString(x.amount) }];
  });
}

/**
 * `showNotes` — owner notes are for the customer and the owner; a rival owner never reaches the
 * row at all (scope), staff see everything.
 */
export function toBidDto(b: BidRow, effectiveCommission: BidDto['effectiveCommission']): BidDto {
  return {
    id: b.id,
    bidNumber: b.bidNumber,
    tripRequestId: b.tripRequestId,
    requestNumber: b.tripRequest.requestNumber,
    ownerProfileId: b.ownerProfileId,
    ownerName: ownerDisplayName(b.ownerProfile),
    ownerRatingAvg: b.ownerProfile.ratingAvg.toFixed(2),
    vehicle: {
      id: b.vehicleId,
      plateNumberEn: b.vehicle.plateNumberEn,
      description: vehicleDescription(b.vehicle),
      categoryCode: b.vehicle.category.code,
      passengerCapacity: b.vehicle.passengerCapacity,
      payloadCapacityKg: b.vehicle.payloadCapacityKg ? toMoneyString(b.vehicle.payloadCapacityKg) : null,
      ratingAvg: b.vehicle.ratingAvg.toFixed(2),
    },
    driverProfileId: b.driverProfileId,
    driverName: b.driverProfile?.user.fullNameEn ?? null,
    baseAmount: toMoneyString(b.baseAmount),
    extrasAmount: toMoneyString(b.extrasAmount),
    extrasBreakdown: extras(b.extrasBreakdown),
    vatRate: toRateString(b.vatRate),
    vatAmount: toMoneyString(b.vatAmount),
    totalAmount: toMoneyString(b.totalAmount),
    currency: b.currency,
    estimatedArrivalAt: iso(b.estimatedArrivalAt),
    estimatedDurationMinutes: b.estimatedDurationMinutes,
    validUntil: b.validUntil.toISOString(),
    ownerNotes: b.ownerNotes,
    status: b.status,
    version: b.version,
    lastRevisedAt: iso(b.lastRevisedAt),
    rejectedReason: b.rejectedReason,
    submittedAt: b.submittedAt.toISOString(),
    decidedAt: iso(b.decidedAt),
    bookingId: b.booking?.id ?? null,
    effectiveCommission,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}
