# UniGate — Implementation Status

**Last updated:** 2026-09-15
**Current phase:** **Phase 3 complete** (2026-09-15) → Phase 4 (User profiles & documents) ready to start
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
| 4 | User profiles & documents | `NOT_STARTED` | |
| 5 | Vehicle management | `NOT_STARTED` | ~~Approval workflow detail pending OQ-07~~ settings (ADR-009) |
| 6 | Trip requests | `NOT_STARTED` | Core `demand` + **`passenger` vertical**; goods tables migrated, goods endpoints `501 VERTICAL_NOT_ENABLED` ([ADR-010](decisions/ADR-010-vertical-modules-over-a-shared-core.md)) |
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

## Module status

| Module | Status | Backend | Frontend | Tests | Notes |
|---|---|---|---|---|---|
| `iam` | **DONE (Phase 3)** | jwt · permission/otp/auth/admin services · session + user repositories · auth/me/admin controllers & routes · mapper · openapi · `cli/create-admin.ts` | ✅ | db (auth lifecycle 10, authorization matrix 12) | Highest review priority. Impersonation (`typ: impersonation`) reserved for Phase 13. |
| `profiles` | NOT_STARTED | — | — | — | 5 actor types. Phase 4. |
| `reference` | IN_PROGRESS | settings: routes/controller/service/repository/mapper/openapi; registry of 75 keys with per-key Zod + cross-field rules | — | unit + db | Seeded master data done. Settings API live (`/settings`, `/settings/public`, `/settings/sections`, `PUT /settings/{key}` — mutating route is unauthenticated until Phase 3 and mounted outside production only). Remaining reference CRUD lands with Phases 4–5. |
| `documents` | NOT_STARTED | — | — | — | Presigned upload + verification. Phase 4. |
| `fleet` | NOT_STARTED | — | — | — | Vehicle calendar + exclusion constraint. Phase 5. **Critical path.** |
| `demand` | NOT_STARTED | — | — | — | Trip requests + matching. Phase 6. |
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
| Concurrency test | NOT_STARTED | Phase 7 exit criterion — must run against real PostgreSQL |
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
