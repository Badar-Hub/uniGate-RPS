# UniGate — Vehicle Hiring & Management Platform

A two-sided transport marketplace for Saudi Arabia: customers request passenger or goods
transport, registered vehicle owners bid, UniGate sells the service and settles the owners.
Web first, Arabic first, API client-agnostic.

| | |
|---|---|
| **Stack** | Next.js 15 · Express 5 · TypeScript (strict) · Prisma 5 · PostgreSQL 16 · Redis 7 · MinIO · pnpm + Turborepo |
| **Shape** | Modular monolith — 18 core modules that never branch on vertical, plus `passenger` and `goods` vertical modules ([ADR-010](docs/decisions/ADR-010-vertical-modules-over-a-shared-core.md)) |
| **Status** | Phase 2 (project foundation) complete — see [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) |

## Quick start

Prerequisites: Node 22, pnpm 9 (`corepack enable`), Docker Desktop.

```bash
cp .env.example .env            # then fill in the (secret) keys — see docs/development.md
pnpm install
pnpm db:up                      # postgres:5433, redis:6379, minio:9000, mailhog:8025
pnpm db:migrate                 # applies prisma/migrations (incl. hand-written constraints)
pnpm db:seed                    # permissions, roles, reference data, settings, dev admin
pnpm dev                        # api on :4000, web on :3001
```

Then open <http://localhost:3001/ar> (web) and <http://localhost:4000/api/v1/docs> (API reference).

## Repository layout

```
apps/api        Express 5 API — src/modules/<module>/{routes,controller,service,policy,repository,mapper}
apps/web        Next.js 15 App Router — src/app/[locale]/…, shadcn/ui, next-intl (ar/en, RTL)
packages/types      Hand-written DTOs, domain enums, transition maps — NO Prisma dependency
packages/validation Zod schemas shared by API validation, OpenAPI generation and web forms
packages/config     Fail-fast environment schema
packages/eslint-config  Boundary rules: no Prisma outside the API, no cross-module repository
                        imports, no transport_type branching in core, no entity spread in mappers
docs/           Requirements, architecture, database, API, security, ADRs, open questions
docker/         Postgres init (extensions, test DB, runtime role)
```

## The rules that are enforced by tooling, not memory

- **Money is a decimal string on the wire**, `NUMERIC(14,2)` in the database, `Prisma.Decimal` in code. `parseFloat` is a lint error.
- **Every repository read takes an `ActorScope`.** Out-of-scope rows are not returned, so the API answers 404, never 403, for records you cannot see.
- **Mappers allow-list fields.** Spreading an entity into a DTO is a lint error; a new column cannot leak into a response by itself.
- **Core modules never branch on `transport_type`.** Vertical behaviour is reached through `VerticalPlugin`; a comparison is a lint error.
- **Nothing business-shaped is hard-coded.** Every value is a setting in [docs/settings-catalogue.md](docs/settings-catalogue.md), validated per key, audited, snapshotted where it affects money.
- **Secrets never live in the repo, in settings, or in logs.** The process refuses to boot on placeholder secrets; the shared `redact()` guards every log and audit line; gitleaks runs in CI.
- **The database guarantees what the code hopes.** Vehicle double-booking is an `EXCLUDE` constraint; audit and ledger rows are append-only by trigger; every CHECK and partial index is asserted by `test/db/migration-integrity.test.ts` after `migrate deploy` on a clean database.

## Commands

| Command | What |
|---|---|
| `pnpm ci` | typecheck · lint · test · build — the same command CI runs |
| `pnpm --filter @unigate/api test:db` | migration-integrity and repository tests (needs `TEST_DATABASE_URL`) |
| `pnpm --filter @unigate/api openapi:generate > apps/api/openapi.json` | regenerate the committed spec (CI diffs it) |
| `pnpm db:reset` | drop, migrate, seed |
| `node scripts/verify-docs.mjs` | every OQ/A/AR/ADR reference and relative link in docs/ resolves |

## Documents

Start with [docs/README.md](docs/README.md). The decisions that shape the code are the ADRs in
[docs/decisions](docs/decisions); the questions still open with UniGate are in
[docs/assumptions.md](docs/assumptions.md).

> No regulatory compliance (ZATCA, PDPL, PCI-DSS, TGA) is claimed by this repository. The design
> is shaped so that compliance is achievable; confirmation is with UniGate's advisers.
