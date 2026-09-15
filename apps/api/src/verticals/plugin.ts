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
  /** Trip execution (Phase 10). */
  readonly trips: VerticalTripPlugin;
  /** Regulatory hooks (Phase 11b). */
  readonly regulatory: VerticalRegulatoryPlugin;
  /** Drivers must hold an APPROVED `driver_vertical_eligibility` row for this vertical before they are nominated or assigned. */
  readonly driverEligibilityRequired: boolean;
  /** Invoice wording and VAT category (Phase 11b). */
  readonly invoice: VerticalInvoicePlugin;
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

// ── Phase 10: trips ──────────────────────────────────────────────────────────

export type TripStatusCode =
  | 'BOOKED' | 'DRIVER_ASSIGNED' | 'DRIVER_EN_ROUTE' | 'ARRIVED_AT_PICKUP' | 'TRIP_STARTED' | 'IN_PROGRESS' | 'LOADING' | 'LOADED' | 'IN_TRANSIT'
  | 'ARRIVED_AT_DESTINATION' | 'UNLOADING' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED' | 'EXCEPTION';

export type TripTransitionMap = Readonly<Record<TripStatusCode, readonly TripStatusCode[]>>;

/**
 * One trip_status enum, two transition maps — each owned by its vertical (database.md §11.2).
 * The trips module asks the plugin; it never inspects transport_type.
 */
export interface VerticalTripPlugin {
  readonly transitions: TripTransitionMap;
  /** The status that marks the trip as physically under way (booking → IN_PROGRESS, start odometer). */
  readonly startStatus: TripStatusCode;
  /** Statuses that require a start / end odometer reading. */
  readonly odometerRequiredOn: readonly TripStatusCode[];
  /** Statuses that require a proof row before they are accepted (goods: DELIVERED). */
  readonly proofRequiredOn: readonly TripStatusCode[];
  /** Statuses in which the vehicle is moving with the customer's load/passengers (for the customer's phone-visibility rule). */
  readonly activeStatuses: readonly TripStatusCode[];
}

// ── Phase 11b: regulatory + invoice ──────────────────────────────────────────

/** What the core knows about a trip when it asks the vertical whether dispatch may proceed. */
export interface TripRegulatoryShape {
  tripNumber: string;
  status: TripStatusCode;
  regulatoryReference: string | null;
  regulatoryReferenceType: string | null;
}

export interface RegulatoryVerdict {
  ok: boolean;
  /** An error code from the contract when `ok` is false. */
  code?: 'TRIP_REGULATORY_DOCUMENT_REQUIRED';
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Regulatory documents differ per vertical (goods: TGA's Bayan transport document — OQ-29;
 * passenger: none at MVP). The trips module asks before the trip leaves (DRIVER_EN_ROUTE);
 * whether the document is enforced is a setting the vertical reads, never a code constant.
 */
export interface VerticalRegulatoryPlugin {
  /** Reference types this vertical accepts on `PATCH /trips/{id}` (`regulatoryReferenceType`). */
  readonly referenceTypes: readonly string[];
  beforeDispatch(trip: TripRegulatoryShape): Promise<RegulatoryVerdict>;
}

export interface InvoiceLineShape {
  bookingNumber: string;
  requestNumber: string;
  vehicleDescription: string;
  pickupAddressLine: string;
  dropoffAddressLine: string;
  scheduledStartAt: Date;
  vehicleCount: number;
}

/**
 * Invoice wording and the VAT category per line (database.md §12.6 `vat_category`: S standard,
 * Z zero-rated, E exempt, O out of scope). Zero-rating of cross-border goods transport (OQ-27) is
 * a decision for the advisor; until then every vertical answers 'S'.
 */
export interface VerticalInvoicePlugin {
  lineDescription(line: InvoiceLineShape, granularity: 'ORDER' | 'BOOKING'): { en: string; ar: string };
  vatCategory(line: InvoiceLineShape): 'S' | 'Z' | 'E' | 'O';
}
