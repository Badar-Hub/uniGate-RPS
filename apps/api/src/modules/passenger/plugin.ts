import type { CapacityValidation, CategoryShape, VehicleCapacityInput, VerticalPlugin } from '@/verticals/plugin.js';

/** Passenger vertical (ADR-010, built first). Vehicles carry people: a positive seat count within the category's band. */
export const passengerPlugin: VerticalPlugin = {
  type: 'PASSENGER',
  enabled: true,
  validateVehicleCapacity(category: CategoryShape, input: VehicleCapacityInput): CapacityValidation {
    const fieldErrors: Record<string, string[]> = {};
    const seats = input.passengerCapacity;
    if (seats === undefined) fieldErrors['passengerCapacity'] = ['required for a passenger category'];
    else {
      if (category.minPassengerCapacity !== null && seats < category.minPassengerCapacity) fieldErrors['passengerCapacity'] = [`at least ${category.minPassengerCapacity} for ${category.code}`];
      if (category.maxPassengerCapacity !== null && seats > category.maxPassengerCapacity) fieldErrors['passengerCapacity'] = [`at most ${category.maxPassengerCapacity} for ${category.code}`];
    }
    return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
  },
  extraRequiredDocumentTypes(): string[] {
    return [];
  },
};
