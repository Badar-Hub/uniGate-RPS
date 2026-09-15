import type { GoodsDetailsDto, InvitationDto, PassengerDetailsDto, TripRequestDto } from '@unigate/types';
import { toMoneyString } from '@/common/money.js';
import type { InvitationRow, TripRequestRow } from './trip-request.repository.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const dec = (d: { toString(): string } | null): ReturnType<typeof toMoneyString> | null => (d ? toMoneyString(d.toString()) : null);

/** Bidding closure is a deadline property, not a status (database.md §8.4). */
export function biddingOpen(r: TripRequestRow, at = new Date()): boolean {
  if (r.status === 'PUBLISHED') return at < r.biddingClosesAt;
  if (r.status === 'PARTIALLY_AWARDED') return r.remainderClosesAt ? at < r.remainderClosesAt : true;
  return false;
}

function toPassenger(p: NonNullable<TripRequestRow['passengerDetails']>): PassengerDetailsDto {
  return {
    passengerCount: p.passengerCount, luggageCount: p.luggageCount, luggageNotes: p.luggageNotes, tripPurpose: p.tripPurpose, requiresFemaleDriver: p.requiresFemaleDriver,
    requiresWheelchairAccess: p.requiresWheelchairAccess, childSeatsRequired: p.childSeatsRequired, waitingTimeMinutes: p.waitingTimeMinutes, isMultiDay: p.isMultiDay, driverLanguagePreference: p.driverLanguagePreference,
  };
}

function toGoods(g: NonNullable<TripRequestRow['goodsDetails']>, redacted: boolean): GoodsDetailsDto {
  return {
    cargoType: g.cargoType, cargoDescription: g.cargoDescription, cargoWeightKg: toMoneyString(g.cargoWeightKg.toString()), cargoVolumeM3: dec(g.cargoVolumeM3), packageCount: g.packageCount,
    requiresRefrigeration: g.requiresRefrigeration, requiredTemperatureMinC: g.requiredTemperatureMinC ? g.requiredTemperatureMinC.toNumber() : null, requiredTemperatureMaxC: g.requiredTemperatureMaxC ? g.requiredTemperatureMaxC.toNumber() : null,
    requiresTailLift: g.requiresTailLift, requiresCrane: g.requiresCrane, loadingResponsibility: g.loadingResponsibility, unloadingResponsibility: g.unloadingResponsibility,
    loadingInstructions: redacted ? null : g.loadingInstructions, unloadingInstructions: redacted ? null : g.unloadingInstructions, declaredValueAmount: dec(g.declaredValueAmount), requiresInsurance: g.requiresInsurance, hazmatClass: g.hazmatClass,
    shipperContactName: redacted ? null : g.shipperContactName, shipperContactPhone: redacted ? null : g.shipperContactPhone, consigneeContactName: redacted ? null : g.consigneeContactName, consigneeContactPhone: redacted ? null : g.consigneeContactPhone,
  };
}

/**
 * `redacted` = the owner projection: instructions and contact details are withheld until the
 * owner holds an accepted bid (api.md §8.11). An open bidding pool is not a phone-number harvest.
 */
export function toTripRequestDto(r: TripRequestRow, redacted: boolean): TripRequestDto {
  return {
    id: r.id,
    requestNumber: r.requestNumber,
    customerProfileId: r.customerProfileId,
    status: r.status,
    transportType: r.transportType,
    vehicleCategory: r.vehicleCategory ? { id: r.vehicleCategory.id, code: r.vehicleCategory.code, nameEn: r.vehicleCategory.nameEn, nameAr: r.vehicleCategory.nameAr } : null,
    vehiclesRequired: r.vehiclesRequired,
    allowPartialFulfilment: r.allowPartialFulfilment,
    vehiclesAwarded: r.vehiclesAwarded,
    vehiclesDispatched: r.vehiclesDispatched,
    vehiclesCompleted: r.vehiclesCompleted,
    vehiclesCancelled: r.vehiclesCancelled,
    tripDirection: r.tripDirection,
    pickup: { addressLine: redacted ? cityOnly(r.pickupAddressLine) : r.pickupAddressLine, cityId: r.pickupCityId, latitude: r.pickupLatitude.toNumber(), longitude: r.pickupLongitude.toNumber(), placeId: redacted ? null : r.pickupPlaceId },
    dropoff: { addressLine: redacted ? cityOnly(r.dropoffAddressLine) : r.dropoffAddressLine, cityId: r.dropoffCityId, latitude: r.dropoffLatitude.toNumber(), longitude: r.dropoffLongitude.toNumber(), placeId: redacted ? null : r.dropoffPlaceId },
    pickupAt: r.pickupAt.toISOString(),
    returnAt: iso(r.returnAt),
    biddingClosesAt: r.biddingClosesAt.toISOString(),
    remainderClosesAt: iso(r.remainderClosesAt),
    biddingOpen: biddingOpen(r),
    estimatedDistanceKm: dec(r.estimatedDistanceKm),
    estimatedDurationMinutes: r.estimatedDurationMinutes,
    budgetAmount: dec(r.budgetAmount),
    currency: r.currency,
    specialInstructions: redacted ? null : r.specialInstructions,
    cancellationReason: r.cancellationReason,
    passengerDetails: r.passengerDetails ? toPassenger(r.passengerDetails) : null,
    goodsDetails: r.goodsDetails ? toGoods(r.goodsDetails, redacted) : null,
    invitedOwnerCount: r._count.invitations,
    redacted,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Owners see the city, not the door: keep only the last comma-separated segment. */
function cityOnly(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? (parts[parts.length - 1] ?? address) : address;
}

export function toInvitationDto(i: InvitationRow): InvitationDto {
  return {
    id: i.id, tripRequestId: i.tripRequestId, ownerProfileId: i.ownerProfileId, ownerName: i.ownerProfile.businessNameEn ?? i.ownerProfile.user.fullNameEn, vehicleId: i.vehicleId, vehiclePlate: i.vehicle?.plateNumberEn ?? null,
    matchScore: i.matchScore ? i.matchScore.toFixed(2) : null, matchReason: (i.matchReason ?? {}) as Record<string, unknown>, notifiedAt: iso(i.notifiedAt), viewedAt: iso(i.viewedAt), dismissedAt: iso(i.dismissedAt), createdAt: i.createdAt.toISOString(),
  };
}
