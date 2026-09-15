# UniGate — Implementation Status

**Last updated:** 2026-09-15
**Current phase:** **Phase 6 complete** (2026-09-15) → Phase 7 (Bidding) ready to start
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
| 7 | Bidding | `NOT_STARTED` | ~~Bid window pending OQ-02~~ settings (ADR-009); ~~OQ-16~~ answered |
| 8 | Bookings | `NOT_STARTED` | ~~Cancellation fee tiers pending OQ-05~~ answered 2026-09-15 (admin-configured policies + per-case override/waiver); no open blocker |
| 9 | Payments | `NOT_STARTED` | Production gateway **BLOCKED** on OQ-03 — decision due at start of Phase 8 (**M-PAY**); MockGateway path is unblocked |
| 10 | Trip execution & tracking | `NOT_STARTED` | ~~Hardware GPS pending OQ-11~~ none fitted — driver-app GPS at launch |
| 11 | Finance | `NOT_STARTED` | ~~Commission rate OQ-01~~ answered 2026-09-15 (admin-configured + per-trip override); settlement cycle OQ-06, self-billing OQ-25/OQ-30, SPO OQ-09 |
| 11b | **Goods vertical** | `NOT_STARTED` | New phase per [ADR-010](decisions/ADR-010-vertical-modules-over-a-shared-core.md): goods request/validation, goods trip state machine, freight checklist, Bayan hook, zero-rating decision, goods portal sections. **Gated on OQ-13 (freight) and OQ-29 only** |
| 12 | Maintenance | `NOT_STARTED` | |
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

## Module status

| Module | Status | Backend | Frontend | Tests | Notes |
|---|---|---|---|---|---|
| `iam` | **DONE (Phase 3)** | jwt · permission/otp/auth/admin services · session + user repositories · auth/me/admin controllers & routes · mapper · openapi · `cli/create-admin.ts` | ✅ | db (auth lifecycle 10, authorization matrix 12) | Highest review priority. Impersonation (`typ: impersonation`) reserved for Phase 13. |
| `profiles` | **DONE (Phase 4)** | customer/owner/driver/spo repositories + services, saved locations, mapper (privacy + PII masking), controller, routes, openapi | ✅ | db (profiles.flow 6, matrix) | Statement endpoint waits for invoices (Phase 11). |
| `reference` | **DONE (Phase 5)** | settings (Phase 2/3) + catalogue.service/routes: public cacheable reads, managed writes; makes/models seed | ✅ | db (fleet + settings) | — |
| `documents` | **DONE (Phase 4)** | repository (ownership from typed FKs), service (presigned two-step, hash + sniff, scan hook, requirements, expiry/sweep jobs), controller, routes, openapi; `StorageProvider` (S3/MinIO), `ScanProvider` (none/clamav) | ✅ | db (real MinIO) | Uploads are unscanned until A-25 is resolved. |
| `fleet` | **DONE (Phase 5)** | vehicle.repository (scope, raw tstzrange calendar), vehicle.policy (dispatchability), vehicle.service, routes, mapper, openapi | ✅ | db (fleet 6, matrix) | operational_status transitions arrive with bookings/trips/maintenance. |
| `demand` | **DONE (Phase 6)** | trip-request.repository (OWN/PARTY/GLOBAL), service (lifecycle, matcher, opportunities, expiry job), mapper (redaction), routes, openapi; MapsProvider (`estimate`) | ✅ | db (demand 3, matrix) | Bids/award are Phase 7. |
| `bidding` | NOT_STARTED | — | — | — | Acceptance transaction. Phase 7. **Critical path.** |
| `bookings` | NOT_STARTED | — | — | — | Phase 8. |
| `trips` | NOT_STARTED | — | — | — | Phase 10. |
| `tracking` | NOT_STARTED | — | — | — | Socket.IO + tiered storage. Phase 10. |
| `payments` | NOT_STARTED | — | — | — | Gateway abstraction. Phase 9. |
| `finance` | NOT_STARTED | — | — | — | Ledger + snapshots + settlements. Phase 11. |
| `maintenance` | NOT_STARTED | — | — | — | Phase 12. |
| `engagement` | NOT_STARTED | — | — | — | Ratings + complaints. Phase 13. |
| `notifications` | NOT_STARTED | — | — | — | OTP path lands in Phase 3; full system Phase 13. |
| `reporting` | NOT_STARTED | — | — | — | Async exports. Phase 13. |
| `admin` | NOT_STARTED | — | — | — | Phase 13. |
| `platform` | IN_PROGRESS | audit writer (`writeAudit`, redacted, request-id correlated); `outbox_events` and `idempotency_keys` tables | — | unit (redact) + db (append-only trigger) | Outbox relay and idempotency middleware land in Phase 3 with the first money-moving endpoint. |
| `passenger` | IN_PROGRESS | `plugin.ts`: capacity rules, checklist extras, **request detail ownership, validation and vehicle matching** | — | fleet + demand tests | Trip map, invoice descriptor, VAT decision land in Phases 10–11. |
| `goods` | IN_PROGRESS (seam only) | `plugin.ts` with `enabled: false` — goods vehicles can be registered ahead of the vertical | — | — | Phase 11b. |

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
