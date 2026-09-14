# UniGate — Documentation Index

Vehicle Hiring & Management Platform (passenger + goods transport), Kingdom of Saudi Arabia.

**Current state:** Phase 0 (Requirements) and Phase 1 (Architecture) complete. No application code yet.

---

## Read in this order

| # | Document | What it answers |
|---|---|---|
| 1 | [requirements-analysis.md](requirements-analysis.md) | What is being built, what the RFP does and does not say, what is traced to what |
| 2 | [architecture.md](architecture.md) | How the system is structured and why |
| 3 | [database.md](database.md) | The domain model — 77 tables, enums, lifecycles, constraints |
| 4 | [api.md](api.md) | The REST contract, realtime events, webhooks |
| 5 | [security.md](security.md) | Threat model and controls |
| 6 | [assumptions.md](assumptions.md) | **Every guessed business rule, and the 18 questions UniGate must answer** |
| 6a | [open-questions-for-unigate.md](open-questions-for-unigate.md) | The same 18 questions written for the client — plain language, grouped by urgency, ready to send |
| 7 | [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Progress by phase and module |
| 8 | [TODO.md](TODO.md) | Outstanding engineering work |

## Architecture decision records

| ADR | Decision |
|---|---|
| [ADR-001](decisions/ADR-001-monorepo-and-modular-monolith.md) | Monorepo with a modular-monolith API |
| [ADR-002](decisions/ADR-002-database.md) | PostgreSQL + Prisma, with a raw-SQL escape hatch |
| [ADR-003](decisions/ADR-003-authentication.md) | JWT + rotating refresh tokens, server-side permission resolution |
| [ADR-004](decisions/ADR-004-vehicle-availability-and-concurrency.md) | **Unified vehicle calendar with a GiST exclusion constraint** — the most important technical decision here |
| [ADR-005](decisions/ADR-005-payment-abstraction.md) | Payment gateway abstraction, persist-then-process webhooks |
| [ADR-006](decisions/ADR-006-tracking-storage.md) | Three-tier location storage with sampled durable history |
| [ADR-007](decisions/ADR-007-e-invoicing.md) | E-invoicing designed into the issue path, behind a provider abstraction |

## Source material

- [rfp/UniGate_RFP_Vehicle_Hiring_Management.docx](rfp/UniGate_RFP_Vehicle_Hiring_Management.docx) — the original RFP as supplied
- [rfp/UniGate_RFP_extracted.md](rfp/UniGate_RFP_extracted.md) — text extraction for traceability

## To be written

`authentication.md` · `authorization.md` · `payments.md` · `tracking.md` · `deployment.md` · `development.md` — each written as its subsystem is implemented (engagement brief §42).

---

## If you read only one thing

[assumptions.md](assumptions.md). The RFP is two pages and defines almost no business rules — no commission rate, no cancellation policy, no settlement terms, no bid expiry, no SPO rules. Everything in this design that looks like a business decision is a **documented assumption awaiting confirmation**, not a requirement UniGate stated.

Two have since been answered (2026-09-14): orders may be **partially fulfilled across dispatch waves** and stay open until complete, and **corporate customers are invoiced in arrears** rather than prepaying. Both changed the schema. Twenty-one questions remain open; five of them were created by those two answers.
