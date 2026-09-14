# ADR-001 — Monorepo with a modular-monolith API

**Status:** Accepted
**Date:** 2026-09-14
**Deciders:** Lead architect
**Supersedes:** —

## Context

UniGate needs a web portal, a REST API, and — per RFP §5 — Android and iOS applications. Five distinct user types (admin, owner, driver, customer, SPO) share one domain model. The engagement brief mandates a monorepo with `apps/` and `packages/`.

Two questions had to be answered: how to organise the repository, and how to decompose the API.

## Decision

**A pnpm + Turborepo monorepo containing a Next.js web app, an Express API built as a modular monolith, and shared packages.**

## Rationale

### Monorepo

- Input validation is written **once** in `packages/validation` as Zod schemas and used by both the API (request validation) and the web app (React Hook Form). In a polyrepo these drift, and divergent validation between client and server is a security bug, not just an inconsistency.
- DTO types in `packages/types` mean a breaking API change fails the web app's type check in the same commit, not in production.
- One CI pipeline, one dependency graph, atomic cross-cutting changes.

pnpm for strict, disk-efficient workspace linking; Turborepo for task orchestration and caching. Both are the low-drama choices here — Nx is more capable but heavier than this repository needs.

### Modular monolith, not microservices

The decisive argument is the **bid-acceptance transaction**. It must atomically validate a bid, reserve a vehicle against a time window, create a booking, freeze a commission calculation, reject sibling bids, and schedule notifications.

As a monolith this is one PostgreSQL transaction, and the hardest part — "this vehicle cannot be on two trips at once" — is delegated to a GiST exclusion constraint (see [ADR-004](ADR-004-vehicle-availability-and-concurrency.md)). The database enforces the invariant.

Split across services, the same operation becomes a distributed saga with compensating transactions, and that invariant degrades from a guarantee into eventual consistency with a reconciliation process. For a platform whose core function is *not double-booking vehicles*, that is a bad trade made for a scale the platform does not have.

Secondary factors: the team size does not justify per-service operational overhead; the domain boundaries are not yet proven, and premature service boundaries are far more expensive to move than module boundaries.

### Keeping the option open

Module boundaries are enforced mechanically, not by convention:

1. A module owns its tables; no other module writes them.
2. Cross-module reads go through the owning module's **service** — never its repository, never a direct join. (Sanctioned exception: read-only reporting queries, isolated in the `reporting` module.)
3. Cross-module side effects go through **domain events**, never direct calls.
4. ESLint `no-restricted-imports` enforces 1–3 in CI.

Background workers already run as a separate process from the same image, and Socket.IO can be split to its own replica set behind the shared Redis adapter. The parts most likely to need independent scaling — tracking ingestion, notification dispatch, report generation — are therefore extractable without a rewrite.

## Consequences

**Positive:** one transaction boundary for the critical path; shared validation and types; fast local development (`docker compose up` plus one command); simple deployment; low operational overhead.

**Negative:** the whole API scales as a unit; a deployment affects everything; module boundaries require active enforcement, and under delivery pressure they erode (tracked as risk AR-6).

**Neutral:** the repository will grow large; Turborepo caching keeps CI times acceptable.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Polyrepo (separate web/api/shared repos) | Validation and type drift between client and server; cross-cutting changes need coordinated releases |
| Microservices from day one | Turns a database-enforced invariant into a saga; operational overhead unjustified at this scale and team size |
| Next.js API routes (no separate API) | RFP §5 requires native mobile apps. Coupling the API to the web framework's runtime and deployment model would make the mobile clients second-class — the brief (§37) explicitly requires the opposite |
| Nx instead of Turborepo | More powerful, more configuration; Turborepo covers this repository's needs |
