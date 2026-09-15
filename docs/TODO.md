# UniGate — Open Implementation Work

**Last updated:** 2026-09-15

Unresolved work items. Distinct from [assumptions.md](assumptions.md) (business questions for UniGate) and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) (progress tracking). This file is for engineering tasks that are known but not yet done.

---

## ~~Immediate — Phase 2 (Project Foundation)~~ ✅ complete 2026-09-15

All items delivered; residuals moved to Phase 3 below.

- [x] `git init`, `.gitignore`, `.gitattributes` (LF normalisation — the team is on Windows), commit convention config
- [x] pnpm workspace + Turborepo pipeline; verify `turbo run build` from a clean checkout
- [x] `apps/api` — Express 5, TypeScript strict, path aliases, `main.ts` / `worker.ts` split
- [x] `apps/web` — Next.js 15 App Router, Tailwind, shadcn/ui init, `[locale]` segment
- [x] `packages/{types,validation,ui,config,eslint-config,tsconfig}` — real exports, not placeholders
- [x] ESLint boundary rules: no `@prisma/client` outside `apps/api`; no cross-module repository imports; no physical Tailwind direction utilities; no hard-coded role comparisons
- [x] `docker-compose.yml` — Postgres 16, Redis 7, MinIO, MailHog; healthchecks; named volumes
- [x] Prisma schema (all 76 tables) + first migration
- [x] Hand-written SQL migration for: `btree_gist`/`citext`/`pgcrypto`/`pg_trgm` extensions, the `vehicle_calendar_entries` `EXCLUDE` constraint, all partial unique indexes, all `CHECK` constraints, `audit_logs` and `vehicle_location_points` partitioning
- [x] **Migration-integrity test** — assert every hand-written constraint exists after `migrate deploy` on a clean database (mitigates risk AR-1)
- [x] Seeds: permissions (~110), roles (9), regions, cities, vehicle categories, document types, expense/maintenance categories, ledger accounts, system settings
- [x] Env validation with Zod; process refuses to boot on missing/placeholder secrets; `.env.example`
- [x] Response envelope, error classes, terminal error middleware, request-ID propagation via `AsyncLocalStorage`
- [x] pino logging with the redaction allow-list
- [x] `GET /health`, `GET /ready`
- [x] OpenAPI generation from Zod (`zod-to-openapi`) served at `/api/v1/docs`
- [x] CI: typecheck · lint · test · build on every PR
- [x] `README.md` and `docs/development.md` — local setup verified from a clean machine

---

## Phase 3 — Authentication & RBAC — COMPLETE 2026-09-15

- [x] Auth middleware producing `ActorScope`; `requirePermission()`; `PUT /settings/{key}` gated on `settings.manage` + step-up
- [x] Idempotency middleware on `POST /users` (first state-moving endpoint)
- [x] Outbox relay + BullMQ worker + partition-maintenance and purge jobs in `worker.ts`
- [x] Authorization matrix test (exit criterion) — 9 roles × IAM surface
- [x] Registration/OTP/login/refresh/logout, password forgot/reset/change, step-up, sessions, admin users/roles/permissions, first-admin CLI, OpenAPI
- [ ] `unigate_app` runtime role used by the API in staging/production — **moved to Phase 16** (deployment configuration: `DATABASE_URL` as the app role, migrations as owner)

## Phase 4 — User profiles & documents — COMPLETE 2026-09-15

- [x] Web login / OTP / registration / password-reset screens (shadcn) + portal shell, dashboard, documents checklist with presigned upload, admin owner approvals
- [x] Customer / corporate / owner / driver / SPO endpoints with `ActorScope` (PARTY scope arrives with bookings in Phase 8)
- [x] Document upload: presigned PUT, type/size/MIME validation, SHA-256 + magic-byte check on confirm, scan hook (`none` | `clamav`), signed downloads audited, expiry + orphan-sweep jobs
- [x] Owner onboarding + `owner_vertical_approvals`; driver approval + `driver_vertical_eligibility`; corporate verification + credit decision
- [x] Authorization matrix extended (profiles, documents, SPO, credit)
- [ ] `GET /customers/{id}/statement` — **Phase 11** (invoice ageing)

## Phase 5 — Vehicle management — COMPLETE 2026-09-15

