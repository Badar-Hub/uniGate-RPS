# UniGate — Implementation Status

**Last updated:** 2026-09-15
**Current phase:** **Phase 12 complete** (Maintenance) 2026-09-15 → Phase 13 (Admin & reporting) ready to start
**Overall:** Foundation built and verified end to end: monorepo, typed packages, API core, full Prisma schema (82 tables) with hand-written constraints, seeds, migration-integrity test, web scaffold (shadcn/ui, ar/en RTL), CI. `pnpm ci` is green (20/20 tasks). See [development.md](development.md).

> **Schema-blocking questions resolved 2026-09-14.**
>
> - **OQ-16 — answered.** Partial fulfilment is supported: an order for N vehicles is accepted with whatever capacity exists, dispatched, and the balance filled in later waves. The order stays open until fully fulfilled or explicitly closed. Modelled as a per-request flag (`allow_partial_fulfilment`), defaulting on for goods and off for passenger. See [database.md §8.6](database.md).
> - **OQ-17 — answered.** Corporate customers are invoiced in arrears against an approved credit limit; individuals prepay. `INVOICED` bookings skip the payment gate entirely. Invoices become header + lines. See [database.md §12.6](database.md).
> - **OQ-14 — answered 2026-09-15.** Web application first; Android and iOS in a later phase once the portal is fully functional. The API stays strictly client-agnostic with published OpenAPI (A-28). Reflect the phasing in the SOW.
> - **OQ-03 — deferred by UniGate 2026-09-15; decision date agreed.** Provider chosen **no later than the start of Phase 8** (milestone **M-PAY**). `MockGateway` carries Phases 2–8; merchant onboarding then runs in parallel with Phase 8. Calendar date is set the day Phase 2 is scheduled.
> - **OQ-10 / OQ-11 / OQ-15 — answered 2026-09-15.** No SMS provider or sender ID (procurement blocker **B-9**); no GPS trackers (driver-app at launch); volumes are estimates (NFRs labelled `ESTIMATE`).
>
> **Five new questions arose from these answers** (OQ-19…OQ-23). **None blocks Phase 2.** The most consequential is **OQ-20**: if owners are settled weekly but corporates pay net-30, UniGate finances the gap on every corporate booking. That is a treasury decision needed before Phase 11, not before schema work.

Status values: `NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `COMPLETE`

---

## Phase status

| Phase | Name | Status | Notes |
|---|---|---|---|
| 0 | Requirements analysis | **COMPLETE** | [requirements-analysis.md](requirements-analysis.md) — 18 open questions raised |
| 1 | Architecture & data design | **COMPLETE** | [architecture.md](architecture.md), [database.md](database.md), [api.md](api.md), [security.md](security.md) |
| 2 | Project foundation | **COMPLETE** 2026-09-15 | Everything on the TODO list delivered and verified: see *Phase 2 exit* below |
| 3 | Authentication & RBAC | **COMPLETE** 2026-09-15 | See *Phase 3 exit* below. Production OTP delivery still needs **procurement B-9**; `ConsoleOtpProvider` refuses to run in production |
| 4 | User profiles & documents | **COMPLETE** 2026-09-15 | See *Phase 4 exit* below. Malware scanning runs with `SCAN_PROVIDER=none` until a scanner is procured (A-25) |
| 5 | Vehicle management | **COMPLETE** 2026-09-15 | See *Phase 5 exit* below. VerticalPlugin seam introduced (ADR-010); calendar EXCLUDE guarantee proven under concurrency |
| 6 | Trip requests | **COMPLETE** 2026-09-15 | See *Phase 6 exit* below. Core `demand` + passenger plugin; goods requests answer `501 VERTICAL_NOT_ENABLED` ([ADR-010](decisions/ADR-010-vertical-modules-over-a-shared-core.md)) |
| 7 | Bidding | **COMPLETE** 2026-09-15 | See *Phase 7 exit* below. Acceptance transaction under the global lock order; **N-way concurrent acceptance test green** |
| 8 | Bookings | **COMPLETE** 2026-09-15 | See *Phase 8 exit* below. ~~Cancellation fee tiers pending OQ-05~~ answered 2026-09-15 — admin-configured policies + per-case override/waiver, both implemented |
| 9 | Payments | **COMPLETE** 2026-09-15 | See *Phase 9 exit* below. `MockGateway` behind the `PaymentGateway` port; the real adapter is a later swap (OQ-03) |
| 10 | Trip execution & tracking | **COMPLETE** 2026-09-15 | See *Phase 10 exit* below. ~~Hardware GPS pending OQ-11~~ none fitted — the driver app (PWA) is the GPS source at launch: [driver-app.md](driver-app.md) |
| 11 | Finance | **COMPLETE** 2026-09-15 | See *Phase 11 exit* below. Settlements, invoices (clearance flow behind the `EInvoicingProvider` port — no compliance claimed, OQ-04), expenses, commission admin, ledger reads. Supplier invoicing (OQ-25/OQ-30) and SPO (OQ-09) carried forward |
| 11b | **Goods vertical** | **COMPLETE** 2026-09-15 | See *Phase 11b exit* below. Built behind `platform.verticals_enabled` (seed PASSENGER only); the Bayan gate and zero-rating are hooks awaiting OQ-29 / OQ-27; TGA licensing OQ-13 |
| 12 | Maintenance | **COMPLETE** 2026-09-15 | See *Phase 12 exit* below. Records hold the vehicle on its calendar (EXCLUDE), completion feeds odometer / schedule / expenses; the reminder job publishes `maintenance.due` (fan-out lands with notifications, Phase 13) |
| 13 | Admin & reporting | `NOT_STARTED` | Per-vertical admin sections; `platform.verticals_enabled` toggle |
| 14 | Hardening | `NOT_STARTED` | ~~Performance targets pending OQ-15~~ estimates agreed 2026-09-15 |
| 15 | Testing | `NOT_STARTED` | |
| 16 | Deployment | `NOT_STARTED` | Hosting region **BLOCKED** on OQ-12 (data residency) |

---

## Phase 2 exit — what was verified

| Check | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` | 20/20 tasks, 33 tests |
| `prisma migrate diff` migrations ↔ schema | zero structural drift |
| `EXCLUDE` double-booking | overlapping window rejected (23P01), adjacent accepted |
| Append-only audit / ledger / snapshots | UPDATE and DELETE refused by trigger, row routed to monthly partition |
| Plate uniqueness | `abc1234` collides with `ABC 1234` |
| Seed idempotency | second run inserts 0, overwrites nothing |
| API live | `/health`, `/ready` (booleans only), settings list/sections/public, PUT validated + cross-field + immutable + audited, 404 on trailing slash, CORS allow-list |
| Web live | `/` → 307 `/ar`; `<html lang="ar" dir="rtl">`; status card reads the API through CORS; no console errors |
| Boundary lint | ActorScope-first repositories, no Prisma in controllers, no entity spread in mappers, no `transport_type` branching in core — all active |

**Deliberately deferred to Phase 3:** authentication, the idempotency middleware and the outbox relay worker — all delivered in Phase 3 below. `packages/ui` as a separate package still waits for a second consumer.

---

## Phase 3 exit — what was verified

Verified on 2026-09-15 with `pnpm turbo run typecheck lint test build --force` (20/20 tasks), 41 API tests (12 migration-integrity, 10 auth lifecycle, 12 authorization matrix, 7 unit) plus a live smoke against the dev API (login in both transports, `/me`, step-up gate, cookie attributes, no secrets in logs).

| Area | Delivered | Proof |
|---|---|---|
| Access tokens | HS256 JWT (`jose`), `alg` pinned, `iss`/`aud`/`typ` verified; claims `sub sid roles pv` — permission codes are **never** in the token. The password-change epoch is rounded up to the next whole second and new tokens are dated at or after it, so `iat` second-granularity can neither keep a pre-change token alive nor kill the freshly issued one | auth.flow "password change revokes other sessions but keeps the current one" |
| Permissions | Resolved per request for the *current* `permission_version` from Redis `perm:{userId}:{pv}` (DB fallback); a role change bumps `pv` → effective on the next request, no redeploy | matrix "a new role works without a deployment" |
| Sessions & refresh | Opaque refresh tokens (SHA-256 at rest), rotation with family reuse detection under `FOR UPDATE`; replay revokes the whole family **and** the session; cap `platform.max_sessions_per_user` evicts the oldest | auth.flow "rotates refresh tokens and detects replay" |
| Dual transport | WEB → `ug_at` (`Path=/api/v1`) / `ug_rt` (`Path=/api/v1/auth`) httpOnly SameSite=Lax cookies with `tokens: null`; mobile → bearer in the body; a WEB session presented as bearer (or vice-versa) is `AUTH_TOKEN_INVALID` | auth.flow "web mode sets httpOnly cookies…" |
| CSRF | Cookie-mode mutations need `X-Requested-With: unigate-web` **and** an allow-listed `Origin` | same test |
| Passwords | Argon2id with rehash-on-login; policy is length-first (10 user / 12 staff) and rejects context words (own phone/email); dummy verify on unknown identifiers so timing and error code are identical | auth.flow "returns the same AUTH_INVALID_CREDENTIALS…", "enforces the password policy" |
| OTP | HMAC(pepper) at rest, supersession per (destination, purpose), burn on max attempts, sliding-window throttles per destination / IP / account (fail-open on Redis loss, logged), unverified-destination lifetime cap, **allowed-country gate before any send**; codes never appear in responses or logs | auth.flow throttling + country tests; log grep during smoke |
| Step-up | `POST /auth/step-up` → `/verify` → single-use 5-minute token bound to (user, session, actionClass); `requireStepUp()` answers `403 PERM_DENIED {stepUpRequired, actionClass}` | matrix step-up tests |
| Authorization | `authenticate()`, `requirePermission()`, `scopeFor()` → `ActorScope` (GLOBAL/OWN/SELF/PARTY) consumed by repositories; out-of-scope reads are **404, never 403** | matrix 9 roles × IAM endpoints; "out-of-scope records are 404" |
| Admin IAM | Users CRUD/suspend/reactivate/roles, roles CRUD, permission catalogue; self-modification and system-role guards; suspension revokes sessions immediately | matrix guards + suspension tests |
| Idempotency | `Idempotency-Key` middleware (INSERT … ON CONFLICT, replay with `Idempotency-Replayed: true`, body mismatch → 409) on `POST /users` | matrix idempotency test |
| Outbox & worker | `publishEvent()` in the business transaction → relay → BullMQ; maintenance jobs create next-month partitions and purge expired OTP/idempotency/session rows | worker boots; auth events flow through the outbox |
| Settings | `PUT /settings/{key}` now requires `settings.manage` **and** step-up class `SETTINGS`; reads require `settings.read`; mounted in every environment | settings routes |
| First admin | `pnpm --filter @unigate/api admin:create` — `ADMIN_EMAIL`/`ADMIN_PASSWORD` from the environment only, refuses a second SUPER_ADMIN unless `ADMIN_ALLOW_ADDITIONAL=true`, staff password policy, audited | run against the test DB |
| OpenAPI | 30 paths / 41 schemas; `iam.openapi.ts` registered in `docs/all.ts`; `openapi.json` regenerated and diff-checked | `openapi:check` |

