# UniGate — Implementation Status

**Last updated:** 2026-09-14
**Current phase:** Phase 1 complete → **Phase 2 unblocked, ready to start**
**Overall:** Design complete and internally consistent. No application code written yet.

> **Schema-blocking questions resolved 2026-09-14.**
>
> - **OQ-16 — answered.** Partial fulfilment is supported: an order for N vehicles is accepted with whatever capacity exists, dispatched, and the balance filled in later waves. The order stays open until fully fulfilled or explicitly closed. Modelled as a per-request flag (`allow_partial_fulfilment`), defaulting on for goods and off for passenger. See [database.md §8.6](database.md).
> - **OQ-17 — answered.** Corporate customers are invoiced in arrears against an approved credit limit; individuals prepay. `INVOICED` bookings skip the payment gate entirely. Invoices become header + lines. See [database.md §12.6](database.md).
> - **OQ-14 — delivery position set.** Mobile is out of scope this engagement; the API stays strictly client-agnostic with published OpenAPI (A-28). Still contractually open with UniGate.
>
> **Five new questions arose from these answers** (OQ-19…OQ-23). **None blocks Phase 2.** The most consequential is **OQ-20**: if owners are settled weekly but corporates pay net-30, UniGate finances the gap on every corporate booking. That is a treasury decision needed before Phase 11, not before schema work.

Status values: `NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `COMPLETE`

---

## Phase status

| Phase | Name | Status | Notes |
|---|---|---|---|
| 0 | Requirements analysis | **COMPLETE** | [requirements-analysis.md](requirements-analysis.md) — 18 open questions raised |
| 1 | Architecture & data design | **COMPLETE** | [architecture.md](architecture.md), [database.md](database.md), [api.md](api.md), [security.md](security.md) |
| 2 | Project foundation | `NOT_STARTED` | **Unblocked** — OQ-16 and OQ-17 answered 2026-09-14, schema settled |
| 3 | Authentication & RBAC | `NOT_STARTED` | Production OTP provider blocked on OQ-10 (dev provider unblocks the phase) |
| 4 | User profiles & documents | `NOT_STARTED` | |
| 5 | Vehicle management | `NOT_STARTED` | Approval workflow detail pending OQ-07 |
| 6 | Trip requests | `NOT_STARTED` | |
| 7 | Bidding | `NOT_STARTED` | Bid window pending OQ-02; multi-vehicle award semantics pending OQ-16 |
| 8 | Bookings | `NOT_STARTED` | Cancellation fee tiers pending OQ-05 |
| 9 | Payments | `NOT_STARTED` | Production gateway **BLOCKED** on OQ-03; MockGateway path is unblocked |
| 10 | Trip execution & tracking | `NOT_STARTED` | Hardware GPS pending OQ-11; driver-app path unblocked |
| 11 | Finance | `NOT_STARTED` | Commission rate OQ-01, settlement cycle OQ-06, ZATCA OQ-04, SPO OQ-09 |
| 12 | Maintenance | `NOT_STARTED` | |
| 13 | Admin & reporting | `NOT_STARTED` | |
| 14 | Hardening | `NOT_STARTED` | Performance targets pending OQ-15 |
| 15 | Testing | `NOT_STARTED` | |
| 16 | Deployment | `NOT_STARTED` | Hosting region **BLOCKED** on OQ-12 (data residency) |

---

## Module status

| Module | Status | Backend | Frontend | Tests | Notes |
|---|---|---|---|---|---|
| `iam` | NOT_STARTED | — | — | — | Auth, sessions, RBAC. Phase 3. Highest review priority. |
| `profiles` | NOT_STARTED | — | — | — | 5 actor types. Phase 4. |
| `reference` | NOT_STARTED | — | — | — | Seeded master data. Phase 2. |
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
| `platform` | NOT_STARTED | — | — | — | Audit, outbox, idempotency. Phase 2. |

---

## Cross-cutting status

| Concern | Status | Notes |
|---|---|---|
| Monorepo & tooling | NOT_STARTED | pnpm + Turborepo. Phase 2. |
| Prisma schema & migrations | NOT_STARTED | Includes hand-written SQL for `EXCLUDE`, partial uniques, `CHECK`, partitions |
| Seed data | NOT_STARTED | ~110 permissions, 9 roles, reference data. No credentials in the repo. |
| Docker Compose | NOT_STARTED | Postgres · Redis · MinIO · MailHog |
| Error handling & envelope | NOT_STARTED | Phase 2 |
| Structured logging & request IDs | NOT_STARTED | Phase 2 |
| OpenAPI / Swagger | NOT_STARTED | Generated from the shared Zod schemas |
| i18n (en/ar) + RTL | NOT_STARTED | Logical-properties lint rule lands in Phase 2 |
| Authorization scope layer | NOT_STARTED | Phase 3. **Highest-risk component in the system.** |
| Audit logging | NOT_STARTED | Phase 2 helper; per-module coverage thereafter |
| CI pipeline | NOT_STARTED | typecheck · lint · test · build |
| E2E golden path | NOT_STARTED | Phase 15, but scaffolded from Phase 7 |
| Concurrency test | NOT_STARTED | Phase 7 exit criterion — must run against real PostgreSQL |
| Authorization matrix test | NOT_STARTED | Phase 3 exit criterion |

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
| B-1 | Payment gateway not selected (OQ-03) | Phase 9 production only | UniGate | 2026-09-14 |
| B-2 | ZATCA e-invoicing **applicability and wave** unknown (OQ-04) | Phase 11 production invoicing only — the flow is designed and mock-testable ([ADR-007](decisions/ADR-007-e-invoicing.md)) | UniGate tax advisor | 2026-09-14 |
| B-8 | **Principal-vs-agent VAT treatment (OQ-24)** — owners below the registration threshold may strand UniGate's input VAT | Phase 11 financial model | UniGate tax advisor | 2026-09-14 |
| B-3 | Mobile app scope divergence: RFP §5 vs brief §37 (OQ-14) | Contractual, not technical | UniGate + delivery lead | 2026-09-14 |
| B-4 | Data residency / PDPL position (OQ-12) | Phase 16 hosting decision | UniGate legal | 2026-09-14 |
| ~~B-5~~ | ~~Multi-vehicle award semantics (OQ-16)~~ | — | — | ✅ Resolved 2026-09-14 |
| ~~B-6~~ | ~~Corporate credit terms (OQ-17)~~ | — | — | ✅ Resolved 2026-09-14 |
| B-7 | **Owner settlement vs corporate payment terms (OQ-20)** | Phase 11 | UniGate finance | 2026-09-14 |

**Nothing currently blocks Phase 2.** B-1…B-4 and B-7 all bite later: payments production (Phase 9), invoicing finalisation and settlement (Phase 11), hosting (Phase 16), and the mobile scope question (contractual).
