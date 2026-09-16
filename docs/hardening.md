# Phase 14 — Hardening

**Status:** in progress (started 2026-09-16). This page is the working record for Phase 14 as
defined in [security.md §11](security.md) ("verification, tuning and penetration-test
remediation — not retrofitting controls that should have shipped with the feature") and
[TODO.md](TODO.md) (rate-limit review, security-headers audit, load test against the agreed
estimates, dependency audit, backup/restore drill). Each section states what was verified, what
changed, and what is still outstanding and who owns it.

| # | Item | State | Evidence |
|---|---|---|---|
| 1 | Rate-limit review — global tiers | **Done** | `apps/api/src/middleware/rate-limit.ts`; `hardening.flow` (6 tests) |
| 2 | Security-headers audit — API and web | **Done** (CSP report-only on the web until go-live) | `apps/api/src/app.ts`, `apps/web/src/middleware.ts`; `hardening.flow` |
| 3 | CSP violation collector | **Done** | `POST /api/v1/platform/csp-report` |
| 4 | Argon2id re-benchmark | **Tool done**; production run pending | `pnpm --filter @unigate/api bench:argon2` |
| 5 | Load test against OQ-15 estimates | **Script done**; 1-VU smoke green; full run pending on staging | `tools/load/k6-baseline.js` |
| 6 | Backup / restore drill | **Done** (dev, 2026-09-16) | `scripts/db/backup.sh`, `scripts/db/restore.sh` |
| 7 | DB role / grant audit | **Done** | `scripts/db/roles.sql`, `scripts/db/audit-grants.sql` |
| 8 | Dependency audit | **Clean** (`pnpm audit --prod`: 0 findings, 2026-09-16) | root `package.json` overrides; next-intl 4 |
| 9 | CSP enforced (not report-only) | Pending go-live — flip `CSP_ENFORCE=true` after a week of clean reports | — |
| 10 | Threat-model re-walk, DAST (ZAP), third-party penetration test, container scan, external TLS/header check | **Not started** — needs a deployed staging environment (Phase 16 / OQ-12) | security.md §10.5 |

## 1. Rate limiting

security.md §6.8 specified the tiers; before this phase only the login / OTP / password-reset
throttles and the tracking-ping ceiling existed. Now:

| Tier | Key | Limit | Where |
|---|---|---|---|
| Global | IP (hashed) | 600 / 5 min | `ipTier()` before every router |
| Anonymous | IP, requests carrying no credential | 120 / min | `ipTier()` |
| Authenticated reads | user | 300 / min | `userTier()` inside `authenticate()` |
| Authenticated writes | user | 120 / min | `userTier()` |
| Token refresh | session | 60 / h | `auth.service.refresh` |
| Bid submission | user | 60 / h | `routeTier('bid-submission')` on `POST /bids` |
| Report / audit export | user | 5 / h | `routeTier('report-export')` |
| Document upload URL | user | 30 / h | `routeTier('document-upload')` |
| Webhook ingest | provider | 1,000 / min | `providerTier('webhook-ingest')` |
| CSP reports | IP | 30 / min | `routeTier('csp-report')` |
| Login / OTP / password reset / tracking | (unchanged) | security.md §3.3, §3.4, T-30 | services |

Behaviour: every counted response carries `RateLimit-Limit` / `RateLimit-Remaining` (exposed
through CORS); a rejection is `429 RATE_LIMITED` with `Retry-After`. Anonymous tiers run before
authentication and user tiers after it, so dropping a credential does not escape a limit. Redis
outage fails open with a warning (login and OTP keep their durable attempt tables). `/health` and
`/ready` are exempt. Ceilings are environment configuration (`RATE_LIMIT_*` in `.env.example`),
not settings — they are infrastructure protection, not business rules (ADR-009 boundary). Off by
default under `NODE_ENV=test`; `hardening.flow` switches it on with tiny windows.

Not implemented (no such endpoints yet): `/geo/*` proxy tiers (maps provider not procured) and
Socket.IO join limits beyond the existing per-connection authentication.

## 2. Security headers

**API origin** (JSON only) now emits exactly security.md §6.3:
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox`,
`Cache-Control: no-store` on every response, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`,
`Cross-Origin-Opener-Policy: same-origin`, HSTS (`max-age=63072000; includeSubDomains; preload`) in
production only, no `X-Powered-By`. The dev-only docs page relaxes CSP for itself (it loads the
Scalar bundle from jsDelivr); `API_DOCS_ENABLED` is refused in production.

**Web origin**: `apps/web/src/middleware.ts` builds a per-request nonce policy
(`script-src 'self' 'nonce-…' 'strict-dynamic'`, `'unsafe-eval'` in development only for React
refresh) and Next.js tags its own inline scripts with the nonce (verified: 26 tagged scripts on
`/en/login`, zero untagged). `style-src` keeps `'unsafe-inline'` because Radix and Leaflet set
`style` attributes, which a nonce cannot cover. `connect-src` lists the API origin (HTTP and
WebSocket) and the upload origins (`NEXT_PUBLIC_UPLOAD_ORIGINS` — the S3 / MinIO endpoint the
browser PUTs documents to); `img-src` adds the map-tile host. Origins follow the page host the
same way the API client does, so LAN testing does not produce false reports. The header is
`Content-Security-Policy-Report-Only` until `CSP_ENFORCE=true`; violations are posted to the API.

**Go-live checklist for enforcement:** set `NEXT_PUBLIC_UPLOAD_ORIGINS` to the production bucket
origin and `NEXT_PUBLIC_MAP_TILE_URL` to the licensed tile host; run a week in report-only; grep
the API log for `csp violation reported`; then set `CSP_ENFORCE=true`.

## 3. CSP violation collector

`POST /api/v1/platform/csp-report` accepts `application/csp-report` (report-uri format) and
`application/reports+json` (Reporting API), 16 KB cap, public (browsers send no credentials),
30 / min per IP, answers `204`, never echoes the body. Logged fields: effective directive,
blocked host (not the full URL), page path (not the query string), disposition.

## 4. Argon2id benchmark

`pnpm --filter @unigate/api bench:argon2 [-- --sweep]` hashes with the configured
`ARGON2_MEMORY_KIB / TIME_COST / PARALLELISM`, prints mean / p95 per set and a verdict against the
250–350 ms target (security.md §3.1), exits non-zero when out of range, and prints a JSON line for
CI. On the development workstation (32 cores, Node 22) the default set (64 MiB, t=3, p=1) measures
**~104 ms → WEAK** for that machine — expected: production instances are slower, and the target is
defined on the instance type that serves `/auth/login`. **Action (Phase 16):** run the sweep on the
chosen instance type and raise `ARGON2_*` until the mean lands in range; hashes upgrade on the next
successful login (re-hash-on-login is in place), so raising is safe at any time.

## 5. Load test

`tools/load/k6-baseline.js` models 3× the expected signed-in peak against the OQ-15 estimates
(10k users, 2k vehicles, 500 requests/day, 200 tracked trips): a portal loop of session, public
settings, request / booking / notification lists, with 1 in 20 iterations re-authenticating.
Thresholds: `http_req_failed < 1 %`, login p95 < 800 ms, list p95 < 500 ms, overall p95 < 800 ms /
p99 < 1.5 s. Run with `RATE_LIMIT_ENABLED=false` on the target (the per-user tiers are below what
one VU generates) and credentials from the environment only.

Smoke result (1 VU, 20 s, dev workstation through Docker, 2026-09-16): 79/79 checks, failed
rate 0 %, list p95 25 ms, login p95 293 ms, overall p99 297 ms. This proves the script and the
request path, not capacity; the capacity run belongs on staging with `K6_VUS=60`, `K6_DURATION=10m`.
Tracking ingest (20 pings/s across 200 trips) needs driver sessions bound to live trips — a second
script once staging has seeded trips.

## 6. Backup / restore drill

`scripts/db/backup.sh` writes a `pg_dump --format=custom` archive (through the compose container
or any `DATABASE_URL`) with a SHA-256 ledger; `scripts/db/restore.sh <dump> [db]` restores into a
**new** database only (refuses an existing one), then prints the migration count, the append-only
trigger count and the largest tables for comparison.

Drill 2026-09-16 on the dev database: dump 447,557 bytes; restore 3 s; 4 migrations applied;
7 append-only / immutable triggers present on the copy; row counts identical on every compared
table (`users` 15, `documents` 34, `system_settings` 93, `role_permissions` 458,
`audit_logs_2026_09` 177, `bookings` 1). The copy was dropped afterwards. Production backups are
the platform's managed snapshots (Phase 16); this script is the portable logical copy and the
rehearsal path. RPO / RTO targets and the restore rehearsal cadence are recorded when the hosting
decision (OQ-12) lands.

## 7. Database roles

`scripts/db/roles.sql` creates the runtime role `unigate_app` (LOGIN, NOSUPERUSER, NOCREATEDB,
NOCREATEROLE, connection limit, `statement_timeout 30s`, `idle_in_transaction_session_timeout 60s`,
`lock_timeout 10s`), grants row access only, re-applies the append-only revokes (the migration's
revokes are one-shot, and a broad re-grant would silently undo them — the audit caught exactly this
during the drill) and closes `CREATE` on `public`. `scripts/db/audit-grants.sql` prints
PASS / FAIL for: unprivileged runtime role, owns no tables, no UPDATE / DELETE / TRUNCATE on the
append-only tables, triggers enabled, `PUBLIC` cannot create, session guards set, and which role
the connection uses. Dev result: 6 / 6 PASS. Staging / production `DATABASE_URL` must use
`unigate_app`; migrations run as the owner.

## 8. Dependency audit

`pnpm audit --prod` on 2026-09-16 reported 8 advisories (2 high): PostCSS (source-map path
traversal / file read, via Next's pinned 8.4.31), next-intl (open redirect in the locale
middleware; prototype pollution in an experimental option we do not use), `decode-uri-component`
(ReDoS) and `uuid` 7 (buffer bounds) under the Expo toolchain. Resolution: `pnpm.overrides` in the
root `package.json` for PostCSS ≥ 8.5.23, decode-uri-component ≥ 0.5.0 and uuid ≥ 11.1.1; next-intl
upgraded 3.26 → 4.14 (one strict-typing fix; `setRequestLocale` / `requestLocale` remain the Next 15
mechanism — the deprecation points at Next 16 root params and is allow-listed in the web ESLint
config until that upgrade). Result: **0 known vulnerabilities**. Re-run in CI on every PR
(`pnpm audit --prod --audit-level=moderate`).

## 9. Outstanding (needs infrastructure)

| Item | Blocked on |
|---|---|
| Third-party penetration test + remediation + re-test (security.md §10.5) | Deployed staging (Phase 16, OQ-12) |
| DAST (OWASP ZAP baseline) in CI | Staging URL |
| Container image scan (Trivy) in CI | Image build pipeline (Phase 16) |
| External TLS / header verification (ssllabs, securityheaders) | Public hostname |
| Argon2 production benchmark, k6 capacity run, tracking-ingest load script | Staging instance type and seeded trips |
| WAF, private subnets, DDoS, managed backups + restore rehearsal cadence | Hosting decision (OQ-12), G-16 |
| Malware scanning on uploads (`SCAN_PROVIDER=clamav`) | Scanner procurement (A-25) |
