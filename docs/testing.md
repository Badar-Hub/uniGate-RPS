# Testing

**Status:** Phase 15 in progress (started 2026-09-17). This page is the map of what is tested where,
how to run each layer, and what Phase 15 still owes. The phase-exit test items in
[TODO.md](TODO.md) are cross-referenced by test name so a reviewer can find the assertion.

| Layer | Where | Runs in | Count (2026-09-17) |
|---|---|---|---|
| Unit — pure logic | `packages/*/src/**/*.test.ts`, `apps/api/src/**/*.test.ts`, `apps/mobile/src/**/*.test.ts`, `packages/api-client` | `pnpm run ci` (turbo `test`) | types 4 · config 6 · validation 4 · api-client 29 · mobile 89 · api unit 20+ |
| API flows — real PostgreSQL + Redis + MinIO | `apps/api/test/db/*.flow.test.ts` (+ `authorization.matrix`, `migration-integrity`) | `pnpm --filter @unigate/api test` (needs `TEST_DATABASE_URL`) | 20 files · 170+ tests, incl. the 85-row role × resource matrix |
| Golden-path E2E — real browser, both locales | `apps/web/e2e/` (Playwright) | `pnpm --filter @unigate/web e2e` against a running stack | 3 tests × 2 locales; 4 RTL screenshots |
| Load | `tools/load/k6-baseline.js` | manual / staging | see [hardening.md §5](hardening.md) |

## Phase-exit test items (TODO.md) — where each lives

| Item | Test |
|---|---|
| Authorization matrix, cross-tenant → 404 | `authorization.matrix.test.ts` (85 rows, grows per phase) |
| Calendar overlap under concurrent inserts (EXCLUDE) | `fleet.flow` → *calendar: owner blocks, the EXCLUDE guarantee under concurrent inserts, availability, release* |
| N-way concurrent bid acceptance: one 201, rest 409, no orphans | `bidding.flow` → *acceptance: … N-way concurrency; exclusion; idempotent replay* |
| Webhook idempotency: duplicate, out-of-order, invalid signature | `payments.flow` → *webhooks: forged → 401 stored; capture …; duplicate and out-of-order deliveries are harmless* |
| Ledger balance: debits = credits per transaction group | `payments.flow` (SQL over `ledger_entries` grouped by `transaction_group_id`, capture and refund paths); `finance.flow` settlements |
| Snapshot immutability: a rule change never rewrites a booking | `finance.flow` → *commission rules …* (booking awarded at 12 %, rule bumped to 20 %, `/bookings/{id}/financials` unchanged) |
| Golden path E2E in `en` and `ar` with RTL visual diff | `apps/web/e2e/golden-path.spec.ts` (this page, §Golden path) |

## Golden path (E2E)

Customer publishes a passenger request → the seeded vendor is invited by the matcher → vendor
bids → customer accepts → pays through the mock hosted page → booking **CONFIRMED**. The same
journey runs once in English and once in Arabic; the Arabic run pins screenshots of the new-request
form, the opportunity card, the bids table and the confirmed booking (`e2e/__screenshots__/`),
compared with a 4 % pixel tolerance after masking everything that legitimately varies (ids, times,
the run-unique address, table rows, the unread badge).

```bash
# 1. a running stack (docker compose + API + worker + web), with rate limiting off for the target:
#    RATE_LIMIT_ENABLED=false  — one run issues ~150 API calls from one IP; repeated runs trip the
#    600 / 5 min global tier otherwise (that is the limiter working, not the app)
# 2. run — global-setup seeds the deterministic accounts and frees the seeded vehicle's calendar
E2E_BASE_URL=http://localhost:3001 E2E_PASSWORD='<≥12 chars>' pnpm --filter @unigate/web e2e
# refresh the Arabic baselines deliberately after an intended UI change
E2E_PASSWORD='…' pnpm --filter @unigate/web e2e -- --project=ar --update-snapshots
```

Design notes, each learnt from a flake:
- Labels come from `src/messages/{en,ar}.json`, so the test reads the UI like a person and the
  Arabic run needs no separate script. Radix selects are driven by trigger id + `role=option`.
- `E2E_BASE_URL` must be an origin in `CORS_ORIGINS` (`localhost:3001` is; `127.0.0.1` is not).
- The pickup slot is run-unique (6 h apart across 3–88 days): every run's booking holds the seeded
  minibus for a 4 h window and the matcher rightly skips a taken calendar. `global-setup` also runs
  `pnpm --filter @unigate/api e2e:seed`, which releases the seeded vehicle's stale reservations.
- The opportunity **card** is snapshotted, not the page: on a shared database the list grows.
- The mock hosted page lives on `APP_URL` (a different origin in dev); the test waits for
  hydration before clicking the outcome.

`apps/api/src/cli/e2e-seed.ts` (refused in production) creates `e2e.customer@unigate.local`,
`e2e.vendor@unigate.local` (APPROVED, passenger vertical, serves Riyadh) and minibus `9001 E2E`
with verified documents until 2032, idempotently; the password is `E2E_PASSWORD` and is re-applied
on every run.

## Found by Phase 15 so far

- **Login throttle counted successes** (`auth.service.login`): the per-IP failure counter was hit
  on every attempt and never reset, so 20 sign-ins from one IP in 15 minutes locked the IP —
  success or not. On an office NAT that is a whole company. Counters now count failures only
  (`auth.flow` → *login throttles count failures only*).
- E2E from a single IP trips the Phase 14 global tier by design — documented above.

## Still open in Phase 15

| Item | Note |
|---|---|
| Accessibility pass (axe) on the golden-path screens, both locales | Radix selects need a native `<select>` fallback for keyboard/AT review (noted in Phase 6) |
| Mobile E2E (Maestro or Detox) on a development build | Expo Go cannot exercise push, background location or the map |
| CI wiring: Playwright job with a fresh compose stack, `RATE_LIMIT_ENABLED=false`, artefacts on failure | Phase 16 pipeline |
| Critical/high defects closed | tracked in the UAT checklist as testers report them |
