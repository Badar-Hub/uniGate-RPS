import { goodsDetails, type GoodsDetailsInput } from '@unigate/validation';
import { money } from '@/common/money.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import type { CapacityValidation, CategoryShape, MatchVerdict, RequestValidation, VehicleCandidate, VehicleCapacityInput, VerticalPlugin } from '@/verticals/plugin.js';

function goodsData(d: GoodsDetailsInput) {
  return {
    cargoType: d.cargoType, cargoDescription: d.cargoDescription, cargoWeightKg: money(d.cargoWeightKg), cargoVolumeM3: d.cargoVolumeM3 !== undefined ? money(d.cargoVolumeM3) : null, packageCount: d.packageCount ?? null,
    packageLengthCm: d.packageLengthCm ?? null, packageWidthCm: d.packageWidthCm ?? null, packageHeightCm: d.packageHeightCm ?? null,
    requiresRefrigeration: d.requiresRefrigeration, requiredTemperatureMinC: d.requiredTemperatureMinC ?? null, requiredTemperatureMaxC: d.requiredTemperatureMaxC ?? null,
    requiresTailLift: d.requiresTailLift, requiresCrane: d.requiresCrane, loadingResponsibility: d.loadingResponsibility, unloadingResponsibility: d.unloadingResponsibility,
    loadingInstructions: d.loadingInstructions ?? null, unloadingInstructions: d.unloadingInstructions ?? null, declaredValueAmount: d.declaredValueAmount !== undefined ? money(d.declaredValueAmount) : null,
    requiresInsurance: d.requiresInsurance, hazmatClass: d.hazmatClass ?? null, shipperContactName: d.shipperContactName ?? null, shipperContactPhone: d.shipperContactPhone ?? null,
    consigneeContactName: d.consigneeContactName ?? null, consigneeContactPhone: d.consigneeContactPhone ?? null,
  };
}

/**
 * Goods vertical (ADR-010, Phase 11b): cargo request validation and matching, the freight
 * state machine with proof of delivery, the freight document checklist, the transport-document
 * (Bayan, OQ-29) dispatch gate, and freight invoice wording. Whether goods requests are accepted
 * on a deployment is `platform.verticals_enabled` (ADR-009), not a code constant.
 */