**Carried forward (outside Phase 3 scope):** the `unigate_app` runtime role is created and granted but the API still connects as the owner locally — switching `DATABASE_URL` to the app role is a deployment configuration item (Phase 16); the web login page lands with the first portal screens in Phase 4; production OTP delivery waits on B-9; the impersonation endpoint (token `typ` reserved) lands with admin tooling in Phase 13.

---

## Phase 4 exit — what was verified

Verified on 2026-09-15 with `pnpm turbo run typecheck lint test build --force` (20/20 tasks), 69 tests (55 API: 12 migration-integrity, 10 auth lifecycle, 20 authorization matrix, 6 profiles & documents against the real MinIO, 7 unit; 14 package), plus a live browser session: OTP sign-in in cookie mode → portal boot from `/me` → onboarding guard → Arabic RTL documents checklist.

| Area | Delivered | Proof |
|---|---|---|
| Documents | Presigned two-step (`upload-url` → PUT to the store → `confirm` with Idempotency-Key). Server-generated keys; type/target/MIME/size/expiry validation; on confirm the object must exist, match size **and** SHA-256 (whole object hashed), and its **magic bytes must match the declared MIME**; scan hook; 120-s signed GET with `Content-Disposition: attachment`, every issuance audited, URL never logged | profiles.flow "presigned upload…" (declared PDF with PNG bytes → `DOCUMENT_MIME_NOT_ALLOWED` with `details.detected`) |
| Document ownership | Derived from the eight typed FKs inside the repository (owner → own docs, drivers' docs, vehicles' docs; driver → own; customer → corporate); out of scope is 404; `documents.download_any` and `SHARED_WITH_COUNTERPARTY` (booking-linked, live from Phase 8) widen it | same test + matrix |
| Requirements checklist | `GET /documents/requirements` — every active type for a target (filtered by vertical) with MISSING/PENDING/VERIFIED/REJECTED/EXPIRED; the identical computation gates owner submission and driver approval | owner onboarding test |
| Malware scanning | `ScanProvider`: `none` (reports SKIPPED — uploads are accepted **unscanned**, warned at boot in production) and `clamav` (clamd INSTREAM). **No scanner is procured (A-25)**; nothing pretends otherwise | code + env schema |
| Owners | DRAFT → (mandatory docs VERIFIED) → UNDER_REVIEW → APPROVED/REJECTED/SUSPENDED; verticals (`owner_vertical_approvals`); identity edits after approval → back to review; national id encrypted + last4 + blind index; privacy settings enforced in the mapper; service areas; payout accounts with **step-up `BANK_ACCOUNT`** and `settlement.bank_account_cooloff_hours` activation hold | profiles.flow "owner onboarding…" |
| Drivers | Owner-created phone-only user (OTP login stamps the phone verified); licence/ID encrypted; approval requires verified DRIVER documents + unexpired licence; availability rules (`DRIVER_NOT_APPROVED`, `ON_TRIP` system-only); deactivation revokes sessions and closes open vehicle assignments | profiles.flow "drivers…" |
| Customers | Corporate extension with the Saudi national address (FR-PROFILES-14); verification requires VAT number + complete address + verified CORPORATE documents; credit decision (`PATCH /admin/customers/{id}/credit`) refuses APPROVED without verification or a positive limit, requires a reason for SUSPENDED, audited NOTICE with before/after; `outstandingAmount` computed from `ledger_entries` on read (30-s cache) — never a column; VAT number locks once invoiced, admin correction route audited | profiles.flow "corporate customer…" |
| SPO | Profiles, admin-only customer assignment (one live per customer), lead pipeline, QUALIFIED → CONVERTED creating the customer with attribution, commission lines read from `booking_financial_snapshots` | profiles.flow "SPO…" |
| Authorization | `requirePermissionOrProfile()` for "own → global" rows; `x.read_any` satisfies `x.read`; **a repository bug found by the tests — `{ id, ...scopeWhere }` let the actor's own id override the requested id — fixed with `AND` and pinned by the matrix** | matrix 20/20 |
| Web | shadcn/ui primitives; cookie-mode API client with CSRF header and one transparent refresh; sign-in (password / OTP), registration + OTP, forgot/reset password; portal shell with `/me` boot, role-filtered nav, sign-out; dashboard with the onboarding card and submit guard; documents checklist with the in-browser presigned upload (SHA-256 computed client-side); admin owner-approval queue with document verify/reject and open-file | browser session |
| OpenAPI | 71 paths / 83 schemas, diff-checked | `openapi:check` |
| Dev experience | API entrypoints load the root `.env` in development (`process.loadEnvFile`), so `pnpm dev` and the desktop preview work without exporting variables; CORS now allows `X-Requested-With` (browser preflights were failing) | live check |

**Carried forward:** `GET /customers/{id}/statement` (needs invoice ageing — Phase 11); `SHARED_WITH_COUNTERPARTY` downloads become reachable when bookings exist (Phase 8); web screens for drivers, customers and SPO leads land with their phases; the web build still uses `cross-env NODE_ENV=production`.

---

## Phase 5 exit — what was verified

Verified on 2026-09-15 with `pnpm turbo run typecheck lint test build --force` (20/20 tasks), 79 tests (65 API: 12 migration-integrity, 10 auth lifecycle, 24 authorization matrix, 6 profiles & documents, 6 fleet, 7 unit; 14 package), plus a live browser session: register a vehicle → the vertical's capacity rule surfaces on the field ("at most 25 for MINIBUS") → draft detail with dispatchability reasons → vehicle document checklist → calendar block → overlapping block refused with the blocking window named.

| Area | Delivered | Proof |
|---|---|---|
| VerticalPlugin seam (ADR-010) | `src/verticals/{plugin,registry}.ts`; `modules/passenger/plugin.ts` (enabled) and `modules/goods/plugin.ts` (`enabled: false`). Core resolves capacity rules and checklist extras through it — no `transport_type` branch in `fleet` (lint-enforced) | lint + fleet test |
| Reference catalogue | Public, cacheable reads (ETag, `Cache-Control: public, max-age=300`, 304): categories, regions, cities, makes/models (20 makes / 66 models seeded), document types, expense/maintenance types, enum + transition catalogue; managed writes under `reference.manage` | fleet test "reference catalogue is public and cacheable" |
| Vehicles | Register in DRAFT with vertical-validated capacity; plate uniqueness on the normalised plate and VIN uniqueness among live rows (`VEHICLE_PLATE_TAKEN` / `VEHICLE_VIN_TAKEN`); DRAFT/REJECTED → PENDING_APPROVAL only when every mandatory VEHICLE document is VERIFIED and unexpired; approve/reject/suspend/reactivate audited; plate/VIN/category edits after approval → PENDING_APPROVAL; soft delete → ARCHIVED refused with future reservations; plate freed for re-registration | fleet test "registers…", "approval is gated…", "suspend/reactivate…" |
| Dispatchability | `fleet/vehicle.policy.ts` — pure predicate over approval, lifecycle, owner status, mandatory documents (respecting `documents.expired_document_blocks_dispatch`) and the vehicle's own expiry dates; returned on every DTO with reasons | fleet test |
| Calendar | Owner blocks as half-open `tstzrange` rows; **the EXCLUDE constraint is the guarantee** — 23P01 maps to `409 VEHICLE_CALENDAR_CONFLICT` with the blocking entries; **8 concurrent inserts for one window → exactly one 201, seven 409s, one live row** (Phase 5 exit criterion, real PostgreSQL); adjacent windows allowed; release; `GET /availability` combines dispatchability + overlaps + documents expiring inside the window | fleet test "calendar: … EXCLUDE guarantee under concurrent inserts" |
| Driver assignments | Approved, unexpired, same-owner drivers only; a new primary closes the previous primary (`REPLACED_AS_PRIMARY`) — rows are never overwritten; closing blocked while the vehicle is on a trip | fleet test "driver assignments…" |
| Authorization | Fleet and reference rows added to the matrix; **router guards are now path-scoped** — a bare `router.use(authenticate())` ran for every request passing through, which made `/settings/public` and the new catalogue reads 401 for anonymous callers (found by the fleet test) | matrix 24/24 |
| Web | Fleet list, registration form (categories/makes/models/cities from the catalogue, capacity field per vertical), vehicle page (status, dispatchability reasons, submit, document checklist reused from Phase 4, calendar with blocks and conflict display, driver assignment with history), admin vehicle-approval queue | browser session |
| OpenAPI | 94 paths / 113 schemas, diff-checked | `openapi:check` |

