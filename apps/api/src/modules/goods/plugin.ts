import type { CapacityValidation, CategoryShape, VehicleCapacityInput, VerticalPlugin } from '@/verticals/plugin.js';

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
};
