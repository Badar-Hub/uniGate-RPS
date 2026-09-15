import type { TrackingPositionDto, TripDto, TripProofDto, TripStatusHistoryDto } from '@unigate/types';
import { toMoneyString } from '@/common/money.js';
import type { TripHistoryRow, TripProofRow, TripRow } from './trip.repository.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** `showPhone` — the driver's phone reaches the customer only while the trip is active (api.md §6.4). */
export function toTripDto(t: TripRow, allowedNextStatuses: string[], position: TrackingPositionDto | null, showPhone: boolean): TripDto {
  const b = t.booking;
  const v = t.vehicle;
  return {
    id: t.id,
    tripNumber: t.tripNumber,
    bookingId: t.bookingId,
    bookingNumber: b.bookingNumber,
    bookingStatus: b.status,
    transportType: t.transportType,
    status: t.status,
    allowedNextStatuses,
    vehicle: { id: t.vehicleId, plateNumberEn: v.plateNumberEn, description: [v.make?.name, v.model?.name, String(v.modelYear), '—', v.category.nameEn].filter(Boolean).join(' '), colorCode: v.colorCode },
    driver: t.driverProfile ? { id: t.driverProfile.id, fullNameEn: t.driverProfile.user.fullNameEn, phoneE164: showPhone ? t.driverProfile.user.phoneE164 : null, ratingAvg: t.driverProfile.ratingAvg.toFixed(2) } : null,
    customerProfileId: b.customerProfileId,
    ownerProfileId: b.ownerProfileId,
    pickup: { addressLine: b.pickupAddressLine, cityId: b.pickupCityId, latitude: b.pickupLatitude.toNumber(), longitude: b.pickupLongitude.toNumber(), placeId: null },
    dropoff: { addressLine: b.dropoffAddressLine, cityId: b.dropoffCityId, latitude: b.dropoffLatitude.toNumber(), longitude: b.dropoffLongitude.toNumber(), placeId: null },
    scheduledStartAt: b.scheduledStartAt.toISOString(),
    scheduledEndAt: b.scheduledEndAt.toISOString(),
    actualStartAt: iso(t.actualStartAt),
    actualEndAt: iso(t.actualEndAt),
    startOdometerKm: t.startOdometerKm,
    endOdometerKm: t.endOdometerKm,
    actualDistanceKm: t.actualDistanceKm ? toMoneyString(t.actualDistanceKm) : null,
    driverNotes: t.driverNotes,
    customerNotes: t.customerNotes,
    delayMinutes: t.delayMinutes,
    regulatoryReference: t.regulatoryReference,
    regulatoryReferenceType: t.regulatoryReferenceType,
    position,
    trackingSessionId: t.trackingSessions[0]?.id ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toTripHistoryDto(h: TripHistoryRow): TripStatusHistoryDto {
  return { id: h.id, fromStatus: h.fromStatus, toStatus: h.toStatus, actorType: h.actorType, changedByUserId: h.changedByUserId, latitude: h.latitude?.toNumber() ?? null, longitude: h.longitude?.toNumber() ?? null, accuracyM: h.accuracyM?.toNumber() ?? null, note: h.note, occurredAt: h.occurredAt.toISOString(), recordedAt: h.recordedAt.toISOString() };
}

export function toTripProofDto(p: TripProofRow): TripProofDto {
  return { id: p.id, tripId: p.tripId, proofType: p.proofType, recipientName: p.recipientName, recipientIdLast4: p.recipientIdLast4, signatureDocumentId: p.signatureDocumentId, latitude: p.latitude?.toNumber() ?? null, longitude: p.longitude?.toNumber() ?? null, notes: p.notes, capturedByUserId: p.capturedByUserId, capturedAt: p.capturedAt.toISOString() };
}
