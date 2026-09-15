# ADR-010 — Two vertical modules (passenger, goods) over one shared core; passenger built first

**Status:** Accepted — agreed with UniGate 2026-09-15
**Date:** 2026-09-15
**Relates to:** [ADR-001](ADR-001-monorepo-and-modular-monolith.md) (modular monolith, module boundary rules), [ADR-004](ADR-004-vehicle-availability-and-concurrency.md), [ADR-009](ADR-009-configuration-over-constants.md)

## Context

The platform serves two businesses that share a marketplace but not a workflow: **passenger transport** (pilgrim, group and corporate movements — vehicle *with driver*, A to B) and **goods transport** (road freight). The design to date models both through a single `transport_type` discriminator: one `trip_requests` table with two detail tables, two trip transition maps keyed on the discriminator, vehicle categories tagged by type, and partial-fulfilment defaults per type.

That is a correct data model and an unsafe *code* model. As the two flows diverge — and they do, at the request form, the trip lifecycle, the mandatory documents, the regulatory artefacts (Bayan is goods-only; the TGA passenger regime is passenger-only), the VAT edge cases (cross-border goods zero-rating has no vehicle test; passenger needs ≥10 seats) and the invoice wording — `if (transportType === 'GOODS')` spreads through core services until nobody can say which behaviour belongs to which business. UniGate raised exactly this on 2026-09-15: *"transport module is separate, goods transport is separate, their vehicle will be separate … some of the stuff will be common but eventually their flow will be different."*

Separately, almost every unresolved external question is goods-only: Bayan has no public API (OQ-29), individual carriers are capped at one vehicle (OQ-29), freight brokerage licensing is its own TGA regime (OQ-13), zero-rating evidence ownership is unsettled (OQ-27). The passenger path has none of these.

## Decision

1. **One shared core, two vertical modules, inside the same modular monolith.** Core modules — `iam`, `profiles`, `reference`, `documents`, `fleet`, `bidding`, `bookings`, `payments`, `finance`, `tracking`, `maintenance`, `engagement`, `notifications`, `reporting`, `admin`, `platform` — stay **vertical-agnostic**. Two new modules, **`passenger`** and **`goods`**, own everything that differs.

2. **The core never branches on `transport_type`.** It calls the vertical through one registry interface, `VerticalPlugin`, resolved from the request's `transport_type`:

   ```ts
   interface VerticalPlugin {
     readonly type: 'PASSENGER' | 'GOODS';
     requestDetailSchema: ZodSchema;                       // passenger_trip_details / goods_trip_details
     validateRequest(req: TripRequestDraft): ValidationResult;
     tripStateMachine: TransitionMap<TripStatus>;          // the two maps in database.md §11
     requiredDocumentTypes(role: 'OWNER' | 'DRIVER' | 'VEHICLE', category: VehicleCategory): DocumentTypeCode[];
     onBookingConfirmed(ctx): Promise<void>;                // regulatory hooks — e.g. goods: Bayan transport document (OQ-29)
     onTripDispatched(ctx): Promise<void>;
     invoiceLineDescriptor(booking): BilingualText;         // FR-FINANCE-23: a journey, never a vehicle-period
     vatCategoryFor(booking): VatCategoryDecision;          // zero-rating rules differ (OQ-27)
     partialFulfilmentDefault: boolean;                     // A-45: goods on, passenger off (a setting seed)
   }
   ```
   `demand` (trip requests) becomes a thin core module that owns the shared `trip_requests` row and delegates the detail table, validation and matching predicates to the plugin. The trip transition map moves from `trips` into each vertical; `trips` executes whatever map the plugin supplies.

3. **One vehicle registry; a category belongs to exactly one vertical.** `vehicle_categories.transport_type` already exists and becomes the binding: a coach is passenger, a flatbed is goods, nothing is both. Registration *mechanics* (upload, verification, approval, calendar, exclusion constraint) are core; the *checklist* — which documents and licences are mandatory — comes from the vertical via `requiredDocumentTypes`. **An owner may operate in both verticals** (a fleet with buses and trucks) but is licensed and approved **per vertical**: `owner_profiles.verticals_approved` (`PASSENGER[]`, `GOODS[]`) with per-vertical `approved_at` / `approved_by`. Drivers likewise carry per-vertical eligibility, since the licence classes and TGA cards differ.

