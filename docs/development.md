# UniGate — Local development

Verified from a clean Windows 11 machine on 2026-09-15 (Node 22.23, pnpm 9.15, Docker Desktop 29).
Linux/macOS is the same minus the port notes.

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 LTS | `node -v` |
| pnpm | 9.15.x | `corepack enable && corepack prepare pnpm@9.15.4 --activate` |
| Docker Desktop | any current | Must be **running** before `pnpm db:up` |
| Git | any | `.gitattributes` normalises to LF; do not override `core.autocrlf` per-file |

## 2. Environment

```bash
cp .env.example .env
```

Fill in every key marked **(secret)**. Generate real random values — the process refuses to boot
on anything that looks like a placeholder (`changeme`, `secret`, `test`, …):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY (exactly 32 bytes)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" # JWT_SECRET, JWT_REFRESH_SECRET, BLIND_INDEX_PEPPER, OTP_PEPPER
```

`JWT_SECRET` ≠ `JWT_REFRESH_SECRET` and `BLIND_INDEX_PEPPER` ≠ `OTP_PEPPER` are enforced.
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (≥ 12 chars) are required for `pnpm db:seed` outside
production — there is no default password anywhere in the repository.

Prisma's CLI reads `apps/api/.env`; copy just the two database lines there:

```bash
grep -E '^(DATABASE_URL|TEST_DATABASE_URL)=' .env > apps/api/.env
```

**Ports.** UniGate's Postgres is published on **5433** (not 5432) and the web app on **3001**
(not 3000) so it coexists with other projects on the same machine. Override with
`UNIGATE_POSTGRES_PORT` / `UNIGATE_REDIS_PORT` / `UNIGATE_MINIO_PORT` in your shell before
`docker compose up` if those are taken too, and update `.env` to match.

## 3. Bring up the stack

```bash
pnpm install
pnpm db:up          # postgres (+ extensions + unigate_test db), redis, minio (+ buckets), mailhog
pnpm db:migrate     # prisma migrate deploy — two migrations: generated init + hand-written constraints
pnpm db:seed        # idempotent; safe to re-run
pnpm dev            # turbo: api :4000 (tsx watch), web :3001 (next dev)
```

| URL | What |
|---|---|
| http://localhost:3001/ar · /en | Web app |
| http://localhost:4000/api/v1/health · /ready | Liveness / readiness (booleans only) |
| http://localhost:4000/api/v1/docs | API reference (Scalar), non-production only |
| http://localhost:4000/api/v1/settings/public | PUBLIC-scoped settings, unauthenticated |
| http://localhost:8025 | MailHog inbox |
| http://localhost:9001 | MinIO console (`unigate` / `unigate-minio`) |

## 4. Verify

```bash
pnpm ci                                        # typecheck · lint · test · build
pnpm --filter @unigate/api test:db             # migration integrity + auth lifecycle + authorization matrix against unigate_test
node scripts/verify-docs.mjs                   # docs cross-references
```

`pnpm ci` is exactly what GitHub Actions runs. If it is green locally, CI is green.
The database suites **reset and re-seed `unigate_test`** on every run and need the full API
environment (turbo passes it through — see `tasks.test.env` in `turbo.json`). The profiles &
documents suite also needs **MinIO** running (`pnpm db:up` starts it; CI starts it as a step).

The API entrypoints (`main.ts`, `worker.ts`, the admin CLI) load the root `.env` themselves in
development and test (`src/config/dotenv.ts`, never overriding the shell), so `pnpm dev` works
without exporting anything. Production and staging read only the platform environment.

## 4a. Signing in locally

- The seeded dev admin is `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` with role `SUPER_ADMIN`.
- OTP codes are printed to the API console (`OTP_PROVIDER=console`), masked destination + code. The
  console provider refuses to start in production.
- Mobile-style login returns tokens in the body; web-style (`clientType: "WEB"`) sets the `ug_at`
  / `ug_rt` cookies and mutations then need `X-Requested-With: unigate-web` plus an allow-listed
  `Origin`.

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"identifier":"admin@unigate.local","password":"<SEED_ADMIN_PASSWORD>","clientType":"IOS"}'
```

Sensitive admin actions (role changes, settings) answer `403 PERM_DENIED` with
`details.stepUpRequired = true`; call `POST /auth/step-up` → `/auth/step-up/verify` and resend
with `X-Step-Up-Token`. Full flow in [api.md §8](api.md).

### First administrator outside development

Production seeds create **no accounts**. Create the first `SUPER_ADMIN` once, from a shell with
the target `DATABASE_URL`:

```bash
ADMIN_EMAIL=ops@example.com ADMIN_PASSWORD='<12+ chars>' pnpm --filter @unigate/api admin:create
```

The password is read from the environment only (never argv), must meet the staff policy, and the
command refuses to add a second `SUPER_ADMIN` unless `ADMIN_ALLOW_ADDITIONAL=true`.

## 4b. Paying locally (MockGateway)

`PAYMENT_PROVIDER=mock` (the default) selects the development gateway — a full implementation of the `PaymentGateway` port, not a stub (ADR-005). There is no real provider integration; the adapter is added once UniGate names the gateway (OQ-03), and production refuses to boot with the mock selected.

