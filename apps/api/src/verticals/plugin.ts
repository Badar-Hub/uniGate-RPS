import type { TransportType } from '@unigate/types';

/**
 * VerticalPlugin (ADR-010). The core never branches on transport_type; it resolves the plugin
 * for the vehicle category / request and calls it. Phase 5 introduces the seam with the
 * parts fleet needs; later phases extend the interface (request schema, trip map, invoice
 * descriptor, VAT decision) without touching core callers.
 */
export interface CategoryShape {
  code: string;
  minPassengerCapacity: number | null;
  maxPassengerCapacity: number | null;
  minPayloadKg: string | null;
  maxPayloadKg: string | null;
}

export interface VehicleCapacityInput {
  passengerCapacity?: number | undefined;
  payloadCapacityKg?: number | undefined;
  cargoVolumeM3?: number | undefined;
}

export interface CapacityValidation {
  ok: boolean;
  fieldErrors: Record<string, string[]>;
}

export interface VerticalPlugin {
  readonly type: TransportType;
  readonly enabled: boolean;
  /** Which capacity fields a vehicle in this vertical must carry, and the category's bounds. */
  validateVehicleCapacity(category: CategoryShape, input: VehicleCapacityInput): CapacityValidation;
  /**
   * The document checklist for a role is the set of document_types rows whose transport_type is
   * null or equals this vertical — the plugin may add category-specific extras (e.g. hazmat).
   */
  extraRequiredDocumentTypes(role: 'OWNER' | 'DRIVER' | 'VEHICLE', category: CategoryShape): string[];
}