export const goodsPlugin: VerticalPlugin = {
  type: 'GOODS',
  enabled: true,
  validateVehicleCapacity(category: CategoryShape, input: VehicleCapacityInput): CapacityValidation {
    const fieldErrors: Record<string, string[]> = {};
    const kg = input.payloadCapacityKg;
    if (kg === undefined) fieldErrors['payloadCapacityKg'] = ['required for a goods category'];
    else {
      if (category.minPayloadKg !== null && kg < Number(category.minPayloadKg)) fieldErrors['payloadCapacityKg'] = [`at least ${category.minPayloadKg} kg for ${category.code}`];
      if (category.maxPayloadKg !== null && kg > Number(category.maxPayloadKg)) fieldErrors['payloadCapacityKg'] = [`at most ${category.maxPayloadKg} kg for ${category.code}`];
    }
    return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
  },
  extraRequiredDocumentTypes(role, category): string[] {
    // Refrigerated and hazmat categories need their certificates; the codes exist in the seed.
    if (role !== 'VEHICLE') return [];
    const extras: string[] = [];
    if (category.code.includes('REFRIGERATED')) extras.push('VEHICLE_REFRIGERATION_CERT');
    if (category.code.includes('HAZMAT')) extras.push('VEHICLE_HAZMAT_PERMIT');
    return extras;
  },
  demand: {
    partialFulfilmentDefault: true,
    detailKey: 'goodsDetails',
    detailCreate(details) {
      return { goodsDetails: { create: goodsData(details as GoodsDetailsInput) } };
    },
    detailUpdate(details) {
      return { goodsDetails: { update: goodsData(details as GoodsDetailsInput) } };
    },
    validateRequest(_request, details): RequestValidation {
      const parsed = goodsDetails.safeParse(details);
      if (!parsed.success) return { ok: false, fieldErrors: { goodsDetails: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } };
      const d = parsed.data;
      const fieldErrors: Record<string, string[]> = {};
      if (d.requiresRefrigeration && (d.requiredTemperatureMinC === undefined || d.requiredTemperatureMaxC === undefined)) fieldErrors['goodsDetails.requiredTemperatureMinC'] = ['temperature range is required for refrigerated cargo'];
      if (d.requiredTemperatureMinC !== undefined && d.requiredTemperatureMaxC !== undefined && d.requiredTemperatureMinC > d.requiredTemperatureMaxC) fieldErrors['goodsDetails.requiredTemperatureMaxC'] = ['max must be at least min'];
      return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
    },
    matchVehicle(details, vehicle: VehicleCandidate): MatchVerdict {
      const d = details as GoodsDetailsInput;
      const reasons: string[] = [];
      if (vehicle.payloadCapacityKg === null) return { ok: false, reasons: ['NO_PAYLOAD_CAPACITY'], score: 0 };
      if (Number(vehicle.payloadCapacityKg) < Number(d.cargoWeightKg)) return { ok: false, reasons: ['PAYLOAD_BELOW_CARGO_WEIGHT'], score: 0 };
      if (d.requiresRefrigeration && !vehicle.hasRefrigeration) return { ok: false, reasons: ['REFRIGERATION_REQUIRED'], score: 0 };
      if (d.requiresTailLift && !vehicle.hasTailLift) return { ok: false, reasons: ['TAIL_LIFT_REQUIRED'], score: 0 };
      reasons.push('CATEGORY_MATCH', 'PAYLOAD_OK');
      return { ok: true, reasons, score: 100 };
    },
  },
  trips: {
    // BOOKED → DRIVER_ASSIGNED → DRIVER_EN_ROUTE → ARRIVED_AT_PICKUP → LOADING → LOADED → IN_TRANSIT → ARRIVED_AT_DESTINATION → UNLOADING → DELIVERED → COMPLETED
    transitions: {
      BOOKED: ['DRIVER_ASSIGNED', 'CANCELLED'],
      DRIVER_ASSIGNED: ['DRIVER_EN_ROUTE', 'CANCELLED', 'EXCEPTION'],
      DRIVER_EN_ROUTE: ['ARRIVED_AT_PICKUP', 'CANCELLED', 'EXCEPTION'],
      ARRIVED_AT_PICKUP: ['LOADING', 'CANCELLED', 'EXCEPTION'],
      LOADING: ['LOADED', 'CANCELLED', 'EXCEPTION'],
      LOADED: ['IN_TRANSIT', 'CANCELLED', 'EXCEPTION'],
      IN_TRANSIT: ['ARRIVED_AT_DESTINATION', 'CANCELLED', 'EXCEPTION'],
      ARRIVED_AT_DESTINATION: ['UNLOADING', 'CANCELLED', 'EXCEPTION'],
      UNLOADING: ['DELIVERED', 'CANCELLED', 'EXCEPTION'],
      DELIVERED: ['COMPLETED'],
      COMPLETED: [],
      CANCELLED: [],
      EXCEPTION: ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'LOADING', 'LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING', 'CANCELLED'],
      // no passenger states on a goods trip
      TRIP_STARTED: [],
      IN_PROGRESS: [],
    },
    startStatus: 'LOADED',
    odometerRequiredOn: ['LOADED', 'DELIVERED'],
    proofRequiredOn: ['DELIVERED'],
    activeStatuses: ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'LOADING', 'LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING', 'EXCEPTION'],
  },
  // A goods driver needs the professional driver card (OQ-29): eligibility is approved per vertical.
  driverEligibilityRequired: true,
  regulatory: {
    // TGA's Bayan transport document (وثيقة النقل) is compulsory for road goods carriers (OQ-29). No public
    // API is known, so the reference is captured by ops/driver on the trip; whether dispatch is blocked
    // without it is `dispatch.goods_transport_document_required` — off until UniGate confirms the process.
    referenceTypes: ['BAYAN', 'OTHER'],
    async beforeDispatch(trip) {
      const required = await getSettingValue<boolean>('dispatch.goods_transport_document_required', false);
      if (!required || trip.regulatoryReference) return { ok: true };
      return { ok: false, code: 'TRIP_REGULATORY_DOCUMENT_REQUIRED', message: `Trip ${trip.tripNumber} needs its transport document (Bayan) reference before the driver leaves`, details: { tripNumber: trip.tripNumber, referenceTypes: ['BAYAN', 'OTHER'] } };
    },
  },
  invoice: {
    lineDescription(l, granularity) {
      const when = l.scheduledStartAt.toISOString().slice(0, 10);
      return granularity === 'ORDER'
        ? { en: `Freight transport — order ${l.requestNumber}, ${l.vehicleCount} vehicle${l.vehicleCount > 1 ? 's' : ''}, ${l.pickupAddressLine} → ${l.dropoffAddressLine} (${when})`, ar: `نقل بضائع — طلب ${l.requestNumber}، ${l.vehicleCount} مركبة، ${l.pickupAddressLine} ← ${l.dropoffAddressLine} (${when})` }
        : { en: `Freight transport — booking ${l.bookingNumber}, ${l.vehicleDescription}, ${l.pickupAddressLine} → ${l.dropoffAddressLine} (${when})`, ar: `نقل بضائع — حجز ${l.bookingNumber}، ${l.vehicleDescription}، ${l.pickupAddressLine} ← ${l.dropoffAddressLine} (${when})` };
    },
    // OQ-27: zero-rating (category Z) for cross-border goods transport needs the advisor's evidence rules; domestic freight is standard-rated.
    vatCategory() {
      return 'S';
    },
  },
};