- [x] `fleet` module: vehicles CRUD with plate/VIN uniqueness, approval workflow, lifecycle status; VerticalPlugin seam for capacity rules and checklist extras
- [x] Vehicle calendar — owner blocks over the EXCLUDE constraint; concurrency test on real PostgreSQL (exit criterion)
- [x] Driver ↔ vehicle assignments, history never overwritten
- [x] Dispatchability predicate (`fleet/vehicle.policy.ts`) + `GET /vehicles/{id}/availability`
- [x] Reference catalogue endpoints (public, cacheable) + makes/models seed
- [x] Web: fleet list, register, vehicle page (documents / calendar / drivers), admin vehicle approvals
- [x] Authorization matrix extended; router guards path-scoped (public routes were 401)

## Phase 6 — Trip requests — COMPLETE 2026-09-15

- [x] `demand` module with the vertical's detail block owned by the plugin (`detailKey`, `detailCreate/Update`, `validateRequest`, `matchVehicle`); goods → `501 VERTICAL_NOT_ENABLED`
- [x] Lifecycle: draft / publish / cancel / delete / close-remainder / adjust remainder; bidding deadline from `bidding.*` settings; expiry job that never touches partially awarded orders
- [x] Matcher on publish → `trip_request_invitations` with auditable reasons; owner redaction through PARTY scope; `/opportunities`
- [x] Customer requests list/form/detail and owner opportunities in the web app
- [x] Authorization matrix extended
- [ ] Maps autocomplete / geocoding — **waits for a provider server key** (form uses saved locations or city centres)

## Immediate — Phase 7 (Bidding)

- [ ] `bidding` module: `POST /bids` (server-computed totals with snapshotted VAT rate, `bidding.max_active_bids_per_owner_per_request`, `bidding.bid_validity_hours`), revise (version++), withdraw, reject
- [ ] Customer comparison list `GET /trip-requests/{id}/bids`; owner scope filters to own rows
- [ ] `POST /bids/{id}/accept` and `POST /trip-requests/{id}/award` (all-or-nothing group award): booking creation, calendar reservation under the EXCLUDE constraint, financial snapshot with commission rule / override, credit check for INVOICED customers — **N-way concurrent acceptance test (exit criterion)**
- [ ] Cancelling a request rejects SUBMITTED bids; `ownBidId` on opportunities; bid expiry job
- [ ] Web: owner bid form on the opportunity, customer bid comparison and accept
- [ ] Extend the authorization matrix with the bidding surface

## Deferred design work

- [ ] `docs/authentication.md`, `docs/authorization.md`, `docs/payments.md`, `docs/tracking.md`, `docs/deployment.md`, `docs/development.md` — written as each subsystem lands (brief §42)
- [ ] Notification template catalogue — full code list with en/ar copy (needs UniGate tone-of-voice input)
- [ ] Report specifications — exact columns and aggregations per report (brief §25)
- [ ] Admin dashboard KPI query definitions and caching strategy (brief §24)
- [ ] Design system tokens — colour, spacing, typography scale for both scripts
- [ ] Arabic copy review by a native speaker; Latin/Arabic numeral convention decision per surface

---

## Known gaps carried into implementation

- [ ] **Malware scanning** on uploads — hook point exists, no scanner procured (A-25)
- [ ] **WAF** — assumed at the CDN layer, not yet selected (depends on OQ-12)
- [ ] **Detail-table/discriminator invariant** enforced in the service only, not by a DB trigger (A-20) — revisit if direct SQL writes ever become a reality
- [ ] **SPO commission calculation** — not implemented, no rules exist (OQ-09)
- [ ] **ZATCA fields** — reserved and unpopulated (OQ-04)
- [ ] **Multi-stop trips** — deferred with a documented migration path (A-14)
- [ ] **PostGIS radius matching** — deferred; city-level matching at launch (A-09, A-11)
- [ ] **Corporate credit terms** — column exists, unused (OQ-17)
- [ ] **Phone-number proxying/masking** for post-trip contact — designed, not specified in detail
- [ ] **Push notifications** — provider interface only; FCM/APNs adapters await the mobile app

---

## Test debt to avoid accumulating

These are exit criteria, not nice-to-haves. Each is tied to the phase that must not close without it.

- [x] **Phase 3** — authorization matrix test: every role × every IAM resource, cross-tenant access returns 404 (extends per phase)
- [ ] **Phase 5** — vehicle calendar overlap tests against real PostgreSQL (Testcontainers)
- [ ] **Phase 7** — N-way concurrent bid acceptance: exactly one 201, rest 409, no orphan bookings
- [ ] **Phase 9** — webhook idempotency: duplicate delivery, out-of-order delivery, invalid signature
- [ ] **Phase 11** — ledger balance assertion: debits = credits per transaction group on every posting path
- [ ] **Phase 11** — snapshot immutability: changing a commission rule does not alter historical bookings
- [ ] **Phase 15** — golden path E2E in both `en` and `ar`, with RTL visual diff