**Carried forward:** `operational_status` transitions (RESERVED/ON_TRIP/UNDER_MAINTENANCE) are system-driven and land with bookings (8), trips (10) and maintenance (12); PARTY scope for a customer viewing a booked vehicle lands with bookings (8); GPS device linkage waits for tracking (10).

---

## Phase 6 exit — what was verified

Verified on 2026-09-15 with `pnpm turbo run typecheck lint test build --force` (20/20 tasks), 86 tests (72 API: 12 migration-integrity, 10 auth lifecycle, 28 authorization matrix, 6 profiles & documents, 6 fleet, 3 demand, 7 unit; 14 package), plus a live browser session: a published request on the customer's page with full details, and the same request on the owner's Arabic opportunity card with only the cities shown, match score 95.00.

| Area | Delivered | Proof |
|---|---|---|
| VerticalPlugin (demand) | `demand` contract on the plugin: `detailKey`, `detailCreate/Update` (the vertical owns its detail table), `validateRequest`, `matchVehicle`, `partialFulfilmentDefault`. **The core demand service contains no `transport_type` branch** — the lint rule caught eight on the first pass and each moved into the plugin | lint + demand test |
| Trip requests | `POST /trip-requests` (Idempotency-Key required) with the passenger block; `TRIP_REQUEST_DETAIL_MISMATCH` on the wrong block; goods → `501 VERTICAL_NOT_ENABLED`; bidding deadline from `bidding.close_before_pickup_hours` / `bidding.max_window_hours`; `allowPartialFulfilment` defaults per vertical (A-45) and is forced false for one vehicle; route estimate snapshotted from the `MapsProvider` (`estimate` = great-circle × road factor, honestly named; a provider adapter waits for a server key) with `meta.degraded` on outage; `TR-YYYY-NNNNNN` numbering from the sequence | demand test "validates…" |
| Lifecycle | DRAFT edit/delete; publish; cancel (refused once anything is awarded); `close-remainder` and `PATCH …/remainder` (`RULE_VEHICLES_REQUIRED_BELOW_AWARDED`, `vehiclesRequired = vehiclesAwarded` → FULLY_AWARDED); the expiry job expires only `PUBLISHED` requests with nothing awarded — **partially awarded orders never expire** (A-45); `biddingOpen` is a deadline property on the DTO, not a status | demand test "remainder rules…" |
| Matching | On publish, in one transaction: fleet supplies structural candidates (approved + active, category, owner approved for the vertical **and** serving the pickup city, calendar free for the occupancy window), dispatchability predicate applied, then the vertical's `matchVehicle` (seats ≥ passengers, snug fit scores higher); `trip_request_invitations` written per vehicle with an auditable `match_reason`; outbox event carries the invited owners | demand test "publish runs the matcher…" (45-seat bus invited, 20-seat and out-of-area owner not) |
| Redaction | Owners reach an invited request through PARTY scope and get the **redacted projection**: street addresses reduced to the city, instructions and contact fields null, `redacted: true`; strangers get 404 | same test + browser |
| Opportunities | `GET /opportunities` (best invitation per request, redacted, with the owner's currently eligible vehicles), `GET /{id}` marks `viewed_at`, dismiss / `?undo=true` | same test |
| Web | Customer: requests list, new-request form (categories, cities, saved locations, the partial-fulfilment question in plain words), request page with estimate, deadline, publish/cancel/delete and — for staff — the invitation list; Owner: opportunities feed with match score, eligible vehicles, dismiss/restore | browser session |
| OpenAPI | 104 paths / 124 schemas, diff-checked | `openapi:check` |

**Carried forward:** bids and the award paths (`POST /bids`, `/trip-requests/{id}/award`, `/bids` listing on a request) are Phase 7 — the opportunity card says so; maps autocomplete/geocoding needs a provider key (the form uses city-centre coordinates when no saved location is chosen); `ownBidId` on opportunities is null until Phase 7; the Radix selects are hard to drive with the automated browser (typeahead lands on the wrong item) — not a product defect, but worth a native `<select>` fallback for accessibility review in Phase 15.

---

## Phase 7 exit — what was verified

Verified on 2026-09-15 with `pnpm turbo run typecheck lint test build --force` (20/20 tasks), 94 tests (80 API: 12 migration-integrity, 10 auth lifecycle, 33 authorization matrix, 6 profiles & documents, 6 fleet, 3 demand, 3 bidding, 7 unit; 14 package), plus a live browser session: an owner bid placed from the opportunity card (1250 + 50 → VAT 195 → **1495.00**, the worked example in api.md §6.4), accepted from the customer's request page → `BK-2026-000001`, `PENDING_PAYMENT` with a 30-minute payment window, a `HELD` reservation on the vehicle calendar buffered 60 min at both ends, and the Arabic bids page.

| Area | Delivered | Proof |
|---|---|---|
| Bids | `POST /bids` (Idempotency-Key required): eligibility through the invitation (`BID_NOT_ELIGIBLE`), category match, dispatchability re-run, driver nomination checks, **totals computed here and only here** with `finance.vat_rate_pct` snapshotted onto the row — a client-supplied total is `.strict()`-rejected, not compared; `bidding.max_active_bids_per_owner_per_request`, `BID_DUPLICATE_VEHICLE` (409), validity defaulted from `bidding.bid_validity_hours` and capped at the request deadline; revise (version++, totals recomputed, refused after the deadline), withdraw, courtesy reject; `effectiveCommission` shown to the owner when `bidding.show_effective_commission_to_owners` | bidding test "submission…" |
| Comparison list | `GET /trip-requests/{id}/bids` cheapest first; the customer sees owner notes; an owner's scope filters to their own rows; a rival bid is 404 by id; the customer never sees the owner's commission | same test |
| Acceptance transaction | `POST /bids/{id}/accept`: one interactive transaction, lock order **trip_requests → bids → vehicles → corporate_customer_profiles** (raw `FOR UPDATE`, bids and vehicles in ascending id order); `billingMode` resolved from the corporate billing cycle and snapshotted; credit check inside the lock for INVOICED (`RULE_CREDIT_NOT_APPROVED`, `RULE_CREDIT_LIMIT_EXCEEDED` over receivables + uninvoiced live bookings); commission resolved award-time override → request override → rule (priority, then specificity); booking + status history + `HELD` reservation (`booking.turnaround_buffer_minutes`, new setting) + financial snapshot with the identity `ownerNet + commission + commissionVat + paymentFee = gross` asserted before the write and the per-owner `vat_treatment` (§12.8: no commission VAT under `DEEMED_SUPPLIER`); `fulfilment_sequence` assigned under the lock; PREPAID → `PENDING_PAYMENT` + `payment_due_by`, INVOICED → `CONFIRMED` + `payment_status = INVOICED`, no window; siblings rejected only on full award; `non_circumvention_until` from settings | bidding test "acceptance…" and "group award…" |
| **Concurrency (exit criterion)** | Five owners' bids on a single-vehicle request accepted **concurrently** → exactly one `201`, four `409 TRIP_REQUEST_FULLY_AWARDED`, one booking row, one reservation; the same vehicle bid on an overlapping request → `409 BID_VEHICLE_UNAVAILABLE` from the EXCLUDE constraint, nothing written; idempotent replay of an accept returns the same booking with `Idempotency-Replayed` and no second row | same test, stable across 6 consecutive runs |
| Group award | `POST /trip-requests/{id}/award`: the set must cover the remainder exactly (`RULE_AWARD_SET_INCOMPLETE` with `remainder`/`suppliedBidCount`), single accept refused on a no-partial request (`RULE_PARTIAL_AWARD_NOT_ALLOWED` naming the award endpoint), duplicate vehicles caught up front, **one blocked vehicle rolls the whole set back** (zero bookings, request still PUBLISHED, bids still SUBMITTED), then the full set books with sequences 1..n and the request `FULLY_AWARDED` | bidding test "group award…" |
| Demand integration | Cancelling a request or closing its remainder rejects live bids; an owner with an accepted bid sees the request unredacted; `ownBidId` on opportunities; `invitedOwnerCount` now counts distinct owners (it counted vehicles) | bidding + demand tests |
| Jobs | `expireStaleBids` (SUBMITTED past `valid_until` → EXPIRED) runs with the request expiry every 5 min | bidding test |
| Web | Owner: bid dialog on the opportunity (native select for the vehicle, base fare + one extra + notes; the API returns the total), `/bids` list with withdraw; Customer: comparison table on the request page with accept / reject, checkbox selection and the group-award button for all-or-nothing orders, booking number surfaced on success | browser session |
| OpenAPI | 111 paths / 132 schemas, diff-checked | `openapi:check` |

**Carried forward:** bookings have no read surface yet — `GET /bookings`, cancellation (which must release the reservation and reopen the request), driver assignment and the payment-window expiry sweeper are Phase 8; `paymentFeeAmount` is 0 in the snapshot until a payment lands (Phase 9); SPO commission is snapshotted as `NONE` until Phase 11; the request-level commission override endpoint (`PATCH /trip-requests/{id}/commission-override`, `COMMISSION_OVERRIDE_AFTER_BIDS`) is admin tooling for Phase 13 — the award path already honours the columns; `commission_rules.percentage_rate` is stored as a fraction (the DB CHECK is `[0, 1]`), the API takes and shows a percent — database.md corrected; one intermittent API-test failure was seen under a parallel turbo run before the exclusion scenario was restructured and has not recurred in six runs since.

---

## Phase 8 exit — what was verified

Verified on 2026-09-15 with `pnpm turbo run typecheck lint test build --force` (20/20 tasks), 102 tests (88 API: 12 migration-integrity, 10 auth lifecycle, 38 authorization matrix, 6 profiles & documents, 6 fleet, 3 demand, 3 bidding, 3 bookings, 7 unit; 14 package), plus a live browser session: the booking page with the owner's earnings split, the cancellation dialog showing the quote (0.00 fee under the seed policy, 46.61 h notice, customer-only reason codes), the cancellation itself, and the parent request reopened as *partially awarded / open* on the Arabic page.

| Area | Delivered | Proof |
|---|---|---|
| Reads | `GET /bookings` (filters incl. `tripRequestId` for an order's waves, repeatable/comma `status`), `GET /bookings/{id}` projected per party (customer and driver never see the split; owner and staff do), `status-history`, `financials` by role (customer → price; owner → net; staff → rule snapshot) | bookings test "reads…" |
| Cancellation | `cancellation-quote` and `POST …/cancel` **share one assessment function**; `cancellation_policies` resolved like commission (specificity → priority → effective date) with **tiers by notice** and `no_cancel_window_hours`; reason codes gated by the canceller's role (`CANCELLATION_REASON_NOT_ALLOWED`); admin `feeOverride` (`CANCELLATION_FEE_OVERRIDE_FORBIDDEN` otherwise) and `waiveFee`, plus `POST …/cancellation/waive-fee` afterwards (`CANCELLATION_FEE_LOCKED` once processed) — all audited NOTICE with the policy/override **snapshotted** onto `booking_cancellations`; reservation set `RELEASED` (kept for audit, out of the EXCLUDE constraint — the vehicle is immediately bookable again, proven); the order's `vehicles_awarded--`, `vehicles_cancelled++`, `FULLY_AWARDED → PARTIALLY_AWARDED` (A-45); `BOOKING_ALREADY_CANCELLED` on repeat | bookings test "cancellation…" (≥72 h free, 30 h → 10 % = 115.00, inside 2 h refused, admin FIXED 50.00 override) |
| Transition map | Every move asserted against `BOOKING_TRANSITIONS[billingMode]` and written to `booking_status_history` (`details.allowed` on refusal) | bookings test "dispatch…" |
| Dispatch | Ops `confirm` (PENDING_PAYMENT → CONFIRMED, window cleared); `assign-driver` requires approved + licensed + **assigned to the vehicle** (`DRIVER_NOT_ASSIGNED_TO_VEHICLE`) + free for the window (`DRIVER_ALREADY_ON_TRIP`), creates the `trips` row with the driver snapshotted (`TP-YYYY-NNNNNN`); the driver becomes a PARTY and can read the booking; `ready` by owner or ops | same test |
| Sweeper | `expireUnpaidBookings`: PENDING_PAYMENT past `payment_due_by` → CANCELLED by SYSTEM (`PAYMENT_WINDOW_EXPIRED`), reservation released, order reopened; INVOICED bookings have no window and are never touched | same test |
| Web | Bookings list; booking page with schedule, parties, owner earnings, history, cancellation card; cancel dialog that fetches the quote first; owner driver assignment (native select over the vehicle's assigned drivers) and *ready*; bid list links to the booking | browser session |
| OpenAPI | 121 paths / 143 schemas, diff-checked | `openapi:check` |

**Carried forward:** `POST /bookings` (admin phone-order booking) and `PATCH /bookings/{id}` (ops corrections) are Phase 13 admin tooling; `dispute` / `resolve-dispute` land with complaints (13) and `no-show` with trip exceptions (10); the refund row on cancellation needs a captured payment (9) — `refund` is `null` today and `refundAmount` is recorded on the cancellation; the cancelled booking's `trips` row is left for Phase 10's trip cancellation path; `vehicles.operational_status` (`RESERVED`/`ON_TRIP`) is only meaningful once trips run and lands in Phase 10; the customer's PARTY scope on a booked vehicle (vehicle detail from the booking) is a Phase 10 tracking concern.

---

## Phase 9 exit — what was verified

Verified on 2026-09-15 with `pnpm turbo run typecheck lint test build --force` (20/20 tasks), 111 tests (97 API: 12 migration-integrity, 10 auth lifecycle, 43 authorization matrix, 6 profiles & documents, 6 fleet, 3 demand, 3 bidding, 3 bookings, 4 payments, 7 unit; 14 package), plus a live browser session: *Pay now* on a PENDING_PAYMENT booking → the mock hosted checkout → *simulate success* → the gateway's signed webhook lands on the real `/webhooks/payments/mock` route → the return page polls `/payments/{id}/status` and shows *Payment received* with the booking **Confirmed / Paid** and a balanced posting in the ledger.

**The gateway is `MockGateway` by UniGate's decision (2026-09-15): the real adapter is swapped in later.** Everything below runs behind the `PaymentGateway` port (ADR-005); the production adapter is one class implementing `createPayment · getPaymentStatus · refundPayment · verifyWebhook · parseWebhook` and one line in the registry. Environment validation refuses to boot production with `PAYMENT_PROVIDER=mock`.

| Area | Delivered | Proof |
|---|---|---|
| Port + mock | `integrations/payments/gateway.ts` (the port), `mock.gateway.ts` (a full implementation: hosted-page redirect, `BANK_TRANSFER` → `NONE` action, HMAC-SHA256 over `timestamp.rawBody` with constant-time compare and a ±5 min replay window, scriptable SUCCESS / DECLINE / AUTHORIZE_ONLY / silent settle / refund outcomes), registry keyed on `PAYMENT_PROVIDER` | payments test |
| Intent | `POST /payments` (Idempotency-Key required): exactly one of booking/invoice (form-level error, mirrors `ck_payments_single_target`), **the client's amount is compared only to catch a stale price** (`PAYMENT_AMOUNT_MISMATCH`) — the charged amount is the server's; method gate from `finance.payment_methods_enabled` ∩ gateway support (new setting); return-URL allow-list (app origin + CORS origins); one live intent per booking (`PAYMENT_ALREADY_PENDING`); INVOICED bookings refused (A-46); adapter error → `502 PAYMENT_GATEWAY_ERROR` with the row left PENDING and a FAILED `AUTHORIZE` transaction — "unknown", not "did not happen" | test "intent…" |
| Webhooks | Raw body (the global JSON parser is bypassed for `/webhooks/*`); verify → **persist first** (unique `(provider, event id)`) → 200 → job (`unigate-payments` BullMQ queue, job id = event row id) with a sweeper for rows whose job never ran; forged signature → **stored as evidence under its own key and answered 401** (a forged delivery carrying a genuine event id must not block the genuine one — found and fixed in the test); redelivery → `duplicate: true`, nothing reprocessed; a late `authorized` after `captured` is recorded `IGNORED` — the state machine, not arrival order, decides; unknown provider → 404 | test "webhooks…" |
| Capture | Under the payment's row lock: PAID, `CAPTURE` transaction with redacted payloads, audit, booking `payment_status = PAID` and `PENDING_PAYMENT → CONFIRMED`, ledger `DEBIT CASH_GATEWAY gross / CREDIT OWNER_PAYABLE ownerNet / CREDIT PLATFORM_COMMISSION_REVENUE / CREDIT VAT_PAYABLE commissionVat` following the frozen booking split; every group asserted balanced before write (`LEDGER_UNBALANCED` is a 500); `ownerPayableBalance` = credits − debits | same test |
| Reconciliation | `POST /payments/{id}/sync` (payments.manage) applies `getPaymentStatus()` server-to-server; the worker reconciles PENDING payments older than 10 min and cancels expired ones; `POST …/cancel` for an abandoned checkout; `GET …/status` reads local state only | test "decline → FAILED; /sync…" |
| Refunds | Cancelling a paid booking **requests** a refund for the refundable amount (never moves money in the cancellation); `POST /refunds` with Σ ≤ captured under the lock (`REFUND_EXCEEDS_CAPTURED`); four-eyes approval (`REFUND_FOUR_EYES`); `process` → 202, `PaymentGateway.refundPayment()`, PROCESSING; the gateway's refund webhook → COMPLETED, payment REFUNDED / PARTIALLY_REFUNDED, booking `CANCELLED → REFUNDED`, **pro-rata reversing postings** that balance | test "refunds…" |
| Web | Pay-now panel (method select from `/payments/config`, redirect to the gateway action, bank-transfer reference for `NONE`), the mock hosted checkout page (`/pay/mock/{id}`), return page with bounded-backoff status polling that never assumes success from the return itself | browser session |
| Also | BullMQ 6 rejects `:` in queue names — the pre-existing `unigate:events` / `unigate:maintenance` names would have failed at worker boot; renamed; the test harness now closes queues on teardown | worker |
| OpenAPI | 135 paths / 156 schemas, diff-checked | `openapi:check` |

**Carried forward:** the real gateway adapter (OQ-03 — UniGate will name the provider; ~1–2 weeks); fare VAT under the deemed-supplier model is recorded in the snapshot but not yet split out of the owner payable in the postings (ADR-008 pending the advisor); `paymentFeeAmount` stays 0 until the provider reports fees; saved instruments (`/payments/methods/saved`) and invoice payments land with invoicing (Phase 11); a refunds admin screen is Phase 13 (the API is complete); `PUT /payments/config` is the settings API (`finance.payment_methods_enabled`).

---

## Phase 10 exit — what was verified

Verified on 2026-09-15 with `pnpm turbo run typecheck lint test build --force` (20/20 tasks), 119 tests (105 API: 12 migration-integrity, 10 auth lifecycle, 48 authorization matrix, 6 profiles & documents, 6 fleet, 3 demand, 3 bidding, 3 bookings, 4 payments, 3 trips & tracking, 7 unit; 14 package), plus a live two-tab browser session: the **driver app** (`/en/driver`) listing the assigned trip, moving it to *en route* from the trip screen, the location agent starting by itself and streaming fixes ("2 sent · 0 queued · ±6 m"), while the **customer's tracking page** (`/en/track/{tripId}`) showed the *Live* badge, the vehicle dot and its trail moving on the map through the socket room, the ETA and the *Call driver* button.

| Area | Delivered | Proof |
|---|---|---|
| VerticalPlugin (trips) | `trips` contract on the plugin — `transitions` (one enum, **two maps**: passenger has no LOADING/LOADED/…; goods cannot skip LOADED), `startStatus`, `odometerRequiredOn`, `proofRequiredOn`, `activeStatuses`; the trips module never inspects `transport_type` | lint + trips test |
| Trip execution | `POST /trips/{id}/status` (Idempotency-Key): validated against the vertical's map (`TRIP_INVALID_TRANSITION` with `details.allowed`), `occurredAt` window (−24 h / +15 min), odometer required and monotonic, proof required for goods DELIVERED, driver-only (ops through `trips.manage`), CANCELLED refused here (it is its own operation). Side effects in one transaction: `DRIVER_EN_ROUTE` opens the tracking session, vehicle `ON_TRIP`, driver `ON_TRIP`, `vehicles_dispatched++`; `TRIP_STARTED` sets `actual_start_at` / start odometer, booking `IN_PROGRESS` (through READY when the ready check is off; refused when `dispatch.ready_check_required` and the owner has not marked READY); `COMPLETED` sets `actual_end_at`, distance (odometer delta, else the session's haversine sum), closes the session, releases the reservation, booking `COMPLETED`, vehicle `IDLE`, driver `AVAILABLE`, `vehicles_completed++` and the order `COMPLETED`; `trip_status_history` with coordinates on every move; `allowedNextStatuses` in every response so the driver app renders exactly the buttons that work | trips test "lifecycle…" |
| Ops cancellation | `POST /trips/{id}/cancel` (trips.manage): any non-terminal state → CANCELLED, session INTERRUPTED, vehicle IDLE, booking cancelled **even from IN_PROGRESS** through a dedicated bookings path (the map itself stays as documented), reservation released, order reopened, refund requested; drivers cannot cancel; the customer cannot cancel an IN_PROGRESS booking | trips test "ops cancellation…" |
| Tracking ingestion | `POST /tracking/ping`: assigned driver only (404), `ACTIVE` session required, 30/min per trip, future/stale samples refused; **tiered write path** — Redis `loc:{vehicleId}` (60 s TTL) on every ping, `current_vehicle_locations` upserted, `vehicle_location_points` appended only when ≥30 s / ≥50 m / >30° since the last persisted point (`persisted: false` is normal); `accuracyM > 500` flagged `lowConfidence` and excluded from the ETA; `/ping/batch` with per-item results; socket `trip.location` fan-out | trips test "tracking…" |
| Tracking reads | `GET /tracking/trips/{id}` (party → global; driver phone only for the customer while active; ETA via the maps provider, `meta.degraded` when unavailable; names the socket room), cursor-paginated history, `/tracking/vehicles` + `/{id}` for ops only, `/sessions/{id}/end` | same test |
| Realtime | Socket.IO namespace `/rt` on the API server (`src/realtime/hub.ts`): handshake resolves the actor with the **same** `actorFromToken` the HTTP middleware uses (cookie or bearer, never a query string), `room.join` through the same party predicate as the tracking read (404-equivalent ack), `auth.refresh` re-evaluates rooms, a 15-min revoked-session sweep, per-room monotonic `seq` + `emittedAt`, `trip.status` to `trip:` and `booking:` rooms, eviction on cancellation; no client→server event mutates state | trips test (room policy) + browser |
| Driver app (PWA) | `/{locale}/driver`: manifest, icons, scoped service worker with offline page, standalone shell; trips list; trip screen with server-driven buttons, odometer prompt, and the **location agent** (`lib/driver/tracker.ts`: GPS watch, 5-s throttle, localStorage queue → batch flush, wake lock, permission/GPS error states). See [driver-app.md](driver-app.md) for the install steps, the honest limits of a web agent and the native path | browser session |
| Customer tracking page | Leaflet map (OSM tiles for development; tile URL is configuration), vehicle + trail, socket room with polling fallback, ETA, call button | browser session |
| Also | `actorFromToken` extracted from the middleware for the socket handshake; a dispatched booking's cancellation now clamps `vehicles_dispatched` (the counters CHECK); the Engine.IO path sits under `/api/v1` so the cookie reaches it | tests |
| OpenAPI | 149 paths / 185 schemas, diff-checked | `openapi:check` |

**Carried forward:** background tracking on a locked phone needs a native wrapper around the same endpoints (see driver-app.md); the OSM tile server is development-only — production needs the licensed maps provider (same OQ as geocoding); the no-show path (`POST /bookings/{id}/no-show`) and EXCEPTION-driven disputes land with complaints (Phase 13); proof photos attach through the existing documents flow but the driver app has no camera capture screen yet (goods vertical, Phase 11b); the Redis Socket.IO adapter for multi-instance fan-out lands with deployment (Phase 16) — today one API process owns the namespace.

---

## Phase 11 exit — what was verified

Verified on 2026-09-15 with `pnpm turbo run typecheck lint test build --force` (20/20 tasks), 137 tests (123 API: 12 migration-integrity, 10 auth lifecycle, 61 authorization matrix, 6 profiles & documents, 6 fleet, 3 demand, 3 bidding, 3 bookings, 4 payments, 3 trips & tracking, 5 finance, 7 unit; 14 package), `openapi:check` up to date (179 paths / 221 schemas), plus a browser session: the **finance officer** built a settlement from the preview, submitted it, was refused approval by the four-eyes rule, an **admin** approved it, the payout was refused (`SETTLEMENT_BANK_ACCOUNT_MISSING · MISSING`) until a verified account past its cool-off existed, then recorded as *Paid*; a commission rule was created from the rules screen; a simplified tax invoice was issued for the completed prepaid booking and rendered as a printable document; the **owner** saw the paid settlement and recorded an expense that the paid period locked.

| Area | Delivered | Proof |
|---|---|---|
| Commission admin | `/commissions/rules` CRUD (percent on the API, fraction in storage), the **exactly-one-active-GLOBAL** invariant as `409 COMMISSION_RULE_OVERLAP` / `422 COMMISSION_GLOBAL_RULE_REQUIRED` instead of a CHECK violation, overlap detection per scope/target/window, `DELETE` = deactivate (snapshots keep their frozen copy — D6), `POST /commissions/rules/preview` (VAT-inclusive gross → RULE \| OVERRIDE \| NONE + split, no writes), `GET /commissions/earnings` (owner: own deductions; `reports.financial.read`: platform revenue; groupBy none/owner/category/month) | finance test "commission rules…" |
| Per-request override | `GET/PATCH /trip-requests/{id}/commission` (`commissions.override`): set or clear, `COMMISSION_OVERRIDE_INVALID`, `COMMISSION_OVERRIDE_LOCKED` on closed requests, and once any bid exists the override may **only lower** — same type with a smaller value or NONE; raising or clearing is `422 COMMISSION_OVERRIDE_AFTER_BIDS`; audited NOTICE with before/after; the response echoes `effectiveCommission` | same test |
| Settlements | `GET /settlements/preview` (owners as "pending settlement", staff per owner): eligible = COMPLETED + funded (PAID for PREPAID, on a live invoice for INVOICED) + past `settlement.hold_days_after_completion`, held rows explain why (`HOLD_PERIOD`, `PAYMENT_PENDING`); `POST /settlements` under a per-owner row lock builds one `BOOKING_EARNING` line per eligible booking, `uq_settlement_lines_booking_earning` makes a second settlement impossible (`409 SETTLEMENT_BOOKING_ALREADY_SETTLED`), `422 SETTLEMENT_NO_ELIGIBLE_LINES` / `SETTLEMENT_BELOW_MINIMUM`; manual `ADJUSTMENT`/`PENALTY` lines while DRAFT (a penalty must be negative; net never below zero); submit → PENDING_APPROVAL (or APPROVED under `settlement.requires_approval=false` / `auto_approve_below_amount`); **four-eyes** approve reads the submitter from the audit trail (`422 SETTLEMENT_FOUR_EYES`); reject → DRAFT with a reason; `POST …/pay` (202) needs a verified payout account past its cool-off (`SETTLEMENT_BANK_ACCOUNT_MISSING` with `details.reason` MISSING \| UNVERIFIED \| COOLOFF), checks the owner's ledger balance covers the amount, records the transfer reference and posts **DEBIT OWNER_PAYABLE / CREDIT CASH_BANK** → PAID; the gateway payout rail answers `501 SETTLEMENT_PAYOUT_RAIL_NOT_AVAILABLE` | finance test "settlements…" + browser |
| Ledger reads | `GET /ledger/entries` paginated over transaction groups (a page never splits a posting; every group shows debit = credit), filters by account / booking / payment / settlement / invoice / party / date; `GET /ledger/balances/owners/{id}` = Σ credits − Σ debits over OWNER_PAYABLE plus settlements in flight | same test |
| Invoices | One code path, two triggers: `POST /invoices` (single COMPLETED booking — PREPAID documents a settled supply and lands PAID with nothing outstanding; INVOICED is payable) and `POST /admin/invoices/generate` (billing cycle: one consolidated invoice per customer over every unbilled COMPLETED INVOICED booking, ORDER or BOOKING lines from `finance.invoice_line_granularity` / the corporate override, `invoice_line_bookings` links so `creditExposure` sees them). **Type resolved at issue time** from the buyer's `vatNumber` (TAX_INVOICE \| SIMPLIFIED_TAX_INVOICE). Gapless number **and** ICV minted under a transaction advisory lock (MAX+1 — a rollback leaves no hole), SHA-256 hash chained to the predecessor, phase-1-style TLV QR payload. Seller VAT from `finance.seller_vat_number` (empty → `422 INVOICE_SELLER_VAT_NOT_CONFIGURED`). Due date = credit terms snapshot → corporate terms → `billing.default_credit_terms_days`. Issue posts **DEBIT CUSTOMER_RECEIVABLE gross / CREDIT OWNER_PAYABLE ownerNet / CREDIT PLATFORM_COMMISSION_REVENUE / CREDIT VAT_PAYABLE** per booking from the frozen split | finance test "invoices…" |
| Clearance flow (ADR-007) | `EInvoicingProvider` port (`clear` / `report`) with `MockClearanceProvider` (dev/test, scriptable REJECT / UNAVAILABLE, **forbidden in production** by env validation) and `none` (plain invoices, `NOT_REQUIRED`, nothing claimed). Standard invoices: DRAFT → PENDING_CLEARANCE → (provider, after the transaction committed) → ISSUED + postings, or CLEARANCE_FAILED retained with the same number; simplified: ISSUED now, REPORTED after; unavailable provider → `503 CLEARANCE_PROVIDER_UNAVAILABLE` with the invoice left PENDING for `retryPendingClearances` (worker, 15 min) or `POST /admin/invoices/{id}/retry-clearance` (same document, same ICV); `GET /admin/invoices/clearance-queue` oldest-first with `lastErrorCode`. `pdf-url` / `xml` enforce `409 INVOICE_NOT_CLEARED` / `422 INVOICE_CLEARANCE_REJECTED` / `404` for NOT_REQUIRED, then `501 INVOICE_RENDERING_NOT_AVAILABLE` — the portal renders the document from the DTO (print view). **No compliance is claimed** (OQ-04); `cryptographic_stamp` and `clearance_response` are never selected by the repository | same test |
| Invoice payments | `POST /payments` with `invoiceId` (purpose `INVOICE_PAYMENT`): buyer-only, ISSUED \| PARTIALLY_PAID \| OVERDUE with an outstanding balance (`422 INVOICE_NOT_PAYABLE`), amount > 0 and ≤ outstanding (`PAYMENT_AMOUNT_MISMATCH`), one live intent per invoice; the gateway's capture moves paid/outstanding, status → PARTIALLY_PAID \| PAID and posts **DEBIT CASH_GATEWAY / CREDIT CUSTOMER_RECEIVABLE** under the invoice row lock | same test |
| Corrections | `void`: DRAFT / PENDING_CLEARANCE / CLEARANCE_FAILED, or ISSUED/OVERDUE while NOT_REQUIRED; refused once money was received (`INVOICE_NOT_VOIDABLE`) or the authority holds it (`409 INVOICE_ALREADY_CLEARED`); reverses the issue postings when they were made, releases the booking links (BOOKING lines step out of the partial unique index) so the bookings are billable again, never reuses the number. `credit-note`: all or per-line, ≤ outstanding (received money is refunded through `/refunds`), own number + ICV, follows the source's clearance flow, source → CREDITED when fully credited, posts CREDIT CUSTOMER_RECEIVABLE / DEBIT REFUNDS_ISSUED (the platform bears it; an owner's share is a settlement PENALTY line). `debit-note`: ADJUSTMENT/PENALTY lines with VAT at the current rate, **itself payable**, credit-checked for corporate buyers (`RULE_CREDIT_LIMIT_EXCEEDED`), posts DEBIT CUSTOMER_RECEIVABLE / CREDIT PLATFORM_COMMISSION_REVENUE + VAT_PAYABLE | same test |
| Overdue | `markOverdueInvoices` (worker, 15 min): ISSUED / PARTIALLY_PAID past due → OVERDUE once (`invoice.overdue` event), `invoice.overdue_reminder` on each day in `billing.overdue_reminder_days`; an OVERDUE invoice still takes a payment | same test |
| Expenses | `/expenses` CRUD + `/expenses/summary` (category / vehicle / month): VAT beside net, references (vehicle, driver, trip, receipt) resolved **through the owning modules under the actor's scope** so a foreign id is a 422 on the field, soft delete, `409 EXPENSE_IMMUTABLE` once the expense date falls inside a PAID settlement period of the owner (`isLocked` on the DTO) | finance test "expenses…" + browser |
| Web | `/settlements` (owner: pending preview + history; finance: build per owner with preview, list) and `/settlements/{id}` (lines, add adjustment, submit / approve / reject / record payout with the reference); `/invoices` (buyer list; finance: billing cycle, clearance queue with retry) and `/invoices/{id}` (printable document rendered from the lines, pay-now for the outstanding balance through the same `PayNow` panel as bookings, void / credit-in-full / retry for finance); `/expenses` (summary cards, record form, locked rows); `/admin/commissions` (rules table, create, deactivate, platform earnings roll-up); nav entries by profile/permission; bilingual messages incl. every finance error code | browser session |
| Settings | `finance.seller_vat_number`, `finance.seller_name_en`, `finance.seller_name_ar` (registry + catalogue + go-live checklist); `EINVOICING_PROVIDER` env (`mock` default outside production, `none` = plain invoices) | catalogue test |
| **Platform fleet (A-57 / FR-FLEET-13)** | Both operator models now behave differently in finance: subcontracted owners bid, earn net of commission and are settled; **UniGate's own fleet** (the single `is_platform_fleet` owner) is dispatched by ops **without a bid** through `POST /trip-requests/{id}/assign-platform-vehicle` (`bookings.manage`; a bid row is still written as the ops decision so the award path, reservation and frozen snapshot are shared; `422 PLATFORM_FLEET_VEHICLE_REQUIRED` for any other vehicle), its snapshot carries **no commission** whatever the rules say, capture / invoice issue post **DEBIT cash-or-receivable gross / CREDIT TRANSPORT_REVENUE net / CREDIT VAT_PAYABLE fare VAT** (UniGate is the supplier), refunds and voids reverse the same lines, and it is **never settled** (preview empty, build → `SETTLEMENT_NO_ELIGIBLE_LINES · PLATFORM_FLEET`, excluded from the settlements owner picker). Ops see an *Assign a UniGate fleet vehicle* card on an open request | finance test "platform fleet…" + matrix 61 |
| Authorization matrix | 13 rows (the platform-fleet assignment + 12 finance: commissions read/manage/override, settlements read/create/approve, ledger, invoices read/issue/clearance-queue, expenses read/create) | matrix 61 |

**Carried forward:** PDF rendering and the cleared-XML artefact land with the certified e-invoicing adapter (the portal prints the DTO today; `pdfDocumentId` / `clearedXmlDocumentId` stay null); the GATEWAY_PAYOUT rail is unwired (501) — bank transfers are executed outside the platform and recorded; supplier invoices / self-billing (FR-FINANCE-25, OQ-25/OQ-30) and the SPO commission roll-up (OQ-09) are not started, so the `SUPPLIER_INVOICE_MISSING` hold is not applied; fare VAT under the deemed-supplier model is still recorded, not posted (ADR-008 pending the advisor); `GET /customers/{id}/statement` (invoice ageing) is Phase 13 admin tooling; expense reimbursement into settlements is a decision for UniGate (today reimbursable is a flag); the owner earnings screen is the settlements page — a dedicated dashboard is Phase 13; the **platform-fleet margin report** (TRANSPORT_REVENUE against the customer invoice, per vehicle) is Phase 13 reporting — the ledger already carries the figures.

---

## Phase 11b exit — what was verified

Verified on 2026-09-15 with `pnpm turbo run typecheck lint test build --force` (20/20 tasks), 139 tests (125 API incl. 2 goods flows; 14 package), `openapi:check` up to date.

| Area | Delivered | Proof |
|---|---|---|
| The switch | The goods module is **capable** (`goodsPlugin.enabled = true`) and the deployment switches it on with `platform.verticals_enabled` (seed `['PASSENGER']`) — `isVerticalEnabled()` in the registry is plugin **and** setting; goods requests answer `501 VERTICAL_NOT_ENABLED` until UniGate flips the setting after OQ-13 / OQ-29. Registered goods vehicles, trips under way and reads are never gated | goods test "is a switch…", demand test |
| Requests | `goodsDetails` validated by the plugin (refrigeration needs a temperature range; detail block must match the vertical); matching by payload / refrigeration / tail lift; **bids re-run the plugin match** — a dry truck on chilled cargo is `422 BID_NOT_ELIGIBLE · REFRIGERATION_REQUIRED` even though the category matches (closed a gap: the matcher checked it at publish, the bid path did not) | goods test |
| Driver eligibility per vertical | `VerticalPlugin.driverEligibilityRequired` — goods requires an APPROVED `driver_vertical_eligibility` row (`422 DRIVER_NOT_APPROVED · vertical: GOODS`) on nomination and assignment; passenger keeps generic approval at MVP (OQ-13) | goods test |
| Freight lifecycle | DRIVER_EN_ROUTE → ARRIVED_AT_PICKUP → LOADING → LOADED (odometer, booking IN_PROGRESS) → IN_TRANSIT → ARRIVED_AT_DESTINATION → UNLOADING → DELIVERED (odometer + `DELIVERY_CONFIRMATION` proof, `422 TRIP_PROOF_REQUIRED` without) → COMPLETED; passenger states refused; LOADED cannot be skipped | goods test |
| Transport document (Bayan, OQ-29) | `VerticalPlugin.regulatory.beforeDispatch` — `trips.regulatory_reference/_type` (new columns, CHECK both-or-neither), `PATCH /trips/{id}` accepts a type the vertical lists (`BAYAN`, `OTHER`), and DRIVER_EN_ROUTE is refused with `422 TRIP_REGULATORY_DOCUMENT_REQUIRED` while `dispatch.goods_transport_document_required` is on (seed **off** — no TGA API is known; ops override through `trips.manage`) | goods test |
| Invoice wording + VAT category | `VerticalPlugin.invoice.lineDescription` ("Freight transport — …" / "Passenger transport — …") and `vatCategory` (both 'S'; zero-rating of cross-border freight is the advisor's call — OQ-27) — the invoice builder no longer phrases a line itself | goods test |
| Freight checklist | Category extras from the plugin (`VEHICLE_REFRIGERATION_CERT`, `VEHICLE_HAZMAT_PERMIT`) already applied by the fleet checklist | fleet tests |
| Web | Request form: vertical toggle (shown only when the deployment lists GOODS) and the cargo section (type, weight, volume, packages, refrigeration range, tail lift/crane, loading/unloading responsibility, insurance & declared value, shipper/consignee); request detail cargo card; driver app: **proof-of-delivery capture** before DELIVERED (recipient, ID last 4, notes, position) and the Bayan reference prompt before departure on goods trips | typecheck/lint |

**Carried forward:** photo/signature capture on the proof (documents upload from the driver screen); the TGA Bayan integration itself (OQ-29 — no public API found; the reference is captured manually); zero-rating (OQ-27); TGA licensing gates for owners/drivers (OQ-13); goods-specific admin sections (Phase 13).

---

## Vendor onboarding & access — what was verified (2026-09-15, UniGate's statement A-58)

| Area | Delivered | Proof |
|---|---|---|
| Admins add vendors | `POST /admin/vendors` (users.create + owners.create): account + VEHICLE_OWNER role + owner profile + verticals applied for + one-time activation link (token hashed, 72 h); public owner self-registration off by `onboarding.owner_self_registration_enabled` (`403 OWNER_SELF_REGISTRATION_DISABLED`); the register form hides the vendor option accordingly | vendors test, matrix |
| Activation + documents → review queue | The link's token sets the password (`/auth/password/reset`); the vendor signs in; a document confirm on the owner (or the individual behind it) moves DRAFT/REJECTED → `DOCUMENTS_SUBMITTED` once every mandatory document is uploaded (`owner.documents_submitted` event, admin queue); `submit-for-review` needs uploaded, `approve` needs **VERIFIED** (`OWNER_DOCUMENTS_INCOMPLETE`) | vendors + profiles tests |
| Fleet only after approval | `POST /vehicles` → `422 OWNER_NOT_APPROVED` until approved; a vehicle's documents completing moves it to `PENDING_APPROVAL` by itself (explicit submit is a no-op); `approve` → `422 VEHICLE_DOCUMENTS_INCOMPLETE` until verified; approved vehicles are dispatchable and may bid | vendors + fleet tests |
| Per-vendor access | `user_permission_overrides` (GRANT/DENY) resolved on top of roles in `permission.service`; `GET/PUT /users/{id}/permissions` (permissions.assign + step-up ROLE_CHANGE, no self-modification, only what the admin holds — `PERMISSION_NOT_HELD`), SECURITY audit, pv bump → effective on the next request | vendors test |
| Web | `/admin/vendors` (add vendor with the activation link shown once and copy button; list with onboarding state, links to the review queue and to access); `/admin/vendors/{userId}/access` (module × read/create/update/delete matrix + other actions, diff preview, note, step-up dialog); register form hides the vendor option when self-registration is off | typecheck/lint |

**Carried forward:** delivery of the activation link by email/SMS lands with notifications (Phase 13) — until then the admin hands it over; a per-vendor role template ("vendor tier") is a possible refinement of the overrides if UniGate wants presets.

---

## Phase 12 exit — what was verified (2026-09-15)

| Area | Delivered | Proof |
|---|---|---|
| Records | `/maintenance/records` CRUD + `start` / `complete` / `cancel`; a PLANNED / IN_PROGRESS record inserts a `MAINTENANCE` calendar entry **in the same transaction** — the EXCLUDE constraint decides: an owner block over the window → `409 VEHICLE_CALENDAR_CONFLICT`, a record over a reservation/block → `409 MAINTENANCE_CALENDAR_CONFLICT` with the blocking entries named; moving the window re-holds (can 409, the old hold survives) | maintenance test 1 |
| Lifecycle | `start` → IN_PROGRESS and the vehicle `UNDER_MAINTENANCE`; `complete` → hold released, odometer forward (backwards → 422), vehicle `IDLE`, the matching schedule rolled forward from the actual service, cost booked as a **MAINTENANCE expense** of the owner (`recordExpense`, default on); `cancel` releases the hold with a reason; COMPLETED / CANCELLED are final (`MAINTENANCE_INVALID_TRANSITION`); DELETE is PLANNED-only and staff-only (`maintenance.delete` + `read_any`) | maintenance tests 1–2 |
| Schedules & due | One active schedule per vehicle × service type (409); km and/or day intervals, next-due recomputed on patch; `GET /maintenance/due` by `withinDays` / `withinKm` / `overdueOnly` with `daysUntilDue` / `kmUntilDue`; deactivate drops it from the due list | maintenance test 3 |
| Scope | Owners see their own vehicles' records/schedules (other owners → 404); `maintenance.read_any` opens GLOBAL for OPS/admins; FINANCE / SUPPORT / CUSTOMER / DRIVER → 403 | matrix (3 rows) |
| Reminders | Daily `runFleetMaintenance` job → one `maintenance.due` outbox event per schedule inside `notifications.maintenance_reminder_days_before` / `_km_before` (seeds 7 / 500, settings catalogue) | worker wiring |
| Web | `/maintenance` (owner + ops): due panel with overdue flag, plan a visit (vehicle, service type, kind, window, initial status, cost/VAT, workshop), records table with start / complete (odometer, cost, notes, book-as-expense) / cancel / delete, service schedules (add, interval, next due, deactivate); nav item; en/ar copy incl. the new error codes | typecheck/lint |

**Carried forward:** notification fan-out of `maintenance.due` (Phase 13); workshop invoice upload from the maintenance screen (documents of kind `MAINTENANCE_RECORD` are accepted by `documentIds` on create already); parts catalogue / cost analytics per vehicle (reporting, Phase 13).

---

## Module status

| Module | Status | Backend | Frontend | Tests | Notes |
|---|---|---|---|---|---|
| `iam` | **DONE (Phase 3)** | jwt · permission/otp/auth/admin services · session + user repositories · auth/me/admin controllers & routes · mapper · openapi · `cli/create-admin.ts` | ✅ | db (auth lifecycle 10, authorization matrix 12) | Highest review priority. Impersonation (`typ: impersonation`) reserved for Phase 13. |
| `profiles` | **DONE (Phase 4)** | customer/owner/driver/spo repositories + services, saved locations, mapper (privacy + PII masking), controller, routes, openapi | ✅ | db (profiles.flow 6, matrix) | Statement endpoint waits for invoices (Phase 11). |
| `reference` | **DONE (Phase 5)** | settings (Phase 2/3) + catalogue.service/routes: public cacheable reads, managed writes; makes/models seed | ✅ | db (fleet + settings) | — |
| `documents` | **DONE (Phase 4)** | repository (ownership from typed FKs), service (presigned two-step, hash + sniff, scan hook, requirements, expiry/sweep jobs), controller, routes, openapi; `StorageProvider` (S3/MinIO), `ScanProvider` (none/clamav) | ✅ | db (real MinIO) | Uploads are unscanned until A-25 is resolved. |
| `fleet` | **DONE (Phase 5)** | vehicle.repository (scope, raw tstzrange calendar), vehicle.policy (dispatchability), vehicle.service, routes, mapper, openapi | ✅ | db (fleet 6, matrix) | operational_status transitions arrive with bookings/trips/maintenance. |
| `demand` | **DONE (Phase 6)** | trip-request.repository (OWN/PARTY/GLOBAL), service (lifecycle, matcher, opportunities, expiry job), mapper (redaction), routes, openapi; MapsProvider (`estimate`) | ✅ | db (demand 3, matrix) | Bids/award are Phase 7. |
| `bidding` | **DONE (Phase 7)** | bid.repository (OWN/PARTY/GLOBAL, row locks), bid.service (submit/revise/withdraw/reject, totals, expiry), award.service (accept + group award), mapper, routes, openapi | ✅ | db (bidding 3, matrix) | Request-level override endpoint is Phase 13 admin tooling. |
| `bookings` | **DONE (Phase 8)** | repository (scope, filters, locks, reservation release, driver conflicts), service (award creation, reads by role, quote = cancel, waive, confirm, assign-driver → trip row, ready, payment-window sweeper), mapper, routes, openapi | ✅ | db (bookings 3, matrix) | Admin booking / PATCH, dispute, no-show: Phases 10/13. |
| `trips` | **DONE (Phase 10)** | trip.repository (scope, locks, history, proofs), trip.service (transition endpoint through the vertical map, side effects, ops cancel, party predicate shared with tracking and sockets), mapper, routes, openapi | ✅ driver app | db (trips 3, matrix) | Dispute/no-show: Phase 13. |
| `tracking` | **DONE (Phase 10)** | tracking.repository (mirror, sessions, sampled points), tracking.service (ping/batch, tiered writes, reads, ETA), routes; `src/realtime/{hub,rooms}.ts` Socket.IO namespace | ✅ live map | db (trips 3) | Redis adapter for multi-instance: Phase 16. |
| `payments` | **DONE (Phase 9, MockGateway)** | payment.repository, payment.service (intent, state machine, capture postings, sync, reconciliation), webhook.service (verify → persist → 200 → job), refund.service (four-eyes, process, pro-rata reversal), jobs, routes, openapi; `integrations/payments` port + mock | ✅ | db (payments 4, matrix) | Real adapter when UniGate names the provider (OQ-03). |
| `finance` | **DONE (Phase 11)** | commission.service + commission-admin.service (rules CRUD, preview, request override, earnings), cancellation-policy.service, ledger.service (+ reads), settlement.repository/service, invoice.repository/service (builder, clearance flow, corrections, overdue), expense.repository/service, mapper, routes, openapi; `integrations/einvoicing` port + mock | ✅ | db (finance 4, matrix) | Supplier invoices / self-billing, SPO commissions: later. |
| `maintenance` | **DONE (Phase 12)** | maintenance.repository (OWN/GLOBAL through the vehicle relation, calendar hold via raw INSERT, due query), maintenance.service (records + hold in one tx, start/complete/cancel/delete, schedules, due, reminder job), mapper, routes, openapi | ✅ | db (maintenance 3, matrix) | Reminder fan-out with notifications (Phase 13). |
| `engagement` | NOT_STARTED | — | — | — | Ratings + complaints. Phase 13. |
| `notifications` | NOT_STARTED | — | — | — | OTP path lands in Phase 3; full system Phase 13. |
| `reporting` | NOT_STARTED | — | — | — | Async exports. Phase 13. |
| `admin` | NOT_STARTED | — | — | — | Phase 13. |
| `platform` | IN_PROGRESS | audit writer (`writeAudit`, redacted, request-id correlated); `outbox_events` and `idempotency_keys` tables | — | unit (redact) + db (append-only trigger) | Outbox relay and idempotency middleware land in Phase 3 with the first money-moving endpoint. |
| `passenger` | **DONE** | `plugin.ts`: capacity rules, checklist extras, request detail + matching, trip map, regulatory (none), invoice wording + VAT category | — | fleet, demand, trips, goods tests | — |
| `goods` | **DONE (Phase 11b)** | `plugin.ts`: cargo validation + matching, freight map with proof of delivery, refrigeration/hazmat checklist extras, Bayan dispatch gate (setting), per-vertical driver eligibility, freight invoice wording | ✅ request form, detail, driver proof capture | db (goods 2) | Switched on per deployment by `platform.verticals_enabled`. |

---

## Cross-cutting status

| Concern | Status | Notes |
|---|---|---|
| Monorepo & tooling | **DONE** | pnpm 9 + Turborepo 2; `pnpm ci` = typecheck · lint · test · build |
| Prisma schema & migrations | **DONE** | 82 tables, 84 enums; `20260915000000_init` (generated, hand-patched for two partitioned tables) + `20260915000001_constraints` (EXCLUDE, 20 partial uniques, 60+ CHECKs, monthly partitions with default, 9 sequences, append-only triggers, runtime-role grants). Zero structural drift vs `schema.prisma`. |
| Seed data | **DONE** | 119 permissions (parity-tested against architecture.md §6.2), 9 roles, 13 regions, 30 cities, 16 categories, 33 document types, 9 expense + 10 maintenance types, 14 ledger accounts, 75 settings, NONE commission rule / cancellation policies / SPO model, platform-fleet owner. Idempotent. Dev admin only from `SEED_ADMIN_*`; production seeds no accounts. |
| Docker Compose | **DONE** | Postgres 16 (:5433, extensions + test DB + `unigate_app` role via init script) · Redis 7 · MinIO (+ bucket init) · MailHog |
| Error handling & envelope | **DONE** | Error classes → status per api.md §3; uniform envelope; `details` absent-not-null; strict routing (trailing slash = 404); malformed JSON = 400; unknown body keys = 422 |
| Structured logging & request IDs | **DONE** | pino, route-pattern not URL, shared `redact()` (allow-list + `*_encrypted` pattern rule, unit-tested), `X-Request-Id` via AsyncLocalStorage into logs, audit rows and error bodies |
| OpenAPI / Swagger | **DONE** | Generated from Zod via `zod-to-openapi`; `openapi.json` committed and diffed in CI; Scalar UI at `/api/v1/docs` (non-production) |
| i18n (en/ar) + RTL | **DONE (scaffold)** | next-intl, `[locale]` segment owns `<html lang dir>`, Arabic default, IBM Plex Sans Arabic; physical-direction Tailwind utilities are a lint error; verified in-browser |
| Authorization scope layer | **DONE** | `authenticate()` → `ActorScope`; `requirePermission()`; `scopeFor()`; repositories take the scope first (lint-enforced). **Highest-risk component in the system** — every new repository joins the matrix. |
| Audit logging | **DONE (helper)** | `writeAudit()` in the business transaction; before/after redacted; DB-level append-only trigger proven by test |
| CI pipeline | **DONE** | GitHub Actions: services (Postgres+Redis) → gitleaks → `turbo run typecheck lint test build` → migrate deploy + seed twice (idempotency) → openapi diff → docs cross-reference check |
| E2E golden path | NOT_STARTED | Phase 15, but scaffolded from Phase 7 |
| Concurrency test | **DONE (calendar)** | 8 concurrent owner blocks on one window → 1 × 201, 7 × 409, one live row (real PostgreSQL EXCLUDE). Bid acceptance (Phase 7) adds its own. |
| Authorization matrix test | **DONE (IAM surface)** | `test/db/authorization.matrix.test.ts` — 9 roles × IAM endpoints, step-up, pv bump, anti-enumeration 404s, self-modification, suspension, idempotency. Grows with every phase. |

---

## Documentation status

| Document | Status |
|---|---|
| [requirements-analysis.md](requirements-analysis.md) | COMPLETE |
| [architecture.md](architecture.md) | COMPLETE |
| [database.md](database.md) | COMPLETE |
| [api.md](api.md) | COMPLETE |
| [security.md](security.md) | COMPLETE |
| [assumptions.md](assumptions.md) | COMPLETE — living |
| [TODO.md](TODO.md) | COMPLETE — living |
| `decisions/ADR-001..007` | COMPLETE |
| `authentication.md` · `authorization.md` · `payments.md` · `tracking.md` · `deployment.md` · `development.md` | NOT_STARTED — Phase 2+, as each subsystem is built |

---

## Blockers

| # | Blocker | Blocks | Owner | Raised |
|---|---|---|---|---|
| B-1 | Payment gateway not selected — deferred by UniGate; **decision due at the start of Phase 8 (M-PAY)** (OQ-03) | Phase 9 production only | UniGate | 2026-09-14 / 2026-09-15 |
| B-9 | **SMS provider and CST/CITC sender ID — none exists** (OQ-10 answered). Public registration cannot open without it; registration takes weeks | Phase 3 staging/production | UniGate procurement | 2026-09-15 |
| ~~B-2~~ | ~~ZATCA e-invoicing applicability and wave unknown (OQ-04)~~ | — | — | ✅ Resolved 2026-09-14 — already integrated via Wafeq (A-52) |
| B-10 | **Self-billed leg: Wafeq capability (OQ-30) and ZATCA Art 53(2) approval (OQ-25)** — the Public API in use cannot issue self-billed invoices; approval lead time unknown | Phase 11 supplier invoicing only | UniGate → Wafeq / ZATCA | 2026-09-15 |
| B-8 | **VAT operating model (OQ-24)** — [ADR-008](decisions/ADR-008-vat-operating-model.md) proposes uniform principal; advisor confirmation decides whether e-invoicing is one certificate or one per owner | Phase 11 financial model; per-owner CSID onboarding deliberately unbuilt | UniGate tax advisor | 2026-09-14 |
| ~~B-3~~ | ~~Mobile app scope divergence: RFP §5 vs brief §37 (OQ-14)~~ **Resolved 2026-09-15** — web first, mobile later phase; SOW to reflect it | — | UniGate + delivery lead | 2026-09-14 → closed 2026-09-15 |
| B-4 | Data residency / PDPL position (OQ-12) | Phase 16 hosting decision | UniGate legal | 2026-09-14 |
| ~~B-5~~ | ~~Multi-vehicle award semantics (OQ-16)~~ | — | — | ✅ Resolved 2026-09-14 |
| ~~B-6~~ | ~~Corporate credit terms (OQ-17)~~ | — | — | ✅ Resolved 2026-09-14 |
| ~~B-7~~ | ~~Owner settlement vs corporate payment terms (OQ-20)~~ | — | — | ✅ Resolved 2026-09-14 — UniGate funds the gap (A-48) |

**Nothing currently blocks Phase 2.** B-1…B-4 and B-7 all bite later: payments production (Phase 9), invoicing finalisation and settlement (Phase 11), hosting (Phase 16), and the mobile scope question (contractual).
