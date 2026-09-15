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
  /** Demand behaviour (Phase 6). */
  readonly demand: VerticalDemandPlugin;
}

// ── Phase 6: demand ──────────────────────────────────────────────────────────

/** The shared request fields the plugin may need to validate a detail block against. */
export interface RequestShape {
  vehiclesRequired: number;
  tripDirection: 'ONE_WAY' | 'ROUND_TRIP';
  pickupAt: Date;
  returnAt: Date | null;
}

export interface RequestValidation {
  ok: boolean;
  fieldErrors: Record<string, string[]>;
}

/** A candidate vehicle for matching, as the core sees it (no vertical knowledge). */
export interface VehicleCandidate {
  id: string;
  categoryId: string;
  passengerCapacity: number | null;
  payloadCapacityKg: string | null;
  hasRefrigeration: boolean;
  hasTailLift: boolean;
}

export interface MatchVerdict {
  ok: boolean;
  /** Human-auditable reasons, stored in trip_request_invitations.match_reason. */
  reasons: string[];
  score: number;
}

export interface VerticalDemandPlugin {
  /** A-45: goods on, passenger off. */
  readonly partialFulfilmentDefault: boolean;
  /** The request body / row property that carries this vertical's detail block. */
  readonly detailKey: DetailKey;
  /** Prisma nested-write fragments for the detail table — owned by the vertical, never by core. */
  detailCreate(details: unknown): Record<string, unknown>;
  detailUpdate(details: unknown): Record<string, unknown>;
  /** Validates the vertical's detail block (already shape-checked by Zod) against the shared fields. */
  validateRequest(request: RequestShape, details: unknown): RequestValidation;
  /** Does this vehicle satisfy the detail block? Category and dispatchability are checked by the core. */
  matchVehicle(details: unknown, vehicle: VehicleCandidate): MatchVerdict;
}

/** Which detail block belongs to the vertical; the core never names either table itself. */
export type DetailKey = 'passengerDetails' | 'goodsDetails';