1. On a `PENDING_PAYMENT` booking click **Pay now** → `POST /payments` creates the intent and redirects to the mock's hosted page at `/{locale}/pay/mock/{providerPaymentId}`.
2. Choose **Simulate successful payment** or **Simulate declined card**. The page calls `POST /payments/mock/checkout/{providerPaymentId}` (dev-only, 404 in production), which makes the gateway deliver its HMAC-signed webhook to the API's real `/webhooks/payments/mock` route — signature verification, persist-first and processing all run exactly as they would for a real provider.
3. The browser returns to the booking with `?payment=…` and polls `GET /payments/{id}/status`. Nothing the browser does marks a payment paid.

To exercise reconciliation instead of webhooks, post to the checkout endpoint with `{ "outcome": "SUCCESS", "deliverWebhook": false }` and then `POST /payments/{id}/sync` as staff. The webhook secret for the mock is `PAYMENT_WEBHOOK_SECRET` when set, otherwise derived from `OTP_PEPPER` so a fresh `.env` works without configuration.

## 4c. Invoicing locally (mock clearance provider)

`EINVOICING_PROVIDER=mock` (the default outside production) selects the development stand-in for the clearance authority behind the `EInvoicingProvider` port (ADR-007). It accepts every well-formed document, so a standard tax invoice goes DRAFT → PENDING_CLEARANCE → ISSUED within the request, and a simplified one is ISSUED and REPORTED. `EINVOICING_PROVIDER=none` issues plain invoices with `clearanceStatus = NOT_REQUIRED` — no chain, no authority, nothing claimed. Production refuses `mock`. **No compliance is claimed either way** (OQ-04).

1. Set `finance.seller_vat_number` (and the seller names) through the settings API — with it empty every issue answers `422 INVOICE_SELLER_VAT_NOT_CONFIGURED`.
2. Issue a single invoice with `POST /invoices { bookingId }` for a COMPLETED booking, or run a cycle with `POST /admin/invoices/generate { periodStart, periodEnd }`; the portal's **Invoices** page does both for a finance officer.
3. To exercise failure paths from a test, script the mock per invoice number: `mockClearanceProvider()?.script('INV-2026-000007', 'REJECT' | 'UNAVAILABLE' | null)` — REJECT rests the invoice in CLEARANCE_FAILED (void + re-issue), UNAVAILABLE leaves it PENDING_CLEARANCE and the request answers 503; `POST /admin/invoices/{id}/retry-clearance` re-presents the same document.
4. A buyer pays an ISSUED / PARTIALLY_PAID / OVERDUE invoice from its page through the same MockGateway checkout as bookings (§4b) with `POST /payments { invoiceId, amount }`.

## 5. Database workflow

Prisma owns structure it can express; a hand-written migration owns the rest
([database.md §1](database.md)). When you change the schema:

```bash
cd apps/api
pnpm exec prisma format
pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$TEST_DATABASE_URL" --script > prisma/migrations/$(date +%Y%m%d%H%M%S)_<name>/migration.sql
# review the SQL; add CHECKs / partial indexes / EXCLUDE to it BY HAND if the change needs them
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

Rules:

- **Never** `prisma migrate dev` against a shared database; it is interactive and can drop data.
- Anything you add by hand (a CHECK, a partial unique index, a trigger) goes into
  `test/db/migration-integrity.test.ts` in the same commit.
- Enums: add the value to `packages/types/src/domain/enums.ts` **and** `schema.prisma`; the
  integrity test fails if they differ.
- Migration SQL is a mandatory security-review path ([security.md §10.3](security.md)).

`pnpm db:reset` drops, re-migrates and re-seeds the dev database.

## 6. Adding a module (the layering rules are lint-enforced)

```
src/modules/<name>/
  <name>.routes.ts       path → middleware → controller. No logic. Router({ strict: true }).
  <name>.controller.ts   parse → service → DTO → envelope. No Prisma, no `if` on business state.
  <name>.service.ts      rules, transactions, events, audit. The only place rules live.
  <name>.policy.ts       pure can-this-actor-do-this predicates.
  <name>.repository.ts   Prisma. Every exported function's FIRST parameter is ActorScope | AnyScope.
  <name>.mapper.ts       entity → DTO by explicit allow-list. No spread.
  <name>.openapi.ts      registry.registerPath(...) for each route, imported from src/docs/all.ts.
```

Cross-module reads go through the other module's **service**. Core modules never import
`modules/passenger` or `modules/goods` and never compare `transportType` — both are lint errors.

## 7. Settings, not constants

Any number, window, rate or toggle a reasonable operator might change is a key in
`src/modules/reference/settings.registry.ts` **and** a row in
[settings-catalogue.md](settings-catalogue.md). The integrity test fails if the two disagree. Read
settings through the settings service at the moment of use, and **snapshot** the value onto the
record it produces when it affects money or a commitment ([ADR-009](decisions/ADR-009-configuration-over-constants.md)).

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `[config] Environment validation failed for: X` | Missing or placeholder value in `.env`. Key names only are printed, by design. |
| `Bind for 0.0.0.0:5433 failed` | Another Postgres on that port — set `UNIGATE_POSTGRES_PORT` and update `DATABASE_URL`. |
| `/ready` reports `redis: false` | Redis container down, or `REDIS_URL` points at another project's instance. |
| `next build` fails prerendering `/404` | `NODE_ENV=development` leaked into the build shell. The build script pins `NODE_ENV=production`; don't override it. |
| `prisma migrate deploy` fails on `unigate_app` grants | The role is created by `docker/postgres-init/01-init.sql`; the grant block is skipped if it does not exist. |
| Test says "in registry but not in catalogue" | You added a setting to code without the catalogue row (or vice versa). Fix the docs. |