4. **Both verticals are in the schema from the first migration; only one is built first.** `transport_type`, `goods_trip_details`, category binding, per-vertical approval columns — all land in Phase 2. The **`goods` module is implemented after the core is proven on passenger**, as its own phase (see Consequences). Deferring the implementation is cheap; deferring the data model would shape core tables around one vertical and make the second a retrofit.

5. **Passenger first.** It is UniGate's stated primary business; its regulatory path is clean; and it exercises every core module end-to-end (bidding, booking, payment, ZATCA, settlement) before the second flow lands on top.

6. **Portals follow the split.** The customer chooses a vertical at entry; the owner portal shows only the verticals the owner is approved in; the admin portal has a section per vertical, consistent with ADR-009's per-section settings. Shared screens (documents, settlements, invoices) stay shared.

7. **The boundary is enforced, not hoped for.** ESLint `no-restricted-imports`: core modules may import `VerticalPlugin` and the registry, never `modules/passenger/*` or `modules/goods/*` directly; verticals may import core services, never each other. A `transport_type` comparison inside a core module is a lint error.

## Consequences

**Positive.**
- The confusion UniGate named has a home: anything that differs lives in a vertical module, anything shared lives in core, and the lint rule decides arguments.
- Goods' external unknowns (OQ-13, 27, 29) gate **the goods phase only**, not the platform. Passenger can reach production while Bayan and freight licensing are still being answered.
- The second vertical is a *module* to add, not a platform to re-plumb — the plugin seam is exercised from day one by the passenger implementation.
- A third vertical later (e.g. equipment hire) is the same shape.

**Negative.**
- **One more abstraction in the hot path.** `VerticalPlugin` is a seam every core developer must respect; the cost is an interface and a registry, the risk is someone bypassing it under deadline. The lint rule and code review are the mitigation.
- **Per-vertical approval adds onboarding state.** An owner approved for passenger is *not* approved for goods; the UI must say so clearly or owners will bid on freight they cannot legally carry.
- **Scope phasing must be written down.** RFP §3 names both verticals; building goods later is a phasing decision, not a scope reduction, and it goes into the statement of work the same way the mobile phasing did (OQ-14).
- **Passenger-only testing of the core** is a known blind spot until the goods module lands; the goods detail schema and transition map are unit-tested in Phase 2 even though nothing drives them yet.

## Phase plan change

| Was | Now |
|---|---|
| 6 Trip requests · 7 Bidding · 8 Bookings · 10 Trips — each covering both types via the discriminator | **6–11 build the core + the `passenger` vertical.** Goods tables exist and are migrated; goods endpoints return `501 VERTICAL_NOT_ENABLED` |
| — | **New Phase 11b — `goods` vertical:** goods request/validation, goods trip state machine, freight document checklist, Bayan hook (OQ-29), zero-rating decision (OQ-27), goods sections in all three portals. **Gated on OQ-13 (freight) and OQ-29**, not on anything else |
| 13 Admin & reporting | Adds per-vertical admin sections and the vertical toggle (`platform.verticals_enabled`, a setting) |

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep the discriminator and branch in core services | Works at two verticals for about six months; then every core change needs both flows in the reviewer's head. This is the confusion UniGate described |
| Two separate applications / codebases | Duplicates 80 % of the platform — identity, documents, bidding, bookings, payments, ZATCA, settlement, tracking — and splits the vehicle and owner registries that UniGate explicitly wants shared ("some of the stuff will be common") |
| Separate vehicle tables per vertical | The mechanics (calendar, exclusion constraint, approval, documents) are identical; only the checklist differs. Duplicating the table duplicates ADR-004's concurrency design for no gain |
| Build both verticals in parallel from Phase 6 | Doubles the surface under test while the core is unproven, and blocks passenger production on goods-only external questions |
| Drop goods from the schema until its phase | Turns the goods phase into a migration of live core tables and a retrofit of every snapshot; the data model is the cheap part to keep |
