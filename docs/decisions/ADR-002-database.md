# ADR-002 — PostgreSQL with Prisma, and a raw-SQL escape hatch

**Status:** Accepted
**Date:** 2026-09-14

## Context

The platform is transactional and financial: bookings, commissions, VAT, refunds and owner settlements. It also has a hard concurrency requirement — one vehicle cannot serve two overlapping trips — and a high-write, low-value data stream (GPS locations) that must not contend with the transactional core.

## Decision

**PostgreSQL 16 as the single system of record, accessed through Prisma, with hand-written SQL migrations for the constraints Prisma cannot express.**

## Rationale

### Why PostgreSQL specifically

Not merely "a relational database". Four PostgreSQL features are load-bearing in this design:

| Feature | Used for |
|---|---|
| `EXCLUDE USING gist` over `tstzrange` | The vehicle double-booking invariant ([ADR-004](ADR-004-vehicle-availability-and-concurrency.md)) — the single most important correctness guarantee in the system |
| `NUMERIC` | Exact decimal money. MySQL's `DECIMAL` is comparable, but combined with the above, Postgres wins outright |
| Declarative range partitioning | `vehicle_location_points` and `audit_logs`; retention becomes `DETACH PARTITION` rather than a mass `DELETE` |
| `JSONB` with indexing | Rule snapshots, privacy settings, event payloads — semi-structured data alongside relational integrity |

Plus `citext`, `pg_trgm` for admin search, and a clean upgrade path to PostGIS if radius matching arrives (A-11).

### Why Prisma

Type-safe client generated from the schema; migrations with a readable history; good transaction ergonomics (`$transaction` with interactive callbacks); parameterised queries by default, which removes the most common SQL-injection surface. The team's TypeScript-first stack makes it the natural fit.

### The escape hatch, and why it is called out explicitly

Prisma's schema language **cannot express**: `EXCLUDE` constraints, partial (`WHERE`) unique indexes, `CHECK` constraints, table partitioning, or `citext` columns.

This design depends on all five. They are therefore added via:

```bash
pnpm prisma migrate dev --create-only
# then hand-write the SQL into the generated migration file
```

This is a **known, accepted source of drift** (risk AR-1): `schema.prisma` will not reflect these constraints, and `prisma db push` would silently discard them. Two mitigations:

1. `prisma db push` is banned outside throwaway local experiments; `migrate` is the only sanctioned path.
2. A **migration-integrity test** runs `migrate deploy` against a clean database and asserts, via `pg_catalog`, that every hand-written constraint exists. A developer who regenerates a migration and loses the exclusion constraint fails CI rather than shipping a platform that double-books vehicles.

### Money representation

`NUMERIC(14,2)` with an explicit `currency CHAR(3)` alongside. `Prisma.Decimal` in TypeScript — never a JavaScript `number`. Serialised as a **string** over the wire.

The alternative, storing minor units as `BIGINT`, is also correct and is used by many payment systems. `NUMERIC` was chosen because the brief asks for decimal types, because SQL aggregate reporting reads naturally without a divide-by-100 everywhere, and because Prisma maps it to a `Decimal` type that makes accidental float arithmetic a type error rather than a silent rounding bug.

### Primary keys

UUID **v7**, generated in the application. Version 7 rather than 4: v7 is time-ordered, so B-tree inserts stay near-sequential instead of scattering across the index and fragmenting it. Retains v4's non-enumerability and safety for exposure in URLs.

## Consequences

**Positive:** the core invariant is enforced by the database; exact money; type-safe data access; partitioning solves location and audit retention cleanly.

**Negative:** hand-written SQL sits outside Prisma's model and must be actively guarded (AR-1); Prisma adds a layer to debug through; `NUMERIC` arithmetic is slower than integers (irrelevant at this volume).

**Neutral:** a single primary at assumed volumes (A-23), with a read replica for reporting.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| MySQL / MariaDB | No exclusion constraints — the availability invariant would move into application code or advisory locks |
| TypeORM / Drizzle / Kysely | Drizzle and Kysely express raw SQL better, but Prisma's migration tooling, generated client and ecosystem maturity matter more for a team-delivered project. Revisit only if the raw-SQL surface grows well beyond the planned constraints |
| MongoDB | Financial and relational integrity requirements make a document store the wrong tool here |
| Separate time-series store for locations at MVP | Premature. Partitioning plus sampling handles the assumed volume; TimescaleDB is the documented escalation (AR-5) |
