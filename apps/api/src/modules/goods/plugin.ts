import { goodsDetails, type GoodsDetailsInput } from '@unigate/validation';
import { money } from '@/common/money.js';
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
 * Goods vertical (ADR-010, Phase 11b). The plugin exists so the seam is real from day one;
 * `enabled: false` makes every goods-specific endpoint answer 501 VERTICAL_NOT_ENABLED.
 * Vehicle registration for goods categories is allowed (fleets are registered ahead of the
 * vertical launching); dispatch into goods requests is not.
 */
export const goodsPlugin: VerticalPlugin = {
  type: 'GOODS',
  enabled: false,
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
  }
};
