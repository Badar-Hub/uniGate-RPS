# UniGate — API Contract (v1)

**Status:** Phase 1 (Architecture) — contract frozen for implementation; open questions tracked in [assumptions.md](assumptions.md)
**Phase:** 1 — Architecture & Design
**Base URL:** `https://{host}/api/v1`
**OpenAPI version:** 3.1.0 (generated, served at `/api/v1/docs`)
**Last updated:** 2026-09-14

Companion documents: [architecture.md](architecture.md) · [database.md](database.md) · [security.md](security.md) · [assumptions.md](assumptions.md) · [requirements-analysis.md](requirements-analysis.md)

---

## 1. Principles

| # | Principle | Consequence |
|---|---|---|
| P1 | **Versioned REST.** Every route lives under `/api/v1`. The version is in the path, not a header or a query parameter. | A client pins a version by pinning a URL prefix. Proxies, logs and CDN rules can route on it without parsing headers. |
| P2 | **Resource-oriented.** Paths name nouns; HTTP methods name the operation. State transitions that are not plain field updates become **sub-resources** (`POST /bids/{id}/accept`, `POST /trips/{id}/status`). | `PATCH /bookings/{id}` with `{"status":"CANCELLED"}` is not accepted. A cancellation carries a reason, computes a fee, releases a calendar entry and may trigger a refund — that is an operation, not a field write. |
| P3 | **Thin controllers.** A controller parses, delegates to a service, and maps the result to a DTO. No business rules, no Prisma access, no `if (role === ...)`. | Controllers are ~15 lines. All rules live in `<module>.service.ts`; all queries in `<module>.repository.ts`; all authorization predicates in `<module>.policy.ts`. |
| P4 | **Zod-validated at the edge.** Every request — params, query, body, and the headers the route depends on — is parsed by a Zod schema in `packages/validation` before the controller body runs. Parsing produces the typed value used downstream; the raw `req.body` is never read after validation. | Unknown keys are stripped (`.strict()` on write bodies so a typo is an error, not a silent no-op). A handler cannot receive an unvalidated shape. |
| P5 | **OpenAPI 3.1 is generated from the same Zod schemas** via `@asteasolutions/zod-to-openapi`. The spec is not hand-written and is not a separate artefact. | The spec cannot drift from validation, because there is only one definition. A schema change that is not reflected in the spec is impossible; a spec change that is not enforced at runtime is impossible. CI fails if the committed `openapi.json` differs from the generated one. |
| P6 | **Same API for web and mobile.** No Next.js-specific endpoints, no Server Action back doors, no endpoints that assume a cookie jar. Every capability is reachable with a `Authorization: Bearer` header. | BRIEF-§37: the future React Native app consumes this identical surface. The web app's Server Components call the same `/api/v1` routes server-to-server. |
| P7 | **DTOs, never entities.** Responses are built by `<module>.mapper.ts` from domain objects. Prisma models are never serialised directly. | BRIEF-§28. A new column does not silently appear in an API response; a private column cannot leak through a join. |
| P8 | **Authorization is never the client's job.** The API assumes every client is hostile. Hiding a button is a UX nicety; the permission check and the repository scope predicate are the control. | BRIEF-§49. |
| P9 | **The response envelope is uniform.** Every response — success, validation failure, 500 — has the same top-level shape. | Clients write one response interceptor. |
| P10 | **Deterministic and idempotent where money moves.** Every state- or money-moving `POST`/`PATCH` accepts (and mostly requires) an `Idempotency-Key`. | A mobile client on a flaky 4G connection cannot double-book or double-pay by retrying. |

### 1.1 Documentation endpoint

| Path | Behaviour |
|---|---|
| `GET /api/v1/docs` | Scalar/Swagger UI. **Non-production only.** In production the route is either disabled (`API_DOCS_ENABLED=false`, the default) or mounted behind session auth + `system.health.read`. |
| `GET /api/v1/docs/openapi.json` | The generated OpenAPI 3.1 document. Same gating. |

### 1.2 Request conventions

| Concern | Convention |
|---|---|
| Content type | `application/json; charset=utf-8` for all request and response bodies. File bytes never transit the API — see [§8.10 Documents](#810-documents). |
| Correlation | Client may send `X-Request-Id` (UUID). If absent the API generates one. It is echoed in the `X-Request-Id` response header, included in every log line, and returned as `error.requestId` on failures. |
| Locale | `Accept-Language: ar` or `en`. Affects reference-data labels (`nameAr`/`nameEn` are both returned; the header only selects the *preferred* ordering and server-rendered notification text). It never affects `error.code`. |
| Timezone | The API never formats dates. All timestamps out are ISO-8601 UTC. `Asia/Riyadh` rendering is a client concern (BRIEF-§46). |
| Casing | JSON is `camelCase` on the wire; the database is `snake_case`. Mapping happens in the mapper layer, explicitly — no automatic key transformation middleware, which would also rewrite opaque values like storage keys. |
| Method override | Not supported. No `_method` query parameter, no `X-HTTP-Method-Override`. |
| Trailing slashes | Rejected with 404. `/api/v1/bookings/` is not `/api/v1/bookings`. |

---

## 2. Response envelope

### 2.1 Success

```json
{
  "success": true,
  "data": { },
  "message": null,
  "meta": { }
}
```

- `data` — the resource, or an array of resources for a collection. Never `null` on success; an empty collection is `[]`.
- `message` — `null` on success in almost all cases. It exists so that a small number of operations can return a developer-facing note (e.g. `"Settlement created with 0 lines; no eligible bookings in period"`). **It is not a display string.**
- `meta` — pagination, rate-limit echo, computation notes. `{}` when there is nothing to say.

A single resource:

```json
{
  "success": true,
  "data": {
    "id": "0192f3c1-7a4e-7b2d-9f10-5c3ab9e42d77",
    "bookingNumber": "BK-2026-000123",
    "status": "CONFIRMED",
    "paymentStatus": "PAID",
    "totalAmount": "1437.50",
    "vatAmount": "187.50",
    "currency": "SAR",
    "scheduledStartAt": "2026-09-20T05:30:00.000Z",
    "createdAt": "2026-09-14T11:02:44.817Z"
  },
  "message": null,
  "meta": {}
}
```

A collection:

```json
{
  "success": true,
  "data": [ { "id": "0192f3c1-…", "bookingNumber": "BK-2026-000123" } ],
  "message": null,
  "meta": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 137,
    "totalPages": 7,
    "hasNext": true,
    "hasPrevious": false
  }
}
```

### 2.2 Error

```json
{
  "success": false,
  "data": null,
  "message": "Bid 0192f3c1-7a4e-7b2d-9f10-5c3ab9e42d77 has already been decided (status=REJECTED)",
  "error": {
    "code": "BID_ALREADY_DECIDED",
    "details": { "bidId": "0192f3c1-7a4e-7b2d-9f10-5c3ab9e42d77", "currentStatus": "REJECTED" },
    "requestId": "0192f3c2-1b88-70a4-8e55-9d2c7f41aa03"
  }
}
```

Validation failures put the field map in `details`:

```json
{
  "success": false,
  "data": null,
  "message": "Request body failed validation",
  "error": {
    "code": "VALIDATION_FAILED",
    "details": {
      "fieldErrors": {
        "pickupAt": ["must be in the future"],
        "passengerDetails.passengerCount": ["must be >= 1"],
        "baseAmount": ["must be a decimal string with at most 2 fraction digits"]
      },
      "formErrors": []
    },
    "requestId": "0192f3c2-1b88-70a4-8e55-9d2c7f41aa03"
  }
}
```

`error.details` is **absent**, not `null`, when there is nothing structured to add. `error.requestId` is always present.

### 2.3 Scalar type rules — binding on every endpoint

| Type | Wire representation | Example |
|---|---|---|
| **Money** | **JSON string**, fixed 2 fraction digits, no thousands separators, no currency symbol, `-` prefix for negatives. Always accompanied by a sibling `currency` (ISO-4217, uppercase). | `{"totalAmount": "1437.50", "currency": "SAR"}` |
| **Rate / percentage** | JSON string, 4 fraction digits, expressed as a fraction not a percentage. | `{"vatRate": "0.1500", "commissionRate": "0.1250"}` |
| **Timestamp** | ISO-8601 with milliseconds and a literal `Z`. UTC always. | `"2026-09-14T11:02:44.817Z"` |
| **Date** (no time component) | `YYYY-MM-DD`. Used only for `issueDate`, `expiryDate`, `dateOfBirth`, `expenseDate`. | `"2027-04-30"` |
| **ID** | UUID v7 as a lowercase canonical string. Never an integer, never exposed as a sequence position. | `"0192f3c1-7a4e-7b2d-9f10-5c3ab9e42d77"` |
| **Human-readable reference** | Separate field, never the ID. | `"bookingNumber": "BK-2026-000123"` |
| **Enum** | `SCREAMING_SNAKE_CASE` string, matching the PostgreSQL enum value in [database.md](database.md) exactly. | `"status": "PENDING_PAYMENT"` |
| **Coordinates** | JSON numbers (`latitude`, `longitude`), 7 decimal places. Not money; float error at the 7th decimal is ~1 cm and irrelevant. | `{"latitude": 24.7135517, "longitude": 46.6752957}` |
| **Duration** | Integer minutes, field name ends `Minutes`. Never a formatted string. | `"estimatedDurationMinutes": 215` |
| **Distance** | Decimal string in km, field name ends `Km`. | `"estimatedDistanceKm": "412.60"` |
| **Absent vs null** | A field that does not apply is **omitted**. A field that applies but has no value is `null`. Clients must treat both as "no value" but the API is consistent about which it emits. | |

#### Why money is a string

JSON numbers are IEEE-754 binary64 doubles in every mainstream parser, including `JSON.parse`. Binary64 cannot represent most two-decimal values exactly: `1250.10` is stored as `1250.09999999999990905052982270717620849609375`. The error is invisible in a single value and lethal in aggregate:

- `0.1 + 0.2 === 0.30000000000000004` — a client summing 3,000 settlement lines accumulates a visible drift.
- A round trip through a JavaScript client (`parse` → hold in state → `stringify` → `PATCH` back) can return a *different* value than the one sent, silently rewriting a financial record.
- `Number.MAX_SAFE_INTEGER` caps exact integer representation at 2^53−1; storing halalas as integers postpones the problem but forfeits readability and still breaks on multiplication by a rate.

The database stores `NUMERIC(14,2)` (D2 in [database.md](database.md)); Prisma surfaces it as `Prisma.Decimal`; the mapper calls `.toFixed(2)`. Clients parse with `decimal.js` / `BigNumber` or — as the UniGate web app does — never arithmetic on it at all, passing the string straight to `Intl.NumberFormat`. **The API never accepts a JSON number in a money field; `1437.5` is a `VALIDATION_FAILED` with `"must be a decimal string"`.**

The same reasoning applies to `vatRate` and `commissionRate`: a rate multiplied by a gross amount determines a commission, and the multiplication must happen in decimal arithmetic on both sides.

### 2.4 `meta` keys

| Key | Where | Meaning |
|---|---|---|
| `page`, `pageSize`, `totalItems`, `totalPages`, `hasNext`, `hasPrevious` | Offset-paginated collections | §5.1 |
| `nextCursor`, `hasNext` | Cursor-paginated collections | §5.2 |
| `idempotentReplay: true` | Any idempotent POST | This response was replayed from `idempotency_keys`, not recomputed. §7 |
| `computedAt` | Report and dashboard responses | When the underlying aggregate was computed (may be cached). |
| `partial: true` + `degraded: [...]` | Dashboard / tracking | An optional upstream (maps ETA, gateway status) was unavailable; the rest of the payload is valid. |

---

## 3. HTTP status code policy

### 3.1 Error class → status

The error classes are those named in BRIEF-§44 and fixed in the canonical decisions.

| Error class | Status | Emitted when | Canonical code family |
|---|---|---|---|
| `ValidationError` | **422** | The request was syntactically valid JSON but failed schema or semantic validation. | `VALIDATION_*` |
| `UnauthorizedError` | **401** | No credential, expired credential, invalid credential, or a credential that has been revoked. | `AUTH_*` |
| `ForbiddenError` | **403** | Authenticated, identity known, and the actor lacks the permission for an action on a resource **whose existence the actor is already entitled to know**. | `PERM_DENIED`, `AUTH_ACCOUNT_SUSPENDED`, `AUTH_STEP_UP_REQUIRED` |
| `NotFoundError` | **404** | The resource does not exist, **or** the actor's scope cannot see it. | `NOT_FOUND`, `*_NOT_FOUND` |
| `ConflictError` | **409** | The request is valid and the actor is permitted, but it conflicts with the *current persisted state* — a uniqueness collision, a concurrent writer, an already-consumed transition. | `CONFLICT_*`, `*_ALREADY_*`, `*_UNAVAILABLE` (a *resource* is unavailable, e.g. `BID_VEHICLE_UNAVAILABLE`; a *dependency* being unavailable is 503), `IDEMPOTENCY_KEY_REUSED` |
| `BusinessRuleError` | **422** | The request is valid and non-conflicting but violates a domain rule. | `RULE_*`, `*_INVALID_TRANSITION`, `*_NOT_ELIGIBLE` |
| `RateLimitError` | **429** | A rate-limit bucket is exhausted. | `RATE_LIMITED`, `AUTH_OTP_THROTTLED` |
| `AppError` | **500** | Unhandled or explicitly-internal failure. | `INTERNAL_ERROR` |
| *(gateway/adapter)* | **502** | A named upstream (payment gateway, maps provider) returned an error or an unparseable response. | `PAYMENT_GATEWAY_ERROR`, `GEO_PROVIDER_ERROR` |
| *(readiness)* | **503** | The process is up but a hard dependency (Postgres, Redis, the clearance provider) is down. Returned by `/ready`, by request handlers during shutdown drain, and by the issue path when clearance cannot be reached. Always carries `Retry-After`. | `SERVICE_UNAVAILABLE`, `CLEARANCE_PROVIDER_UNAVAILABLE` |
| *(timeout)* | **504** | An upstream exceeded its configured deadline. | `UPSTREAM_TIMEOUT` |

Success codes:

| Status | Used for |
|---|---|
| **200** | `GET`, `PATCH`, `PUT`, and `POST` transitions that return the mutated resource. |
| **201** | `POST` that creates a new addressable resource. `Location` header set to its canonical URL. |
| **202** | `POST` that enqueues asynchronous work and returns a job handle — `POST /reports/{code}/export`, `POST /refunds/{id}/process`, `POST /settlements/{id}/pay`. |
| **204** | `DELETE` that succeeded and has nothing to return. Body is empty — **not** an envelope. This is the single exception to §2. |

`304 Not Modified` is used only on `GET /reference/*` and `GET /vehicle-categories`, which send `ETag`.

### 3.2 The anti-enumeration rule (binding)

> **When an actor requests a specific record that exists but falls outside their scope, the API returns `404 NOT_FOUND`, never `403 PERM_DENIED`.**

A 403 on `GET /bookings/{id}` tells the caller that `{id}` is a real booking. Iterating IDs would then map the platform's entire booking population, its density over time, and — through timing — which IDs belong to which tenant. UUID v7 makes this worse, not better, because v7 is time-ordered: an attacker who holds one valid ID can generate plausible neighbours.

Applied precisely:

| Situation | Status | Code |
|---|---|---|
| Actor holds **no** relevant permission at all (e.g. a customer calling `POST /vehicles/{id}/approve`) | 403 | `PERM_DENIED` |
| Actor holds the permission but the record is outside their scope (owner A reading owner B's booking) | **404** | `NOT_FOUND` |
| Actor holds the permission, record is in scope, but the *operation* is not allowed for their role on that record (customer cancelling a booking already `IN_PROGRESS`) | 422 | `BOOKING_INVALID_TRANSITION` |
| Record genuinely does not exist | 404 | `NOT_FOUND` |
| Actor is a party to the record but the sub-resource is private to the counterparty (customer requesting an owner's `nationalId`) | The field is **omitted from the DTO**. There is no endpoint that returns it. |

The rule is implemented once: the repository scope predicate (§6.5) is applied in the `WHERE` clause, so an out-of-scope row simply is not returned and the service's `assertFound()` raises `NotFoundError`. There is no code path that fetches a row and *then* decides to refuse it — which is what makes the rule impossible to forget on a new endpoint.

**Consequence for list endpoints:** a scoped list never 403s. It returns `200` with `data: []`. An empty list and a forbidden list are indistinguishable by design.

### 3.3 409 versus 422 — the discriminator

Both mean "I understood you and you may do this kind of thing, but not now." They differ in **what would have to change** for the request to succeed.

| | 409 Conflict | 422 Unprocessable Entity |
|---|---|---|
| Cause | Current *persisted state* collides with the request | The request itself violates a *domain rule* |
| Fix | Someone else's action, or re-reading and retrying | Changing the request |
| Retry-safe? | Retrying the identical request may succeed later | Retrying the identical request will never succeed |
| Concurrency | Usually raised by a database constraint under race | Usually raised by a service assertion before any write |

| Example | Status | Code | Why |
|---|---|---|---|
| Two customers accept bids on the same vehicle for overlapping windows | 409 | `BID_VEHICLE_UNAVAILABLE` | The `EXCLUDE` constraint on `vehicle_calendar_entries` rejected the loser. The window is a fact about the world, not about the request. |
| A bid is accepted that was already rejected | 409 | `BID_ALREADY_DECIDED` | State has moved on. |
| A bid is accepted after `valid_until` | **422** | `BID_EXPIRED` | No retry of this request can work; the customer must ask for a new bid. |
| Plate number already registered to a live vehicle | 409 | `VEHICLE_PLATE_TAKEN` | Uniqueness collision. |
| `passengerCount = 0` | 422 | `VALIDATION_FAILED` | Malformed intent. |
| Booking cancelled twice | 409 | `BOOKING_ALREADY_CANCELLED` | Idempotency-adjacent state collision. |
| Cancelling an `IN_PROGRESS` booking | 422 | `BOOKING_INVALID_TRANSITION` | The transition map forbids it, permanently, for this pair of states. |
| Refund request exceeding captured amount | 422 | `REFUND_EXCEEDS_CAPTURED` | Arithmetic rule on the request. |
| Second refund submitted while the first is `PROCESSING` | 409 | `REFUND_ALREADY_PROCESSED` | State collision. |
| Same `Idempotency-Key`, different body | 409 | `IDEMPOTENCY_KEY_REUSED` | The key is already bound to a different request. |
| Settling a booking already on a settlement line | 409 | `SETTLEMENT_BOOKING_ALREADY_SETTLED` | Partial unique index collision. |

**400 Bad Request** is reserved for requests the API cannot even begin to interpret: malformed JSON, an unparseable `Content-Type`, a missing required header that gates parsing (`IDEMPOTENCY_KEY_REQUIRED`). Everything that parses but fails a rule is 422.

---

## 4. Error catalogue

`error.code` is a stable, machine-readable identifier. It is part of the API contract and **only changes in a new major version**. `error.message` is English developer prose for logs and for the `/docs` UI — it is deliberately verbose and may change at any time.

> **Clients MUST NOT display `error.message`.** The web and mobile clients render a message by looking up `error.code` in `messages/en.json` / `messages/ar.json` and interpolating `error.details`. A raw English server string rendered into an Arabic RTL interface is both a defect and a leak of internal identifiers. `error.requestId` may be shown to the user as a support reference; that is the only server-supplied string a client is permitted to print.
>
> Every code in this catalogue must have a key in both locale files. A CI check fails the build if a code exists in source but not in `messages/ar.json`.

### 4.1 Authentication — `AUTH_*`

| Code | HTTP | Meaning | Typical cause |
|---|---|---|---|
| `AUTH_TOKEN_MISSING` | 401 | No credential presented | Cookie not sent (cross-site), missing `Authorization` header |
| `AUTH_TOKEN_INVALID` | 401 | Signature, issuer, audience or `typ` claim mismatch | Tampered token; access token sent to the refresh endpoint |
| `AUTH_TOKEN_EXPIRED` | 401 | Access token past `exp` | Normal after 15 min — the client silently calls `/auth/refresh` |
| `AUTH_INVALID_CREDENTIALS` | 401 | Identifier/password pair rejected | Wrong password, or unknown identifier (**same code either way** — see §4.6) |
| `AUTH_REFRESH_EXPIRED` | 401 | Refresh token past `exp` (30 d) | Dormant device |
| `AUTH_REFRESH_REUSE_DETECTED` | 401 | A refresh token with `used_at` set was presented again | Token theft/replay, or a client bug replaying a rotation. **Entire token family and parent session are revoked.** |
| `AUTH_SESSION_REVOKED` | 401 | `sessions.revoked_at` is set | Logout-all, admin revocation, password change, reuse detection |
| `AUTH_PASSWORD_CHANGED` | 401 | Token issued before `users.password_changed_at` | Password was changed on another device |
| `AUTH_ACCOUNT_SUSPENDED` | 403 | `users.status = SUSPENDED` or `DEACTIVATED` | Admin suspension |
| `AUTH_ACCOUNT_LOCKED` | 403 | Progressive lockout from `login_attempts` | Repeated failures from an IP/identifier pair |
| `AUTH_PHONE_NOT_VERIFIED` | 403 | Endpoint requires a verified phone | Customer attempting `POST /trip-requests` before OTP verification |
| `AUTH_EMAIL_NOT_VERIFIED` | 403 | Endpoint requires a verified email | Corporate customer invoicing flows |
| `AUTH_IDENTIFIER_TAKEN` | 409 | Email or phone already belongs to a live account | Registration collision |
| `AUTH_OTP_INVALID` | 422 | Code did not match | Typo; constant-time comparison, `attempt_count` incremented |
| `AUTH_OTP_EXPIRED` | 422 | Past `otp_requests.expires_at` | Code older than 5 min (A-03) |
| `AUTH_OTP_MAX_ATTEMPTS` | 429 | `attempt_count >= max_attempts` (5) | Brute force; the request row is consumed and a new one must be issued |
| `AUTH_OTP_THROTTLED` | 429 | Redis throttle on destination/IP/global | Too many sends — see §11.3 |
| `AUTH_STEP_UP_REQUIRED` | 403 | Sensitive action needs fresh OTP re-authentication | Changing a payout IBAN, adding a bank account |
| `AUTH_CSRF_HEADER_MISSING` | 403 | Cookie-mode request without `X-Requested-With: unigate-web` | Cross-site forgery attempt, or a misconfigured client |
| `AUTH_PASSWORD_POLICY` | 422 | New password fails policy | Too short, breached-list hit |
| `AUTH_PASSWORD_RESET_INVALID` | 422 | Reset token unknown, expired or consumed | Stale email link |

### 4.2 Authorization — `PERM_*`

| Code | HTTP | Meaning | Typical cause |
|---|---|---|---|
| `PERM_DENIED` | 403 | Actor's resolved permission set lacks the required code | Customer calling an admin route |
| `PERM_SCOPE_VIOLATION` | **404** | Permission held, record outside `ActorScope`. **Surfaced to the client as `NOT_FOUND`**; this code exists only in logs and audit entries. | Owner A reading owner B's booking |
| `PERM_ROLE_IMMUTABLE` | 409 | Attempt to edit or delete a `roles.is_system` row | Editing `SUPER_ADMIN` |
| `PERM_SELF_MODIFICATION` | 422 | Actor attempting to change their own roles, or suspend themselves | Admin lockout protection |

### 4.3 Validation & platform

| Code | HTTP | Meaning | Typical cause |
|---|---|---|---|
| `VALIDATION_FAILED` | 422 | Zod parse failure; `details.fieldErrors` carries the map | Any malformed body/query |
| `VALIDATION_UNSUPPORTED_SORT` | 422 | `sortBy` not in the resource's allow-list; `details.allowed` lists valid values | Client typo or probing |
| `VALIDATION_UNSUPPORTED_FILTER` | 422 | Unknown filter key on a `.strict()` query schema | Client typo |
| `VALIDATION_PAGE_SIZE_EXCEEDED` | 422 | `pageSize > 100` | Client attempting a bulk pull; use an export job |
| `VALIDATION_INVALID_DATE_RANGE` | 422 | `dateFrom > dateTo`, or range exceeds the endpoint's maximum | Report over 2 years |
| `MALFORMED_JSON` | 400 | Body is not parseable JSON | Truncated request |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | `Content-Type` is not `application/json` | Form post to a JSON route |
| `NOT_FOUND` | 404 | Resource absent or out of scope | See §3.2 |
| `METHOD_NOT_ALLOWED` | 405 | Path exists, method does not | |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 1 MB (256 KB on `/tracking/*`) | |
| `RATE_LIMITED` | 429 | Bucket exhausted; `Retry-After` set | §11 |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Header missing on an endpoint that mandates it | §7 |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Key already bound to a **different** request body hash | Client reused a key across operations |
| `IDEMPOTENCY_REQUEST_IN_PROGRESS` | 409 | Key row is `IN_PROGRESS`; original still executing | Aggressive retry; `Retry-After: 2` |
| `CONFLICT_VERSION` | 409 | `If-Match` / `version` mismatch on optimistic concurrency | Two admins editing one record |
| `CONFLICT_DUPLICATE` | 409 | Generic uniqueness violation not covered by a named code | |
| `INTERNAL_ERROR` | 500 | Unhandled. No stack trace, no message detail in production. | |
| `SERVICE_UNAVAILABLE` | 503 | Hard dependency down, or shutdown drain | |
| `UPSTREAM_TIMEOUT` | 504 | Upstream deadline exceeded | |

### 4.4 Domain codes by module

#### Profiles & fleet

| Code | HTTP | Meaning | Typical cause |
|---|---|---|---|
| `OWNER_NOT_APPROVED` | 422 | Owner's `onboarding_status` is not `APPROVED` | Owner bidding before approval |
| `OWNER_DOCUMENTS_INCOMPLETE` | 422 | Mandatory `document_types` for an owner are missing or unverified | Submitting for review too early |
| `DRIVER_NOT_APPROVED` | 422 | `driver_profiles.approval_status` not approved | Assigning an unapproved driver |
| `DRIVER_LICENSE_EXPIRED` | 422 | `license_expiry_date` in the past | Assignment or dispatch |
| `DRIVER_NOT_ASSIGNED_TO_VEHICLE` | 422 | No open `vehicle_driver_assignments` row | Dispatching a driver to a vehicle they do not hold |
| `DRIVER_ALREADY_ON_TRIP` | 409 | `availability_status = ON_TRIP` | Double dispatch |
| `VEHICLE_NOT_FOUND` | 404 | Absent or out of scope | |
| `VEHICLE_NOT_DISPATCHABLE` | 422 | Fails the `vehicle.policy` predicate (approved + active + documents verified & unexpired) | Bidding with a vehicle whose insurance lapsed |
| `VEHICLE_PLATE_TAKEN` | 409 | `uq_vehicles_plate` collision among live rows | Re-registering a plate |
| `VEHICLE_VIN_TAKEN` | 409 | `uq_vehicles_vin` collision | |
| `VEHICLE_CALENDAR_CONFLICT` | 409 | `23P01` on `ex_vehicle_calendar_no_overlap` for a non-booking entry | Owner blackout overlapping a reservation |
| `VEHICLE_INVALID_TRANSITION` | 422 | Illegal move on `approval_status` / `lifecycle_status` | Approving an already-rejected vehicle without resubmission |
| `VEHICLE_HAS_ACTIVE_BOOKINGS` | 409 | Archive/delete attempted with future reservations | |

#### Documents

| Code | HTTP | Meaning | Typical cause |
|---|---|---|---|
| `DOCUMENT_TYPE_NOT_ALLOWED` | 422 | `document_types.applies_to` does not match the target entity | Uploading a vehicle registration against a user |
| `DOCUMENT_MIME_NOT_ALLOWED` | 422 | MIME not in `allowed_mime_types`, or magic-byte sniff disagrees with the declared type | `.exe` renamed `.pdf` |
| `DOCUMENT_SIZE_EXCEEDED` | 422 | Over `document_types.max_size_bytes` | |
| `DOCUMENT_UPLOAD_INCOMPLETE` | 409 | `confirm` called while the object is absent from storage | Client confirmed before the PUT finished |
| `DOCUMENT_CHECKSUM_MISMATCH` | 422 | Declared `checksumSha256` ≠ stored object's checksum | Truncated upload; substitution attempt |
| `DOCUMENT_SCAN_QUARANTINED` | 422 | `upload_status = QUARANTINED` by the AV scan | Malware detected |
| `DOCUMENT_ALREADY_VERIFIED` | 409 | Re-verifying a `VERIFIED` document | |
| `DOCUMENT_EXPIRY_REQUIRED` | 422 | `document_types.requires_expiry` but no `expiryDate` supplied | |
| `DOCUMENT_EXPIRED` | 422 | `expiry_date` in the past where a valid document is required | |

#### Demand, bidding, bookings

| Code | HTTP | Meaning | Typical cause |
|---|---|---|---|
| `TRIP_REQUEST_INVALID_TRANSITION` | 422 | Illegal move on `trip_request_status` | Publishing a cancelled request; closing the remainder of a request that is not `PARTIALLY_AWARDED` |
| `TRIP_REQUEST_NOT_OPEN` | 422 | Status not in `PUBLISHED`/`PARTIALLY_AWARDED` | Bidding on a cancelled, expired or fully-awarded request |
| `TRIP_REQUEST_BIDDING_WINDOW_CLOSED` | 422 | `now() > bidding_closes_at`, or `now() > remainder_closes_at` while `PARTIALLY_AWARDED` | Late bid. Bidding closure is a **deadline property, not a status** — `BIDDING_CLOSED` was removed from `trip_request_status` ([database.md §8.4](database.md)) |
| `TRIP_REQUEST_REMAINDER_CLOSED` | 422 | Status is `CLOSED_PARTIAL` | Bidding on, or awarding against, a balance the customer has closed |
| `TRIP_REQUEST_FULLY_AWARDED` | 409 | `vehicles_awarded >= vehicles_required` | Racing acceptances on a multi-vehicle request (**A-45**) |
| `TRIP_REQUEST_DETAIL_MISMATCH` | 422 | `transportType` does not match the supplied detail object | `PASSENGER` request with `goodsDetails` |
| `RULE_PARTIAL_AWARD_NOT_ALLOWED` | 422 | Single-bid acceptance attempted on a request with `allow_partial_fulfilment = false` | Use `POST /trip-requests/{id}/award` with a bid set covering the whole remainder (**A-45**) |
| `RULE_AWARD_SET_INCOMPLETE` | 422 | A group award's bid set does not cover `vehicles_required − vehicles_awarded` exactly | All-or-nothing award submitted with too few or too many bids |
| `RULE_VEHICLES_REQUIRED_BELOW_AWARDED` | 422 | `PATCH …/remainder` would set `vehiclesRequired` below `vehicles_awarded` | Shrinking an order below what is already awarded — cancel a booking instead |
| `RULE_CREDIT_LIMIT_EXCEEDED` | 422 | Credit exposure (unpaid issued invoices **+ live bookings not yet invoiced**) + this booking's total exceeds `credit_limit_amount` | `INVOICED` award for a corporate customer at their ceiling (**A-46**, **OQ-21**: the limit is the only gate — unpaid or overdue invoices alone never block while headroom remains) |
| `RULE_CREDIT_NOT_APPROVED` | 422 | `corporate_customer_profiles.credit_status` is not `APPROVED` | `INVOICED` award for a customer whose credit is `NONE`, `PENDING_APPROVAL` or `SUSPENDED` |
| `BID_EXPIRED` | 422 | `now() > valid_until` | Accepting a stale bid |
| `BID_ALREADY_DECIDED` | 409 | Status is not `SUBMITTED` | Double-accept, or accepting a withdrawn bid |
| `BID_VEHICLE_UNAVAILABLE` | 409 | `23P01` on `ex_vehicle_calendar_no_overlap` during acceptance | The vehicle was booked concurrently |
| `BID_DUPLICATE_VEHICLE` | 409 | `uq_bids_active_vehicle_per_request` collision | Same vehicle offered twice on one request |
| `BID_NOT_ELIGIBLE` | 422 | Owner was not invited, or is outside the request's service area | Bidding on an unmatched request |
| `BID_AMOUNT_INVALID` | 422 | `base_amount <= 0`, or extras breakdown does not sum to a positive total | |
| `BID_VALIDITY_INVALID` | 422 | `validUntil <= now()`, or past the applicable deadline (`bidding_closes_at`, or `remainder_closes_at` while `PARTIALLY_AWARDED`) | |
| `BOOKING_INVALID_TRANSITION` | 422 | Pair not present in `BOOKING_TRANSITIONS` | Cancelling an `IN_PROGRESS` booking |
| `BOOKING_ALREADY_CANCELLED` | 409 | Already `CANCELLED`/`REFUNDED` | Double cancel |
| `BOOKING_PAYMENT_REQUIRED` | 422 | Transition needs `payment_status = PAID` | Confirming an unpaid `PREPAID` booking. **Never raised for `billing_mode = INVOICED`** — those bookings enter at `CONFIRMED` and are collected by invoice (**A-46**) |
| `BOOKING_DRIVER_ALREADY_ASSIGNED` | 409 | A driver is already assigned; unassign first | |
| `BOOKING_CANCELLATION_WINDOW_PASSED` | 422 | Inside the policy's `no_cancel_window_hours` for the canceller's role (**OQ-05** — admin-configured; production default has no window) | Cancelling 30 min before pickup under a policy that sets one |
| `CANCELLATION_FEE_OVERRIDE_FORBIDDEN` | 403 | `feeOverride` supplied by a caller without global-scope `bookings.cancel` | A customer trying to waive their own fee |
| `CANCELLATION_FEE_LOCKED` | 409 | Waiver attempted after the refund was processed or the owner settlement line approved | Use a settlement adjustment / manual refund instead |

#### Trips & tracking

| Code | HTTP | Meaning | Typical cause |
|---|---|---|---|
| `TRIP_INVALID_TRANSITION` | 422 | Pair absent from `TRIP_TRANSITIONS[transportType]` | Passenger trip sent `LOADING`; goods trip skipping `LOADED` |
| `TRIP_NOT_ACTIVE` | 422 | Trip is `COMPLETED`/`CANCELLED` | Late status ping |
| `TRIP_ALREADY_COMPLETED` | 409 | Completion attempted twice | |
| `TRIP_PROOF_REQUIRED` | 422 | `DELIVERED` requested without a `DELIVERY_CONFIRMATION` proof | Goods trip completion |
| `TRACKING_SESSION_NOT_ACTIVE` | 422 | No `ACTIVE` `tracking_sessions` row for the trip | Ping before trip start |
| `TRACKING_NOT_AUTHORISED` | **404** | Requester is not a party to the trip | Customer tracking someone else's vehicle |
| `TRACKING_STALE_POINT` | 422 | `recordedAt` older than the last stored point by more than the reorder tolerance, or in the future | Clock skew; offline replay beyond tolerance |

#### Payments, refunds, finance

| Code | HTTP | Meaning | Typical cause |
|---|---|---|---|
| `PAYMENT_ALREADY_CAPTURED` | 409 | Payment is `PAID` | Re-initiating a settled payment |
| `PAYMENT_AMOUNT_MISMATCH` | 422 | Requested amount ≠ booking outstanding balance | Client-computed amount |
| `PAYMENT_DECLINED` | 422 | Gateway declined | Insufficient funds, 3-D Secure failure |
| `PAYMENT_METHOD_UNSUPPORTED` | 422 | Method not enabled for this provider/config | |
| `PAYMENT_NOT_REFUNDABLE` | 422 | Status not `PAID`/`PARTIALLY_REFUNDED` | Refunding a failed payment |
| `PAYMENT_GATEWAY_ERROR` | 502 | Adapter got a non-success, unparseable or timed-out response | Provider outage |
| `PAYMENT_EXPIRED` | 422 | `payments.expires_at` passed before completion | Abandoned checkout |
| `REFUND_EXCEEDS_CAPTURED` | 422 | Σ refunds > captured amount for the payment | Over-refund |
| `REFUND_ALREADY_PROCESSED` | 409 | Refund is `PROCESSING`/`COMPLETED` | Double submit |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | HMAC verification failed | Forged or misconfigured webhook |
| `WEBHOOK_UNKNOWN_PROVIDER` | 404 | `:provider` not registered | Typo in the gateway dashboard |
| `INVOICE_ALREADY_ISSUED` | 409 | Booking already appears on a live (non-`VOID`) invoice | |
| `INVOICE_BOOKING_NOT_COMPLETED` | 422 | Booking not `COMPLETED` | Premature issuance |
| `INVOICE_BOOKING_ALREADY_BILLED` | 409 | `uq_invoice_lines_booking` collision — the booking is already a `BOOKING` line on a live invoice | Re-running a billing cycle over an already-invoiced period |
| `INVOICE_NOT_VOIDABLE` | 422 | Invoice is `PARTIALLY_PAID`/`PAID`, or already `VOID`/`CREDITED` | Voiding a settled invoice — issue a credit note instead |
| `INVOICE_NOT_PAYABLE` | 422 | Invoice status not `ISSUED`/`PARTIALLY_PAID`/`OVERDUE` | Paying a `DRAFT`, `VOID` or fully `PAID` invoice |
| `INVOICE_NO_ELIGIBLE_BOOKINGS` | 422 | A billing cycle found no unbilled `COMPLETED` `INVOICED` bookings in the period | Generating a cycle twice, or for a dormant customer |
| `INVOICE_NOT_CLEARED` | 409 | A standard tax invoice is requested for delivery while `clearanceStatus = PENDING` | `GET /invoices/{id}/pdf-url` or `…/xml` on a `PENDING_CLEARANCE` invoice. **The document does not exist yet** — it is rendered from the authority-returned artefact, not from our own copy ([database.md §12.7](database.md)) |
| `INVOICE_CLEARANCE_REJECTED` | 422 | The authority rejected the submission; the invoice is `CLEARANCE_FAILED` | Malformed UBL, stamp failure, a buyer VAT number the authority does not recognise. Authority errors are passed through verbatim in `details.authorityErrors` |
| `INVOICE_IMMUTABLE` | 409 | Modification attempted on an invoice past `DRAFT` | Editing lines, re-rendering or recalculating an issued invoice. Corrections are a credit or debit note, never an edit (**ADR-007**) |
| `INVOICE_ALREADY_CLEARED` | 409 | Clearance retry or resubmission attempted on an invoice already `CLEARED`/`REPORTED` | `POST /admin/invoices/{id}/retry-clearance` on a settled invoice; a duplicate submission would burn an `icv` |
| `CLEARANCE_PROVIDER_UNAVAILABLE` | 503 | The e-invoicing provider is unreachable or past its deadline. **Retryable**; `Retry-After` is set | Provider outage during an issue path or a billing run. The invoice is **not** discarded — it rests in `PENDING_CLEARANCE` and the retry job picks it up (risk **AR-9**) |
| `COMMISSION_GLOBAL_RULE_REQUIRED` | 422 | Deleting/deactivating the last active `GLOBAL` rule | Set it to `NONE` instead if the intent is to stop charging |
| `COMMISSION_RULE_OVERLAP` | 409 | Another rule with identical scope, priority and overlapping effective window | |
| `COMMISSION_OVERRIDE_FORBIDDEN` | 403 | `commissionOverride` supplied by a caller without `commissions.override` | A customer or owner trying to set their own commission |
| `COMMISSION_OVERRIDE_INVALID` | 422 | `PERCENTAGE` outside 0–100, negative `FIXED`, `FIXED` exceeding the bid's net amount, `NONE` with a value, or a missing `reason` | |
| `COMMISSION_OVERRIDE_AFTER_BIDS` | 422 | An override that would charge *more* than the resolved rule, on a request that already has submitted bids | Owners priced their bids against the commission shown at the time; raise it only before bidding opens, or cancel and re-raise |
| `COMMISSION_OVERRIDE_LOCKED` | 409 | Override attempted on a request whose remainder is closed, or on a booking already confirmed | Post-confirmation corrections are settlement adjustments |
| `SETTLEMENT_BOOKING_ALREADY_SETTLED` | 409 | Partial-unique collision on `settlement_lines(booking_id) WHERE line_type='BOOKING_EARNING'` | Rebuilding a settlement over an already-paid period |
| `SETTLEMENT_INVALID_TRANSITION` | 422 | Illegal `settlements.status` move | Paying a `DRAFT` settlement |
| `SETTLEMENT_NO_ELIGIBLE_LINES` | 422 | Period contains no settleable bookings | |
| `SETTLEMENT_BANK_ACCOUNT_MISSING` | 422 | Owner has no verified default `owner_bank_accounts` row | |
| `LEDGER_UNBALANCED` | 500 | Debit/credit assertion failed before write; transaction aborted | Calculation defect — alerts immediately |

#### Expenses, maintenance, engagement, platform

| Code | HTTP | Meaning | Typical cause |
|---|---|---|---|
| `EXPENSE_IMMUTABLE` | 409 | Expense already included in a paid settlement | Editing settled history |
| `MAINTENANCE_CALENDAR_CONFLICT` | 409 | Maintenance window overlaps a reservation; `details.blockingBookingNumber` names it | Scheduling over a confirmed booking |
| `MAINTENANCE_INVALID_TRANSITION` | 422 | Illegal `maintenance_records.status` move | |
| `RATING_NOT_ELIGIBLE` | 422 | Booking not `COMPLETED`, or rater not a party in the claimed role | (Non-party requests return **404**) |
| `RATING_ALREADY_SUBMITTED` | 409 | `uq_ratings_once` collision | |
| `RATING_WINDOW_CLOSED` | 422 | Past `completed_at + rating_window` (A-10, 14 d) | |
| `COMPLAINT_INVALID_TRANSITION` | 422 | Illegal `complaints.status` move | |
| `NOTIFICATION_CATEGORY_MANDATORY` | 422 | Disabling a transactional category (OTP, payment, trip status) | |
| `GEO_PROVIDER_ERROR` | 502 | Maps provider failed | |
| `GEO_QUOTA_EXCEEDED` | 429 | Per-actor or platform maps quota exhausted | |
| `REPORT_UNKNOWN_CODE` | 404 | `{code}` not in the report registry | |
| `REPORT_RANGE_TOO_LARGE` | 422 | Requested window exceeds the report's maximum span | |
| `REPORT_EXPORT_IN_PROGRESS` | 409 | An identical export by the same actor is already running | |
| `SETTINGS_KEY_IMMUTABLE` | 409 | Key is code-managed and not admin-editable | |
| `SETTINGS_SECRET_SCOPE` | 403 | Attempt to read a `SECRET`-scoped setting | Secrets live in env vars; never returned |

### 4.5 `details` payload shapes

`details` is always an object. Its shape is fixed per code so clients can interpolate reliably.

| Code | `details` |
|---|---|
| `VALIDATION_FAILED` | `{ fieldErrors: Record<string, string[]>, formErrors: string[] }` |
| `VALIDATION_UNSUPPORTED_SORT` | `{ received: string, allowed: string[] }` |
| `BID_VEHICLE_UNAVAILABLE` | `{ bidId, vehicleId, conflictingPeriod: { from, to } }` |
| `BID_EXPIRED` | `{ bidId, validUntil }` |
| `TRIP_REQUEST_BIDDING_WINDOW_CLOSED` | `{ tripRequestId, closedAt, deadlineField: "biddingClosesAt" \| "remainderClosesAt" }` |
| `TRIP_REQUEST_FULLY_AWARDED` | `{ tripRequestId, vehiclesRequired, vehiclesAwarded }` |
| `RULE_PARTIAL_AWARD_NOT_ALLOWED` | `{ tripRequestId, vehiclesRequired, vehiclesAwarded, remainder, awardEndpoint: "POST /api/v1/trip-requests/{id}/award" }` |
| `RULE_AWARD_SET_INCOMPLETE` | `{ tripRequestId, remainder, suppliedBidCount, bidIds: string[] }` |
| `RULE_VEHICLES_REQUIRED_BELOW_AWARDED` | `{ tripRequestId, requested, vehiclesAwarded }` |
| `RULE_CREDIT_LIMIT_EXCEEDED` | `{ customerProfileId, creditLimitAmount, outstandingInvoicedAmount, uninvoicedBookingsAmount, requestedAmount, availableAmount, currency }` |
| `RULE_CREDIT_NOT_APPROVED` | `{ customerProfileId, creditStatus }` |
| `INVOICE_NOT_VOIDABLE` | `{ invoiceId, invoiceNumber, status, paidAmount, currency }` |
| `INVOICE_BOOKING_ALREADY_BILLED` | `{ bookingId, bookingNumber, invoiceNumber }` |
| `INVOICE_NOT_CLEARED` | `{ invoiceId, invoiceNumber, invoiceType, clearanceStatus: "PENDING", clearanceSubmittedAt, retryAfterSeconds }` |
| `INVOICE_CLEARANCE_REJECTED` | `{ invoiceId, invoiceNumber, clearanceStatus: "REJECTED", attemptCount, authorityErrors: Array<{ code: string, message: string, category: "ERROR" \| "WARNING", field: string \| null }> }` |
| `INVOICE_IMMUTABLE` | `{ invoiceId, invoiceNumber, status, correctionEndpoint: "POST /api/v1/invoices/{id}/credit-note" \| "POST /api/v1/invoices/{id}/debit-note" }` |
| `INVOICE_ALREADY_CLEARED` | `{ invoiceId, invoiceNumber, clearanceStatus, clearanceCompletedAt }` |
| `CLEARANCE_PROVIDER_UNAVAILABLE` | `{ retryAfterSeconds, invoiceIds: string[] \| null, queuedCount }` |
| `BOOKING_INVALID_TRANSITION` | `{ bookingId, from, to, allowed: BookingStatus[] }` |
| `TRIP_INVALID_TRANSITION` | `{ tripId, transportType, from, to, allowed: TripStatus[] }` |
| `REFUND_EXCEEDS_CAPTURED` | `{ paymentId, capturedAmount, alreadyRefundedAmount, requestedAmount, currency }` |
| `IDEMPOTENCY_KEY_REUSED` | `{ key, originalEndpoint, originalRequestedAt }` |
| `MAINTENANCE_CALENDAR_CONFLICT` | `{ vehicleId, blockingEntryType, blockingBookingNumber, period: { from, to } }` |
| `RATE_LIMITED` | `{ limit, remaining: 0, resetAt, policy }` |
| `DOCUMENT_MIME_NOT_ALLOWED` | `{ declared, detected, allowed: string[] }` |

### 4.6 Deliberate ambiguity

Three responses are intentionally uninformative, and this is a contract, not an oversight:

1. `POST /auth/login` returns `AUTH_INVALID_CREDENTIALS` for an unknown identifier **and** for a wrong password, after an equal-cost Argon2 verification against a dummy hash. Distinguishing them is a user-enumeration oracle.
2. `POST /auth/password/forgot` always returns `200` with `data: { sent: true }`, whether or not the identifier exists.
3. `POST /auth/otp/request` always returns `200` with the same `meta` shape for registered and unregistered destinations, except when throttled.

---

## 5. Pagination, filtering, sorting

### 5.1 Offset pagination (default)

Every collection endpoint is paginated. There is no way to request "all" (BRIEF-§32).

| Parameter | Type | Default | Constraint |
|---|---|---|---|
| `page` | integer | `1` | ≥ 1 |
| `pageSize` | integer | `20` | 1–100. Over 100 → `VALIDATION_PAGE_SIZE_EXCEEDED`, **not** a silent clamp — a silent clamp makes a client believe it has all the rows. |
| `sortBy` | string | per resource | Must be in the resource allow-list |
| `sortDirection` | `asc` \| `desc` | `desc` | |

The `meta` block is as in §2.1. `totalItems` is a real `COUNT(*)` over the filtered, scoped set. On the three highest-cardinality offset lists (`audit_logs` is cursor-based, but `bookings`, `notifications` and `vehicle_location_points` exports can be large), the count is capped: if it exceeds 10,000 the API returns `totalItems: 10000` and `meta.totalItemsCapped: true` rather than paying for an unbounded count on every page.

Deep offsets degrade (`OFFSET 50000` still scans 50,000 rows). Resources where deep paging is a realistic access pattern are cursor-paginated instead.

### 5.2 Cursor pagination

Used **only** for `audit-logs`, `notifications` and vehicle location points — the three append-heavy, strictly time-ordered, high-volume streams.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `cursor` | opaque string | — | Base64url of `{ recordedAt | occurredAt | createdAt, id }`. Never parsed by the client. |
| `limit` | integer | `50` | 1–200 |

```json
{
  "success": true,
  "data": [ /* … */ ],
  "message": null,
  "meta": {
    "nextCursor": "eyJ0IjoiMjAyNi0wOS0xNFQxMDo1OTo1OS4xMjJaIiwiaWQiOiIwMTkyZjNjMS0…",
    "hasNext": true
  }
}
```

No `totalItems` — counting a partitioned, monthly-rolled table on every page is exactly the cost cursor pagination exists to avoid. `nextCursor` is `null` when the stream is exhausted. Cursors are stable under insertion (they encode a `(timestamp, id)` tuple compared with a row-value `<` predicate, so a row inserted mid-scroll is never skipped or duplicated).

| Endpoint | Cursor key | Order |
|---|---|---|
| `GET /audit-logs` | `(occurred_at, id)` | desc |
| `GET /notifications` | `(created_at, id)` | desc |
| `GET /tracking/trips/{id}/history` | `(recorded_at, id)` | asc |

### 5.3 Sort allow-lists

`sortBy` is **never** interpolated into SQL. Each resource declares a `Record<string, Prisma.SortOrder-compatible column>` map; the Zod schema is `z.enum(Object.keys(map))`. An unlisted value is a 422 with `details.allowed`.

Two independent reasons, both sufficient on their own:

1. **Injection.** A `sortBy` that reaches an ORM's raw-order path or a string-built `ORDER BY` is a first-class SQL injection vector. Prisma's typed API resists this, but the codebase also uses `$queryRaw` for reporting aggregates, and the same helper is shared. An allow-list removes the class of bug rather than relying on every call site choosing the safe API.
2. **Unindexed-query denial of service.** `ORDER BY notes DESC` over 2 M bookings is a full sort of a `text` column with no supporting index. A handful of concurrent requests exhausts `work_mem`, spills to disk, and saturates I/O for every other query on the instance. The allow-list therefore contains only columns that have an index supporting the resource's dominant filter + this sort (see [database.md §14.2](database.md)).

| Resource | Allowed `sortBy` | Default |
|---|---|---|
| `users` | `createdAt`, `fullNameEn`, `lastLoginAt`, `status` | `createdAt` desc |
| `customers` | `createdAt`, `ratingAvg`, `totalBookings` | `createdAt` desc |
| `owners` | `createdAt`, `ratingAvg`, `onboardingStatus` | `createdAt` desc |
| `drivers` | `createdAt`, `ratingAvg`, `licenseExpiryDate`, `approvalStatus` | `createdAt` desc |
| `vehicles` | `createdAt`, `plateNumberEn`, `modelYear`, `approvalStatus`, `lifecycleStatus`, `ratingAvg`, `insuranceExpiryDate` | `createdAt` desc |
| `trip-requests` | `createdAt`, `pickupAt`, `biddingClosesAt`, `remainderClosesAt`, `status` | `pickupAt` asc |
| `opportunities` | `notifiedAt`, `pickupAt`, `matchScore`, `biddingClosesAt` | `matchScore` desc |
| `bids` | `submittedAt`, `totalAmount`, `estimatedArrivalAt`, `status` | `totalAmount` asc |
| `bookings` | `createdAt`, `scheduledStartAt`, `totalAmount`, `status` | `scheduledStartAt` desc |
| `trips` | `createdAt`, `actualStartAt`, `status` | `actualStartAt` desc |
| `payments` | `createdAt`, `amount`, `paidAt`, `status` | `createdAt` desc |
| `refunds` | `createdAt`, `amount`, `status` | `createdAt` desc |
| `invoices` | `issueDate`, `dueDate`, `totalAmount`, `outstandingAmount`, `invoiceNumber`, `status` | `issueDate` desc |
| `settlements` | `createdAt`, `periodEnd`, `netPayableAmount`, `status` | `periodEnd` desc |
| `expenses` | `expenseDate`, `totalAmount`, `createdAt` | `expenseDate` desc |
| `maintenance/records` | `scheduledStartAt`, `actualEndAt`, `totalAmount`, `status` | `scheduledStartAt` desc |
| `documents` | `createdAt`, `expiryDate`, `verificationStatus` | `createdAt` desc |
| `complaints` | `createdAt`, `severity`, `status` | `createdAt` desc |
| `ratings` | `createdAt`, `score` | `createdAt` desc |

### 5.4 Filter conventions

Shared across every list endpoint that has the underlying column:

| Parameter | Type | Semantics |
|---|---|---|
| `q` | string, 2–80 chars | Free-text search across the resource's declared search columns. Trigram-indexed (`pg_trgm`) on `vehicles.plate_number_en`, `users.full_name_en`, business names. Never a `LIKE '%…%'` on an unindexed column. Aliased as `search` for BRIEF-§32 compatibility — both names accepted, `q` canonical. |
| `status` | enum \| enum[] | Repeatable: `?status=CONFIRMED&status=DRIVER_ASSIGNED`, or comma-joined. Validated against the resource's PostgreSQL enum; an unknown value is 422, not an empty result. |
| `dateFrom` / `dateTo` | ISO-8601 date or timestamp | Inclusive-exclusive `[from, to)` on the resource's **primary date column** (documented per resource: `bookings` → `scheduled_start_at`, `payments` → `created_at`, `expenses` → `expense_date`). Where a second axis is needed the parameter is explicit: `createdFrom`/`createdTo`. |
| `includeDeleted` | boolean | Admin-only (`*_any` or an admin permission). Ignored — not rejected — for other actors, so the soft-delete filter cannot be lifted by guessing. |

Resource-specific filters are declared in each module's query schema and appear in the generated OpenAPI. Representative examples: `customerProfileId`, `ownerProfileId`, `vehicleId`, `driverProfileId`, `tripRequestId`, `bookingId`, `transportType`, `vehicleCategoryId`, `cityId`, `paymentStatus`, `approvalStatus`, `verificationStatus`, `expiringWithinDays`, `minAmount`/`maxAmount`.

Filter values that reference a tenant (`ownerProfileId`, `customerProfileId`) are **narrowing only**. They are intersected with `ActorScope`, never substituted for it — passing `?ownerProfileId=<someone-else>` yields `[]`, not another owner's rows.

### 5.5 Worked example

```http
GET /api/v1/bookings?status=CONFIRMED&status=DRIVER_ASSIGNED
    &dateFrom=2026-09-01&dateTo=2026-10-01
    &q=BK-2026-0001&sortBy=scheduledStartAt&sortDirection=asc
    &page=2&pageSize=20 HTTP/1.1
Host: api.unigate.sa
Authorization: Bearer eyJhbGciOiJIUzI1NiIs…
Accept-Language: ar
X-Request-Id: 0192f3c2-1b88-70a4-8e55-9d2c7f41aa03
```

```json
{
  "success": true,
  "data": [
    {
      "id": "0192f3c1-7a4e-7b2d-9f10-5c3ab9e42d77",
      "bookingNumber": "BK-2026-000123",
      "status": "CONFIRMED",
      "paymentStatus": "PAID",
      "transportType": "PASSENGER",
      "vehiclePlateSnapshot": "ABC 1234",
      "vehicleDescriptionSnapshot": "Toyota Hiace 2022 — Van",
      "ownerNameSnapshot": "Al Rajhi Transport Est.",
      "scheduledStartAt": "2026-09-20T05:30:00.000Z",
      "scheduledEndAt": "2026-09-20T11:00:00.000Z",
      "pickupCityId": "0192e100-0000-7000-8000-00000000a001",
      "totalAmount": "1437.50",
      "vatAmount": "187.50",
      "currency": "SAR",
      "createdAt": "2026-09-14T11:02:44.817Z"
    }
  ],
  "message": null,
  "meta": {
    "page": 2,
    "pageSize": 20,
    "totalItems": 137,
    "totalPages": 7,
    "hasNext": true,
    "hasPrevious": true
  }
}
```

---

## 6. Authentication & authorization on the wire

### 6.1 Endpoints and token lifetimes

| Token | Lifetime | Storage (web) | Storage (mobile) | Claims |
|---|---|---|---|---|
| Access JWT | **15 minutes** | `ug_at` cookie — `httpOnly; Secure; SameSite=Lax; Path=/api/v1` | Memory only; never persisted | `sub`, `sid`, `roles`, `pv`, `typ:"access"`, `iat`, `exp`, `iss`, `aud` |
| Refresh token | **30 days**, rotating | `ug_rt` cookie — `httpOnly; Secure; SameSite=Lax; Path=/api/v1/auth` | Platform secure storage (Keychain / Keystore) | Opaque 256-bit random; only its SHA-256 is stored server-side |

**Permission codes are not in the access token.** The token carries `roles` (codes, for logging and coarse UI hints) and `pv` (`users.permission_version`). On every request the middleware resolves the full permission set from Redis at `perm:{userId}:{pv}`, falling back to a `user_roles ⋈ role_permissions ⋈ permissions` query on a miss. Revoking a permission bumps `permission_version`, which invalidates the cache key and makes every in-flight token resolve the new set on its next request — **without waiting 15 minutes for token expiry**. A token whose `pv` is lower than the user's current `permission_version` is still accepted for authentication; only the permission set is re-resolved. A stale `pv` is not a 401, because forcing re-login on every role edit is hostile and would push operators toward long-lived tokens.

### 6.2 Dual-mode credential transport

The mode is chosen by the client and declared once, at login.

| | Web mode | Mobile mode |
|---|---|---|
| Selected by | `clientType: "WEB"` in the login body | `clientType: "IOS"` \| `"ANDROID"` |
| Tokens returned | Set as cookies. Body contains `tokens: null`. | In the response body. No cookies set. |
| Sent as | Cookies, automatically | `Authorization: Bearer <accessToken>` |
| Refresh | `POST /auth/refresh` with the cookie + `X-Requested-With: unigate-web` | `POST /auth/refresh` with `{ "refreshToken": "…" }` in the body |
| CSRF exposure | Yes — mitigated below | None (no ambient credential) |

The middleware accepts **either** transport on every protected route: `Authorization: Bearer` takes precedence; if absent it falls back to the `ug_at` cookie. This is what makes P6 true — the same route serves both clients with no branching in the handler.

A session's `client_type` is recorded in `sessions` and is immutable. A refresh token issued to a `WEB` session cannot be redeemed in body mode, and vice versa; the mismatch is `AUTH_TOKEN_INVALID`. This prevents an XSS payload from exfiltrating a cookie-mode refresh token and replaying it as a Bearer credential from elsewhere — the cookie is `httpOnly` so it cannot be read by script in the first place, and the mode binding is the defence in depth behind that.

### 6.3 Refresh rotation and reuse detection

```
POST /api/v1/auth/refresh
```

1. Hash the presented token (SHA-256) and look it up. Unknown → `401 AUTH_TOKEN_INVALID`.
2. If `revoked_at` is set → `401 AUTH_SESSION_REVOKED`.
3. If `expires_at < now()` → `401 AUTH_REFRESH_EXPIRED`.
4. **If `used_at` is already set → reuse detected.** Revoke every `refresh_tokens` row sharing `family_id`, revoke the parent `sessions` row with `revoke_reason = 'REFRESH_REUSE'`, write an `audit_logs` entry at `severity = SECURITY`, emit a `security.refresh_reuse` outbox event (which notifies the account owner), and return **`401 AUTH_REFRESH_REUSE_DETECTED`**.
5. Otherwise: set `used_at`, mint a new refresh token in the same `family_id`, set `replaced_by_id`, issue a new access token, bump `sessions.last_seen_at`.

Steps 1–5 run inside one transaction with `SELECT … FOR UPDATE` on the token row, so two concurrent refreshes from the same client cannot both succeed — one rotates, the other sees `used_at` and trips reuse detection.

> **Known consequence — accepted (A-04).** A client that fires two refreshes in parallel (a race between two suspended API calls both seeing a 401) will log itself out. The mitigation is in the client, not the server: the web app and the mobile app both funnel refreshes through a single-flight promise, and every other in-flight request awaits it. The server does not relax reuse detection with a grace window, because a grace window is exactly the hole a stolen-token replay needs.

**What the client sees on reuse:**

```json
{
  "success": false,
  "data": null,
  "message": "Refresh token replay detected; token family 0192f3.. and session 0192f4.. revoked",
  "error": {
    "code": "AUTH_REFRESH_REUSE_DETECTED",
    "requestId": "0192f3c2-1b88-70a4-8e55-9d2c7f41aa03"
  }
}
```

The client must: clear all local auth state, drop any queued requests, and route to `/auth/login` with an interstitial explaining that the session was ended for security reasons. It must **not** retry. Cookies are cleared by the response (`Set-Cookie` with `Max-Age=0`).

### 6.4 CSRF defence for cookie mode

Cookie credentials are sent by the browser on cross-site requests, so a form on `evil.example` could otherwise POST to `api.unigate.sa`. Four layers, all active:

| Layer | Mechanism |
|---|---|
| 1. `SameSite=Lax` | Blocks cookie attachment on cross-site `POST`/`PATCH`/`DELETE` entirely. This alone defeats classic form-based CSRF. `Strict` is not used because it breaks the OAuth-style return navigations used by hosted payment pages. |
| 2. Custom header | Every state-changing request in cookie mode must carry `X-Requested-With: unigate-web`. A cross-origin request cannot set a custom header without a successful CORS preflight, and the API's CORS policy allows only the configured web origins. Missing → `403 AUTH_CSRF_HEADER_MISSING`. Mandatory on `/auth/refresh` (canonical decision) and enforced on **all** non-`GET` cookie-mode routes. |
| 3. Strict CORS | `Access-Control-Allow-Origin` is an exact-match allow-list from `WEB_ORIGINS`. Never `*`, never a reflected `Origin`, never a regex that a subdomain can satisfy. `credentials: true` only for allow-listed origins. |
| 4. `Origin` check | For non-`GET` cookie-mode requests the `Origin` (or `Referer`) header must match an allow-listed origin. Absent `Origin` on a non-`GET` request is rejected. |

Bearer mode is exempt from layers 2 and 4: a header credential is not ambient, so there is nothing to forge.

### 6.5 Two-layer authorization

Every protected route passes through both layers. Neither is optional and neither substitutes for the other.

**Layer 1 — Permission.** Declared on the route:

```ts
router.get('/bookings',
  authenticate(),
  requirePermission('bookings.read'),
  validate({ query: listBookingsQuery }),
  bookingsController.list);
```

`requirePermission` resolves the actor's permission set (§6.1) and asks a single question: *may this actor perform this kind of action at all?* It knows nothing about which rows. Failure → `403 PERM_DENIED`.

**Layer 2 — Scope / ownership.** Every repository read and list method takes an `ActorScope` as its **first parameter** and appends a mandatory predicate:

```ts
type ActorScope =
  | { kind: 'GLOBAL' }                                   // holder of the *_any code
  | { kind: 'CUSTOMER'; customerProfileId: string }
  | { kind: 'OWNER';    ownerProfileId: string }
  | { kind: 'DRIVER';   driverProfileId: string }
  | { kind: 'SPO';      spoProfileId: string }
  | { kind: 'SELF';     userId: string };

// bookings.repository.ts
private scopeWhere(scope: ActorScope): Prisma.BookingWhereInput {
  switch (scope.kind) {
    case 'GLOBAL':   return {};
    case 'CUSTOMER': return { customerProfileId: scope.customerProfileId };
    case 'OWNER':    return { ownerProfileId:    scope.ownerProfileId };
    case 'DRIVER':   return { driverProfileId:   scope.driverProfileId };
    case 'SPO':      return { attributedSpoProfileId: scope.spoProfileId };
    case 'SELF':     return { customerProfile: { userId: scope.userId } };
  }
}
```

The scope is derived once per request by `resolveActorScope(actor, resource)`: if the actor holds `<resource>.read_any` (or the module's `*_any` equivalent) the scope is `GLOBAL`; otherwise it is derived from the actor's profile rows. An actor with a customer profile **and** an owner profile (V12 in [database.md](database.md) — the owner-operator) gets the scope matching the portal they are acting in, declared by the route group, not guessed.

Three properties make this durable:

- The predicate is applied in **SQL**, so an out-of-scope row is never loaded, never logged, and never reachable by a mapper bug.
- `ActorScope` is a **required positional parameter**. A new repository method that forgets scoping does not compile.
- An ESLint rule (`unigate/repository-requires-scope`) rejects any exported repository method whose first parameter is not typed `ActorScope`, and a unit test asserts that every repository class satisfies it. A new endpoint therefore cannot forget the scope layer even if its author has never read this document.

#### Worked example — `GET /bookings` with `bookings.read` vs `bookings.read_any`

Actor A: a vehicle owner. Roles → `VEHICLE_OWNER`. Permission set contains `bookings.read`, not `bookings.read_any`. `ownerProfileId = 0192e2…b17`.

```http
GET /api/v1/bookings?status=CONFIRMED&page=1&pageSize=20
```

- Layer 1: `bookings.read` present → pass.
- Layer 2: `resolveActorScope` finds no `bookings.read_any` → `{ kind: 'OWNER', ownerProfileId: '0192e2…b17' }`.
- SQL executed:

```sql
SELECT … FROM bookings
 WHERE owner_profile_id = '0192e2…b17'      -- scope, always present
   AND status = 'CONFIRMED'                 -- filter
 ORDER BY scheduled_start_at DESC
 LIMIT 20 OFFSET 0;
```

- Result: 6 rows. `meta.totalItems = 6`.

Actor A now tries to narrow to another owner:

```http
GET /api/v1/bookings?ownerProfileId=0192e9…ccc
```

The filter is ANDed with the scope, not substituted: `WHERE owner_profile_id = '0192e2…b17' AND owner_profile_id = '0192e9…ccc'` → `200` with `data: []`. No 403, no signal that the other owner exists.

Actor A reads a specific booking belonging to owner B:

```http
GET /api/v1/bookings/0192fa…901
```

→ `404 NOT_FOUND`. The row is filtered out in SQL; the service's `assertFound` raises `NotFoundError`. The audit log records `PERM_SCOPE_VIOLATION` for anomaly detection; the client sees only `NOT_FOUND` (§3.2).

Actor B: an ops manager. Permission set contains `bookings.read` **and** `bookings.read_any`.

- Layer 1: pass.
- Layer 2: `{ kind: 'GLOBAL' }` → `scopeWhere` returns `{}`.
- SQL: `WHERE status = 'CONFIRMED'` only. Result: 1,842 rows, paginated.
- `?ownerProfileId=0192e9…ccc` now genuinely narrows, because the scope predicate is empty.

The same actor calling `POST /vehicles/{id}/approve` without `vehicles.approve` gets `403 PERM_DENIED` at layer 1 — the permission is missing outright, and the vehicle's existence is not a secret from an ops manager who can already list vehicles.

### 6.6 Permission requirements by column in §8

Each endpoint table has a **Permission** and a **Scope** column.

| Scope value | Meaning |
|---|---|
| `self` | Bound to `sub`. `/me/*` and `/auth/*` routes. No permission code required beyond a valid session. |
| `own` | `ActorScope` derived from the actor's profile; `*_any` upgrades it to `global`. |
| `party` | Actor must be a named party to the record (customer, owner, driver on that booking/trip). |
| `global` | Requires the `*_any` (or otherwise administrative) code; unscoped. |
| `public` | No authentication. |
| `signed` | No session; authenticated by HMAC signature (webhooks) or by a short-lived signed URL. |

### 6.7 Session and account endpoints

Covered in §8.1 and §8.2. Device/session tracking (BRIEF-§6) is served by `GET /me/sessions`, `DELETE /me/sessions/{id}` (logout one device) and `POST /auth/logout-all`.

---

## 7. Idempotency

### 7.1 Where it is required

`Idempotency-Key` is **mandatory** (missing → `400 IDEMPOTENCY_KEY_REQUIRED`) on every endpoint that moves money or advances irreversible state:

| Endpoint | Why |
|---|---|
| `POST /trip-requests` | Duplicate requests fan out duplicate invitations and notifications to every matched owner |
| `POST /bids` | Duplicate bids on one request |
| `POST /bids/{id}/accept` | Creates a booking, reserves a vehicle, freezes finance |
| `POST /trip-requests/{id}/award` | Creates **n** bookings and **n** reservations atomically; a duplicate would double-award an all-or-nothing order |
| `POST /trip-requests/{id}/close-remainder` | Terminal for the unfilled balance; rejects the remaining live bids |
| `POST /bookings` | Admin-created booking |
| `POST /bookings/{id}/cancel` | Computes a fee, releases a reservation, may trigger a refund |
| `POST /bookings/{id}/assign-driver` | Dispatch |
| `POST /payments` | **Money** |
| `POST /payments/{id}/cancel` | Money |
| `POST /refunds` | **Money** |
| `POST /refunds/{id}/approve`, `/process` | Money |
| `POST /settlements`, `/{id}/approve`, `/{id}/pay` | **Money** |
| `POST /invoices`, `POST /invoices/{id}/credit-note`, `POST /invoices/{id}/debit-note`, `POST /invoices/{id}/void` | Gapless sequential numbering — a duplicate burns an invoice number, and with `icv` chaining a burnt number is externally detectable, not merely untidy ([database.md §12.7](database.md)) |
| `POST /admin/invoices/generate` | A billing cycle issues many numbered invoices; a duplicate run double-bills a period and submits a second set for clearance |
| `POST /admin/invoices/{id}/retry-clearance` | A duplicate retry submits the same `icv` twice to the authority |
| `POST /trips/{id}/status` | Advances a state machine; duplicates pollute `trip_status_history` |
| `POST /documents/{id}/confirm` | Binds a storage object to a record |
| `POST /maintenance/records` | Inserts a calendar entry |
| `POST /expenses` | Financial record |
| `POST /reports/{code}/export` | Expensive job |

It is **optional but honoured** on all other non-`GET` endpoints. It is **ignored** on `GET`, `PUT` (naturally idempotent), and `DELETE` (naturally idempotent).

`PATCH` endpoints that move state — `PATCH /bids/{id}` (a revision, which bumps `version`) and `PATCH /settlements/{id}` — also require the header.

### 7.2 Key format

Client-generated UUID v4/v7, or any opaque string of 16–128 characters matching `^[A-Za-z0-9_-]{16,128}$`. Clients must generate a **new key per logical operation**, and reuse that same key across retries of that operation. A key is scoped to `(user_id, endpoint)`; two different users may coincidentally use the same string without interfering.

### 7.3 Flow

The `idempotency_keys` table ([database.md §13.4](database.md)) holds `key` (PK), `user_id`, `endpoint`, `request_hash`, `response_status`, `response_body`, `status`, `created_at`, `expires_at`.

```
1. Compute request_hash = SHA-256(method ‖ path ‖ canonicalised JSON body)
   (canonicalisation: keys sorted, whitespace stripped — so key order does not
    make two identical requests look different)

2. INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash,
                                 status, expires_at)
   VALUES (…, 'IN_PROGRESS', now() + interval '24 hours')
   ON CONFLICT (key) DO NOTHING
   RETURNING *;

3a. Insert succeeded  → we own this key. Execute the handler.
                        On success: UPDATE … SET status='COMPLETED',
                          response_status = <code>, response_body = <envelope>.
                        On a 4xx business error: also record it — the replay
                          must be deterministic, including failures.
                        On a 5xx / unhandled error: DELETE the row, so a retry
                          genuinely retries rather than replaying a crash.

3b. Insert conflicted → SELECT the existing row.
     ├─ user_id ≠ actor or endpoint ≠ this endpoint
     │     → 409 IDEMPOTENCY_KEY_REUSED
     ├─ request_hash ≠ computed hash
     │     → 409 IDEMPOTENCY_KEY_REUSED
     │       details: { key, originalEndpoint, originalRequestedAt }
     ├─ status = 'IN_PROGRESS'
     │     → 409 IDEMPOTENCY_REQUEST_IN_PROGRESS, Retry-After: 2
     └─ status = 'COMPLETED'
           → replay: return the stored response_status and response_body
             verbatim, with meta.idempotentReplay = true and the header
             Idempotency-Replayed: true
```

The `INSERT … ON CONFLICT DO NOTHING` is the concurrency control. Two simultaneous requests with the same key: exactly one insert wins, the other reads `IN_PROGRESS` and gets a 409 telling it to wait. **No advisory locks, no check-then-act race.**

The idempotency row is written in the **same transaction** as the business effect wherever the business effect is a single transaction (bid acceptance, booking creation, expense creation). Where the effect spans an external call (payment initiation), the row is committed as `IN_PROGRESS` first, the external call is made, and the row is completed afterwards — so a crash between the gateway call and the completion leaves an `IN_PROGRESS` row that the reconciliation job resolves by querying the gateway, never by guessing.

### 7.4 Replay semantics

A replay returns the **byte-identical** original envelope — same status, same `data`, same `error`, same `requestId` from the original call. Two additions mark it:

```http
HTTP/1.1 201 Created
Idempotency-Replayed: true
```

```json
{
  "success": true,
  "data": { "id": "0192f3c1-…", "bookingNumber": "BK-2026-000123", "status": "PENDING_PAYMENT" },
  "message": null,
  "meta": { "idempotentReplay": true }
}
```

Business failures replay too. If `POST /bids/{id}/accept` returned `409 BID_VEHICLE_UNAVAILABLE`, the same key replays that 409 — not a fresh attempt that might now succeed and create a second booking the client never learns about.

Keys expire after **24 hours** (`expires_at`) and are hard-deleted by a nightly job. A retry after 24 hours is a genuinely new operation. Clients that may retry beyond that window must re-read the resource instead.

### 7.5 `IDEMPOTENCY_KEY_REUSED` in practice

```http
POST /api/v1/payments HTTP/1.1
Idempotency-Key: 0192f3c9-4d11-7a02-b3e6-7f1d9c22ab40
Content-Type: application/json

{ "bookingId": "0192f3c1-…", "amount": "1437.50", "currency": "SAR", "methodType": "MADA" }
```

…then, from a client bug that reuses the key for the next booking:

```http
POST /api/v1/payments HTTP/1.1
Idempotency-Key: 0192f3c9-4d11-7a02-b3e6-7f1d9c22ab40

{ "bookingId": "0192f4aa-…", "amount": "920.00", "currency": "SAR", "methodType": "STC_PAY" }
```

```json
{
  "success": false,
  "data": null,
  "message": "Idempotency-Key 0192f3c9-4d11-7a02-b3e6-7f1d9c22ab40 was first used with a different request body",
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "details": {
      "key": "0192f3c9-4d11-7a02-b3e6-7f1d9c22ab40",
      "originalEndpoint": "POST /api/v1/payments",
      "originalRequestedAt": "2026-09-14T11:02:44.817Z"
    },
    "requestId": "0192f3d0-8e21-7c55-9a13-2b6e4f019cd2"
  }
}
```

This is a hard failure, deliberately. Silently executing the second payment would mean the idempotency guarantee is decorative; silently replaying the first would charge the customer for the wrong booking.

---

## 8. Endpoint catalogue

**243 endpoints** across 18 modules. Every path is relative to `/api/v1`.

Legend for the tables: **Permission** is the code passed to `requirePermission`; `—` means authentication alone suffices (the scope layer binds the resource to `sub`), and `public` means no authentication. **Scope** uses the vocabulary of §6.6. Endpoints marked **†** have a full specification in [§8.34](#834-detailed-endpoint-specifications). Endpoints marked **⧗** require `Idempotency-Key`.

Module mapping (canonical 18 → path groups):

| Module | Paths |
|---|---|
| `iam` | `/auth`, `/me`, `/users`, `/admin/roles`, `/admin/permissions` |
| `profiles` | `/customers`, `/admin/customers/{id}/credit`, `/admin/customers/{id}/vat-number`, `/owners`, `/drivers`, `/spo` |
| `reference` | `/vehicle-categories`, `/reference/*` |
| `documents` | `/documents` |
| `fleet` | `/vehicles` |
| `demand` | `/trip-requests`, `/opportunities` |
| `bidding` | `/bids` |
| `bookings` | `/bookings` |
| `trips` | `/trips` |
| `tracking` | `/tracking` |
| `payments` | `/payments`, `/refunds`, `/webhooks/payments/:provider` |
| `finance` | `/invoices`, `/admin/invoices`, `/commissions`, `/settlements`, `/ledger`, `/expenses` |
| `maintenance` | `/maintenance` |
| `engagement` | `/ratings`, `/complaints` |
| `notifications` | `/notifications` |
| `reporting` | `/reports` |
| `admin` | `/admin/*`, `/audit-logs` |
| `platform` | `/settings`, `/geo`, `/health`, `/ready`, `/docs` |

### 8.1 `/auth` — authentication (12)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| POST | `/auth/register` | public | public | Create an account (`CUSTOMER` or `VEHICLE_OWNER` intent). Issues a phone OTP; returns `PENDING_VERIFICATION`. |
| POST | `/auth/login` **†** | public | public | Email/phone + password. Returns tokens (mobile) or sets cookies (web). |
| POST | `/auth/refresh` **†** | public | signed | Rotate the refresh token. Reuse detection per §6.3. |
| POST | `/auth/logout` | — | self | Revoke the current session and its token family. Clears cookies. |
| POST | `/auth/logout-all` | — | self | Revoke every session for `sub`. BRIEF-§6. |
| POST | `/auth/otp/request` **†** | public | public | Send an OTP for `REGISTRATION`, `LOGIN`, `PHONE_VERIFICATION`, `PASSWORD_RESET` or `SENSITIVE_ACTION`. |
| POST | `/auth/otp/verify` | public | public | Verify a code. For `LOGIN` returns tokens; for `PHONE_VERIFICATION` sets `phone_verified_at`; for `SENSITIVE_ACTION` returns a 5-minute step-up token. |
| POST | `/auth/password/forgot` | public | public | Always `200` (§4.6). Emails/SMSes a `password_reset_tokens` link. |
| POST | `/auth/password/reset` | public | public | Consume the reset token, set a new Argon2id hash, revoke all sessions. |
| POST | `/auth/password/change` | — | self | Requires the current password. Revokes all **other** sessions. |
| POST | `/auth/email/verify` | public | public | Consume an email verification token. |
| GET | `/auth/session` | — | self | Echo the current session: `userId`, `sessionId`, `roles`, `clientType`, `expiresAt`. Cheap liveness probe for the web app's auth boundary. |

### 8.2 `/me` — the acting user (10)

No `/me` route takes a permission code. The scope layer binds every one of them to `sub`, which is why an actor who can see nothing else can still manage their own account.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/me` | — | self | Current user + the profile summaries they hold (customer / owner / driver / SPO) + resolved permission codes + `permissionVersion`. The single call the web app makes on boot. |
| PATCH | `/me` | — | self | `fullNameEn`, `fullNameAr`, `preferredLocale`, `timezone`. Changing `email`/`phoneE164` goes through `/auth/otp/*`. |
| GET | `/me/sessions` | — | self | Device/session list: `deviceName`, `clientType`, `ipAddress`, `lastSeenAt`, `isCurrent`. |
| DELETE | `/me/sessions/{id}` | — | self | Log out one device. `204`. |
| GET | `/me/notification-preferences` | — | self | `(category, channel) → isEnabled`, with transactional categories flagged `locked: true`. |
| PUT | `/me/notification-preferences` | — | self | Bulk replace. Disabling a transactional category → `422 NOTIFICATION_CATEGORY_MANDATORY`. |
| POST | `/me/devices` | — | self | Register a push token (`device_tokens`). Upserts on `token`. |
| DELETE | `/me/devices/{id}` | — | self | Deactivate a push token. `204`. |
| GET | `/me/saved-locations` | — | self | Customer address book (`saved_locations`). |
| POST | `/me/saved-locations` | — | self | Add a saved pickup/dropoff location. `PATCH`/`DELETE` on `/{id}` share this route file and are covered by the same permission model. |

### 8.3 `/users` — administrative user management (8)

`users.*` codes are staff-only; a customer never holds `users.read`. Self-service lives at `/me`.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/users` | `users.read` | global | List/search users. Filters: `status`, `roleCode`, `hasProfile`, `q`, `createdFrom`/`createdTo`. |
| POST | `/users` | `users.create` | global | Create a staff or platform user with an initial role set. No password is set; an activation link is sent. |
| GET | `/users/{id}` | `users.read` | global | Full user record incl. profile links, role grants and verification state. |
| PATCH | `/users/{id}` | `users.update` | global | Name, locale, timezone, email/phone (with re-verification forced). |
| DELETE | `/users/{id}` | `users.delete` | global | Soft delete (`deleted_at`). Blocked if the user has active bookings or trips. `204`. |
| POST | `/users/{id}/suspend` | `users.suspend` | global | `status → SUSPENDED`, all sessions revoked, reason recorded. `POST …/reactivate` shares this route. |
| PUT | `/users/{id}/roles` | `permissions.assign` | global | Replace the user's role set. Bumps `permission_version`. Audited at `severity=NOTICE`. |
| POST | `/users/{id}/impersonate` | `users.impersonate` | global | Mint a short-lived (10 min), non-refreshable access token acting as the target. Every request made under it carries `act` in the audit log. Cannot target a user holding `users.impersonate`. |

### 8.4 `/customers` (9)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/customers` | `customers.read` | global | List customer profiles. Filters: `customerType`, `cityId`, `acquiredBySpoId`, `creditStatus`, `billingCycle`, `hasVatNumber`, `q`. |
| POST | `/customers` | `customers.create` | global | Admin/SPO-created customer (BRIEF-§5 SPO lead conversion). Accepts optional `vatNumber` (15-digit KSA VAT number) on the **customer** profile — see the note below. |
| GET | `/customers/{id}` | `customers.read` | global | Profile + corporate extension + aggregate counters. The customer DTO carries `vatNumber` and `vatNumberLockedAt` (non-null once an invoice has been issued against it). |
| PATCH | `/customers/{id}` | `customers.update` | global | Profile fields, default city, `vatNumber` (15 digits, or `null`). **Refused once `vatNumberLockedAt` is set** — `422 VALIDATION_FAILED` with `details.fieldErrors.vatNumber` and `details.lockedByInvoiceNumber`. The correction path is the admin route on the row below. |
| PUT | `/customers/{id}/corporate` | `customers.update` | global | Upsert `corporate_customer_profiles`: `companyNameEn/Ar`, `crNumber`, billing address, contact person, `creditTermsDays`, `billingCycle` (`PER_BOOKING`, `WEEKLY`, `MONTHLY`). **`vatNumber` is no longer accepted here** — it moved to the customer profile (see below). Credit **limit and status** are not settable here — they are an admin decision (`PATCH /admin/customers/{id}/credit`). |
| POST | `/customers/{id}/verify` | `customers.verify` | global | Mark the corporate record verified after CR/VAT document review. Verification is a prerequisite for credit approval, not a grant of credit. **`PATCH /admin/customers/{id}/vat-number`** shares this permission and this route file: it is the admin correction path for a locked `vatNumber`, requires a `reason`, and writes a `NOTICE`-severity audit entry with full before/after. It is counted within this row. |
| GET | `/customers/{id}/credit` **†** | `invoices.read` | own → global | Corporate credit position: `creditStatus`, `creditLimitAmount`, `creditTermsDays`, `billingCycle`, `outstandingAmount`, `availableAmount`, `defaultBillingMode`. **`outstandingAmount` is computed from `ledger_entries` over `CUSTOMER_RECEIVABLE`, never read from a cached column** ([database.md §12.6](database.md)) — a denormalised balance is precisely the field that drifts and quietly extends unapproved credit. |
| PATCH | `/admin/customers/{id}/credit` **†** | `customers.verify` | global | Set `creditLimitAmount`/`creditTermsDays`/`billingCycle`, and move `creditStatus` through `NONE → PENDING_APPROVAL → APPROVED`, or to `SUSPENDED` with a reason. Audited at `severity = NOTICE` with full before/after. Suspension does not touch live bookings; it only blocks the next `INVOICED` award (**A-46**). |
| GET | `/customers/{id}/statement` | `invoices.read` | own → global | Accounts-receivable statement for a period: opening balance, invoices issued, payments received, closing balance, and an ageing breakdown (`current`, `1-30`, `31-60`, `61-90`, `90+`) keyed on `invoices.due_date`. Same ledger-derived figures as `/credit`; the two cannot disagree because they share one query. |

> **`vatNumber` lives on the customer profile, not the corporate extension.** VAT registration is a property of the **invoiced party**, not of being a company — VAT-registered sole traders are ordinary, and an individual customer who holds a registration is entitled to the same tax invoice a corporate gets. Keeping the field on `corporate_customer_profiles` would have made the invoice-type decision a function of *account shape* rather than of *registration status*, which is the wrong discriminator ([database.md §12.7](database.md)). It is validated as a 15-digit KSA VAT number. Clients that previously read `corporate.vatNumber` must read `customer.vatNumber`; the corporate DTO no longer carries the field.
>
> **It becomes immutable once billed.** The first invoice issued against a customer stamps `vatNumberLockedAt`, because the number is what decided whether that invoice was a `TAX_INVOICE` or a `SIMPLIFIED_TAX_INVOICE` — changing it afterwards would retroactively alter the tax character of documents already sent and cleared. Corrections therefore go through `PATCH /admin/customers/{id}/vat-number` (`customers.verify`), which requires a `reason`, writes a `NOTICE`-severity audit entry with full before/after, and **does not touch invoices already issued**: those are corrected forward with a credit or debit note, never re-rendered (§8.19).

> **`/credit` and `/statement` take `invoices.read`, not `customers.read`.** `customers.read` is a staff code scoped `global` on every other row in this table; a corporate customer does not hold it and must still be able to see their own balance and ageing. `invoices.read` is the code they already hold for `GET /invoices`, and the scope layer binds it to their own profile — so the corporate self-service view and the finance team's view are one route with one predicate, not two. `PATCH /admin/customers/{id}/credit` is the decision, not the view, and correctly takes the staff code `customers.verify`.

### 8.5 `/owners` (9)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/owners` | `owners.read` | global | List owner profiles. Filters: `ownerType`, `onboardingStatus`, `cityId`, `q`. |
| POST | `/owners` | `owners.create` | global | Admin-created owner profile for an existing user. |
| GET | `/owners/{id}` | `owners.read` | own → global | Owners may read their own profile (also at `/me/owner-profile`). Private fields (`nationalIdLast4` only, never the encrypted value) are gated by `privacy_settings` (BRIEF-§28). |
| PATCH | `/owners/{id}` | `owners.update` | own → global | Business details, service areas, privacy settings. Editing after `APPROVED` moves the profile to `UNDER_REVIEW` for the changed fields. |
| POST | `/owners/{id}/submit-for-review` | `owners.update` | own | `DRAFT`/`DOCUMENTS_SUBMITTED` → `UNDER_REVIEW`. Rejects with `OWNER_DOCUMENTS_INCOMPLETE` if mandatory document types are missing or unverified. |
| POST | `/owners/{id}/approve` | `owners.approve` | global | → `APPROVED`. Records `approved_by_user_id`. `POST …/reject` (with `rejectionReason`) shares the route file. **OQ-07**. |
| POST | `/owners/{id}/suspend` | `owners.suspend` | global | → `SUSPENDED`. Cascades: all the owner's vehicles become non-dispatchable; live bookings are untouched and flagged to ops. |
| PUT | `/owners/{id}/service-areas` | `owners.update` | own → global | Replace `owner_service_areas` (a set of `cityId`). Drives opportunity matching. |
| GET | `/owners/{id}/bank-accounts` | `settlements.read` | own → global | Payout accounts; IBAN as `ibanLast4` only. `POST` to the same path adds one and **requires a step-up token** (§8.1 `SENSITIVE_ACTION`) — payout redirection is the platform's highest-value fraud vector. |

### 8.6 `/drivers` (8)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/drivers` | `drivers.read` | own → global | Owners see their own drivers; `drivers.read_any` sees all. Filters: `approvalStatus`, `availabilityStatus`, `licenseExpiringWithinDays`, `q`. |
| POST | `/drivers` | `drivers.create` | own | Create a driver under the acting owner. Creates the `users` row (phone-only, OTP login) plus `driver_profiles`. |
| GET | `/drivers/{id}` | `drivers.read` | own → global | Profile. `nationalIdLast4`, `licenseNumberLast4` — never the encrypted values. |
| PATCH | `/drivers/{id}` | `drivers.update` | own → global | Licence details, categories, emergency contact. |
| POST | `/drivers/{id}/approve` | `drivers.approve` | global | → approved, after document verification. `POST …/reject` shares the route. |
| POST | `/drivers/{id}/availability` | `drivers.update` | self → own | `OFF_DUTY` \| `AVAILABLE`. `ON_TRIP` is system-set only and is rejected here. |
| GET | `/drivers/{id}/assignments` | `drivers.read` | own → global | `vehicle_driver_assignments` history, newest first. Never overwritten (BRIEF-§9). |
| DELETE | `/drivers/{id}` | `drivers.update` | own | Deactivate. Blocked while the driver is on an active trip. `204`. |

### 8.7 `/spo` — sales & partnership officers (6)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/spo/profiles` | `spo.read` | global | List SPOs. Filters: `regionId`, `isActive`, `q`. |
| POST | `/spo/profiles` | `spo.create` | global | Create an SPO profile (`employeeCode`, `regionId`, `commissionModel` jsonb — **OQ-09**). `PATCH /spo/profiles/{id}` uses `spo.update`. |
| GET | `/spo/profiles/{id}/customers` | `spo.read` | own → global | Active `spo_customer_assignments`. `POST` to the same path assigns a customer; `DELETE …/{customerProfileId}` unassigns. |
| GET | `/spo/leads` | `spo.leads.manage` | own → global | Lead pipeline. Filters: `status`, `q`. `POST` creates, `PATCH /spo/leads/{id}` updates. |
| POST | `/spo/leads/{id}/convert` | `spo.leads.manage` | own | Convert a `QUALIFIED` lead into a customer account and write the attribution chain. |
| GET | `/spo/commissions` | `spo.commissions.read` | own → global | SPO commission lines derived from `booking_financial_snapshots.spo_commission_amount`. Filters: `spoProfileId`, `dateFrom`/`dateTo`, `status`. |

### 8.8 `/vehicles` (13)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/vehicles` | `vehicles.read` | own → global | Owners see their fleet; `vehicles.read_any` sees all. Filters: `approvalStatus`, `lifecycleStatus`, `operationalStatus`, `vehicleCategoryId`, `baseCityId`, `ownerProfileId`, `documentsExpiringWithinDays`, `q` (trigram on plate). |
| POST | `/vehicles` | `vehicles.create` | own | Register a vehicle in `DRAFT`. Validates capacity against the category's `transport_type`. |
| GET | `/vehicles/{id}` | `vehicles.read` | own → global | Full record. For a customer viewing a booked vehicle the DTO is the reduced public projection (make/model/category/plate/rating) — owner identity and documents are omitted. |
| PATCH | `/vehicles/{id}` | `vehicles.update` | own → global | Editable fields depend on `approval_status`: after `APPROVED`, changing plate/VIN/category returns the vehicle to `PENDING_APPROVAL`. |
| DELETE | `/vehicles/{id}` | `vehicles.delete` | own → global | Soft delete. `409 VEHICLE_HAS_ACTIVE_BOOKINGS` if future reservations exist. `204`. |
| POST | `/vehicles/{id}/submit-for-approval` | `vehicles.update` | own | `DRAFT` → `PENDING_APPROVAL`. Rejects unless every mandatory document type for the category is `VERIFIED` and unexpired. |
| POST | `/vehicles/{id}/approve` | `vehicles.approve` | global | → `APPROVED`, `lifecycle_status = ACTIVE`. Audited. **OQ-07**. |
| POST | `/vehicles/{id}/reject` | `vehicles.approve` | global | → `REJECTED` with `rejectionReason`. Owner may correct and resubmit. |
| POST | `/vehicles/{id}/suspend` | `vehicles.suspend` | global | `lifecycle_status → SUSPENDED`. Does **not** clear `operational_status` — a suspended vehicle mid-trip stays `ON_TRIP` (V1). `POST …/reactivate` shares the route. |
| GET | `/vehicles/{id}/calendar` | `vehicles.read` | own → global | `vehicle_calendar_entries` in a window. Returns `entryType`, `period.from`/`to`, `status`, and `bookingNumber` where the entry is a reservation the actor is party to. |
| POST | `/vehicles/{id}/calendar/blocks` | `vehicles.availability.manage` | own → global | Owner-declared blackout (`entry_type = OWNER_BLOCK`). `409 VEHICLE_CALENDAR_CONFLICT` (with the blocking booking) if it overlaps. `DELETE …/{entryId}` releases it. |
| GET | `/vehicles/{id}/availability` | `vehicles.read` | own → global | Boolean + reasons for a `from`/`to` window: dispatchable predicate, calendar overlap, document expiry inside the window. This is the endpoint the bid form calls before allowing submission. |
| POST | `/vehicles/{id}/drivers` | `drivers.assign` | own → global | Open a `vehicle_driver_assignments` row (`isPrimary` optional). Closes the previous primary assignment rather than overwriting it. `DELETE …/{assignmentId}` sets `assigned_to`. |

### 8.9 `/vehicle-categories` and `/reference/*` (10)

Reference data is cacheable: `GET` responses carry `ETag` and `Cache-Control: public, max-age=300, stale-while-revalidate=3600`, and honour `If-None-Match` with `304`. This is the only part of the API that is publicly cacheable.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/vehicle-categories` | `reference.read` | public | 16 seeded categories. Filters: `transportType`, `isActive`. Public so the marketing site and the unauthenticated request form can render them. |
| POST | `/vehicle-categories` | `reference.manage` | global | Create a category. `PATCH /vehicle-categories/{id}` and `DELETE` (deactivate) share the route file. |
| GET | `/reference/regions` | `reference.read` | public | 13 KSA administrative regions, `nameEn`/`nameAr`. |
| GET | `/reference/cities` | `reference.read` | public | Filters: `regionId`, `q`, `isActive`. Returns `latitude`/`longitude` for map centring. |
| GET | `/reference/vehicle-makes` | `reference.read` | public | `POST` (create) requires `reference.manage`. |
| GET | `/reference/vehicle-models` | `reference.read` | public | Filter `makeId`. `POST` requires `reference.manage`. |
| GET | `/reference/document-types` | `reference.read` | — | Filters: `appliesTo`, `isActive`. Returns `requiresExpiry`, `isMandatory`, `maxSizeBytes`, `allowedMimeTypes` — the client builds its uploader constraints from this, and the server re-enforces them. `POST`/`PATCH` require `reference.manage`. |
| GET | `/reference/expense-categories` | `reference.read` | — | `POST`/`PATCH` require `reference.manage`. |
| GET | `/reference/maintenance-service-types` | `reference.read` | — | `POST`/`PATCH` require `reference.manage`. |
| GET | `/reference/enums` | `reference.read` | — | Every domain enum and its legal transition map, as JSON. Lets the web and mobile clients render status badges and disable impossible actions without hard-coding the lifecycles from [database.md](database.md). Strongly cached. |

### 8.10 `/documents` (8)

**File bytes never pass through the API.** Uploads are a presigned two-step; downloads are a short-lived signed URL. The API holds metadata, authorization and verification state; the object store holds bytes.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| POST | `/documents/upload-url` **†** | `documents.upload` | own | Step 1: validate type/size/MIME against `document_types`, create a `PENDING` row with a server-generated `storage_key`, return a presigned `PUT` URL. |
| POST | `/documents/{id}/confirm` **†⧗** | `documents.upload` | own | Step 2: verify the object exists, its size and checksum match, and its magic bytes match the declared MIME. `PENDING` → `UPLOADED`; queues the AV scan. |
| GET | `/documents` | `documents.read` | own → global | List. Filters: `documentTypeCode`, `verificationStatus`, `uploadStatus`, `vehicleId`, `driverProfileId`, `ownerProfileId`, `userId`, `expiringWithinDays`. `documents.read_any` lifts the scope. |
| GET | `/documents/{id}` | `documents.read` | own → global | Metadata only. Never the storage key, never a URL. |
| GET | `/documents/{id}/download-url` **†** | `documents.read` | own → party → global | Issue a 120-second signed `GET` URL. `documents.download_any` permits cross-tenant download; `visibility = SHARED_WITH_COUNTERPARTY` permits the booking counterparty. Every issuance is audited. |
| POST | `/documents/{id}/verify` | `documents.verify` | global | `PENDING` → `VERIFIED`. Requires `expiryDate` when `document_types.requires_expiry`. Audited (BRIEF-§26). |
| POST | `/documents/{id}/reject` | `documents.verify` | global | → `REJECTED` with `rejectionReason`. Notifies the owning party. |
| GET | `/documents/requirements` | `documents.read` | own | Checklist for a target (`?appliesTo=VEHICLE&targetId=…`): every mandatory `document_types` row with its current status — `MISSING`, `PENDING`, `VERIFIED`, `REJECTED`, `EXPIRED`. Drives the onboarding progress UI and is the same query the submit-for-approval guard runs. |

`DELETE /documents/{id}` exists under `documents.delete` and is a soft delete; it is refused for any document referenced by a `VERIFIED` approval decision.

### 8.11 `/trip-requests` (11)

`trip_request_status` is `DRAFT`, `PUBLISHED`, `PARTIALLY_AWARDED`, `FULLY_AWARDED`, `COMPLETED`, `CLOSED_PARTIAL`, `CANCELLED`, `EXPIRED` ([database.md §8.4](database.md)). **`PARTIALLY_AWARDED` is a stable resting state, not a transition** (**A-45**): a request for 5 vehicles with 2 awarded stays open indefinitely, keeps attracting bids for the balance, and is never expired by the sweeper. Cancelling an awarded booking decrements `vehiclesAwarded` and moves `FULLY_AWARDED → PARTIALLY_AWARDED`, reopening the request with no manual re-publish. Only the customer (or an admin acting for them) closes an unfilled balance.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/trip-requests` | `trip_requests.read` | own → global | Customers see their own; `trip_requests.read_any` sees all. Filters: `status`, `transportType`, `vehicleCategoryId`, `pickupCityId`, `allowPartialFulfilment`, `hasOpenRemainder` (boolean — `vehiclesAwarded > 0 AND vehiclesAwarded < vehiclesRequired`), `dateFrom`/`dateTo` (on `pickup_at`), `q` (request number). |
| POST | `/trip-requests` **†⧗** | `trip_requests.create` | own | Create a request with its `PASSENGER` or `GOODS` detail block. Optionally publishes immediately. |
| GET | `/trip-requests/{id}` | `trip_requests.read` | own → party → global | Full request incl. the detail block. An owner who holds an invitation sees the request through this endpoint with pickup contact details **redacted** until a bid of theirs is accepted. |
| PATCH | `/trip-requests/{id}` | `trip_requests.update` | own | Editable only in `DRAFT`. After `PUBLISHED`, changing commercial terms would invalidate live bids; the customer must cancel and re-raise. |
| POST | `/trip-requests/{id}/publish` | `trip_requests.update` | own | `DRAFT` → `PUBLISHED`. Runs the matcher, writes `trip_request_invitations`, emits `trip_request.published` to the outbox. |
| POST | `/trip-requests/{id}/cancel` | `trip_requests.cancel` | own → global | → `CANCELLED` with a reason. Rejects all `SUBMITTED` bids and notifies their owners. Refused once `vehiclesAwarded > 0` — cancel the bookings individually, or close the remainder. |
| POST | `/trip-requests/{id}/award` **†⧗** | `bids.accept` | own(customer) → global | **All-or-nothing group award.** Accepts an array of bid IDs covering the entire remainder in one transaction: every booking is created, or none is. The only way to award a request with `allowPartialFulfilment: false`. Optional `commissionOverride` (admin callers with `commissions.override` only, else `403 COMMISSION_OVERRIDE_FORBIDDEN`) applies to this award's bookings and beats the request-level override. |
| POST | `/trip-requests/{id}/close-remainder` **†⧗** | `trip_requests.update` | own → global | `PARTIALLY_AWARDED` → `CLOSED_PARTIAL`. The customer (or an admin acting for them) declares the unfilled balance abandoned. Rejects the remaining live bids and stops the opportunity feed. **The system never does this on its own** ([database.md §8.4](database.md)). |
| PATCH | `/trip-requests/{id}/remainder` **†** | `trip_requests.update` | own → global | Adjust `vehiclesRequired` and/or `remainderClosesAt` while `PARTIALLY_AWARDED`. Reducing `vehiclesRequired` below `vehiclesAwarded` → `422 RULE_VEHICLES_REQUIRED_BELOW_AWARDED`. Setting `vehiclesRequired = vehiclesAwarded` closes the order into `FULLY_AWARDED`. |
| GET | `/trip-requests/{id}/bids` | `bids.read` | own(customer) → global | The comparison list (BRIEF-§12): `totalAmount`, `estimatedArrivalAt`, vehicle summary, `vehicleRatingAvg`, `ownerRatingAvg`, `validUntil`. Default sort `totalAmount asc`. While `PARTIALLY_AWARDED` this list still returns live bids competing for the balance — siblings are rejected only at full award. Owners cannot use this endpoint to read rival bids — for an owner the scope filters to their own rows. |
| GET | `/trip-requests/{id}/invitations` | `trip_requests.read_any` | global | Which owners were matched, their `matchScore` and `matchReason`, whether they viewed or dismissed. Ops tool for "I never saw that request" disputes. |

`DELETE /trip-requests/{id}` deletes a `DRAFT` only, under `trip_requests.cancel`; `204`.

Every request DTO carries the fulfilment counters — `vehiclesRequired`, `vehiclesAwarded`, `vehiclesDispatched`, `vehiclesCompleted`, `vehiclesCancelled` — plus `allowPartialFulfilment` and `remainderClosesAt`. `vehiclesCancelled` is cumulative and never decremented; it is a fulfilment-reliability signal, not a live count. There is no `awardedCount` field: the counter is `vehiclesAwarded`, matching `trip_requests.vehicles_awarded`.

### 8.12 `/opportunities` — the owner's view of demand (3)

An opportunity is a `trip_request_invitations` row joined to its request. It exists as its own path because the owner portal's Opportunities screen (BRIEF-§35) has different sorting, filtering and lifecycle from the customer's request list.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/opportunities` | `trip_requests.read` | own | Open invitations for the acting owner. Filters: `transportType`, `vehicleCategoryId`, `pickupCityId`, `pickupFrom`/`pickupTo`, `hasBid` (boolean), `closingWithinHours`. Default sort `matchScore desc`. |
| GET | `/opportunities/{id}` | `trip_requests.read` | own | The request detail plus `matchReason`, the owner's eligible vehicles for it, and their own existing bid if any. Marks `viewed_at` on first read. |
| POST | `/opportunities/{id}/dismiss` | `opportunities.dismiss` | own | Sets `dismissed_at`; removes it from the default list and suppresses reminder notifications. Reversible with `?undo=true`. |

### 8.13 `/bids` (7)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/bids` | `bids.read` | own → global | Owners see their own bids; customers see bids on their own requests; `bids.read_any` sees all. Filters: `status`, `tripRequestId`, `vehicleId`, `dateFrom`/`dateTo`, `minAmount`/`maxAmount`. |
| POST | `/bids` **†⧗** | `bids.create` | own | Submit a bid. Totals are server-computed from `baseAmount` + `extrasBreakdown` + the snapshotted `vatRate`. |
| GET | `/bids/{id}` | `bids.read` | party → global | Full bid incl. `extrasBreakdown`, vehicle and driver summary. |
| PATCH | `/bids/{id}` **⧗** | `bids.update` | own | Revise a `SUBMITTED` bid: increments `version`, sets `last_revised_at`, recomputes totals, keeps `status = SUBMITTED` (V4). Refused after `bidding_closes_at`. Notifies the customer that the bid changed. |
| POST | `/bids/{id}/withdraw` | `bids.withdraw` | own | → `WITHDRAWN`. Refused if already `ACCEPTED`. |
| POST | `/bids/{id}/accept` **†⧗** | `bids.accept` | own(customer) → global | The concurrency-critical path: creates one booking, reserves the vehicle, freezes finance (rule, request override or inline `commissionOverride` — admin callers only), and — for `INVOICED` customers — runs the credit check inside the same transaction. Refused with `422 RULE_PARTIAL_AWARD_NOT_ALLOWED` on a request with `allowPartialFulfilment: false`; use `POST /trip-requests/{id}/award`. |
| POST | `/bids/{id}/reject` | `bids.accept` | own(customer) → global | → `REJECTED` with an optional reason. A courtesy rejection; siblings are auto-rejected only when the request becomes `FULLY_AWARDED` or the remainder is closed. |

### 8.14 `/bookings` (12)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/bookings` | `bookings.read` | own → global | Worked in §6.5. Filters: `status`, `paymentStatus`, `billingMode`, `transportType`, `customerProfileId`, `ownerProfileId`, `vehicleId`, `driverProfileId`, `tripRequestId`, `fulfilmentSequence`, `dateFrom`/`dateTo` (on `scheduled_start_at`), `q` (booking number). Filtering by `tripRequestId` is how a client renders one order's dispatch waves. |
| POST | `/bookings` **⧗** | `bookings.create` | global | Admin-created booking outside the bidding flow (phone order). Requires an explicit vehicle, period and agreed amounts; takes the same calendar reservation and financial snapshot path as bid acceptance. |
| GET | `/bookings/{id}` | `bookings.read` | party → global | Snapshot fields are authoritative for display (BRIEF-§13). Customer, owner and driver each receive a different projection of the same row. Carries `billingMode` (`PREPAID` \| `INVOICED`, snapshotted at award) and `fulfilmentSequence` (1-based dispatch wave of the parent order), plus `invoiceId`/`invoiceNumber` once billed. |
| PATCH | `/bookings/{id}` | `bookings.manage` | global | Ops-only corrections: `specialInstructions`, contact details, scheduled window (which re-attempts the calendar entry and can 409). Commercial amounts are **immutable**. |
| POST | `/bookings/{id}/confirm` | `bookings.manage` | global | `PENDING_PAYMENT` → `CONFIRMED` as an ops override (offline payment reconciled, fee waived). The normal `PREPAID` path is automatic, on gateway-confirmed payment; an `INVOICED` booking never passes through `PENDING_PAYMENT` at all and so never reaches this route (**A-46**). |
| POST | `/bookings/{id}/cancel` **†⧗** | `bookings.cancel` | party → global | Cancel with fee computation and optional refund initiation. |
| POST | `/bookings/{id}/assign-driver` **⧗** | `bookings.assign_driver` | own(owner) → global | `CONFIRMED` → `DRIVER_ASSIGNED`. Validates the driver is approved, licensed, assigned to the vehicle and not already on a conflicting trip. Creates the `trips` row. |
| POST | `/bookings/{id}/ready` | `bookings.manage` | own(owner) → global | `DRIVER_ASSIGNED` → `READY`. Pre-dispatch checks passed. |
| POST | `/bookings/{id}/dispute` | `complaints.create` | party → global | `IN_PROGRESS`/`COMPLETED` → `DISPUTED`, opening a linked complaint. `POST …/resolve-dispute` (`complaints.manage`) returns it to `COMPLETED` or moves it to `REFUNDED`. |
| GET | `/bookings/{id}/status-history` | `bookings.read` | party → global | `booking_status_history`, append-only, with actor and reason. |
| GET | `/bookings/{id}/financials` | `commissions.read` | party → global | The `booking_financial_snapshots` row. **Projected by role**: the customer sees gross/VAT/total; the owner sees gross, commission, commission VAT, payment fee and `ownerNetAmount`; finance staff see everything including `commissionRuleSnapshot`. |
| POST | `/bookings/{id}/no-show` **†⧗** | `bookings.cancel` | global | Ops records a **customer or owner no-show** (`party: CUSTOMER \| OWNER`, usually from a trip exception). Writes a `NO_SHOW` cancellation row, resolves the `cancellation_policies` charge for that party (production default: none), and — for an owner no-show — refunds the customer in full and queues the owner deduction as a settlement adjustment. Optional `feeOverride`. **OQ-05.** |
| POST | `/bookings/{id}/cancellation/waive-fee` **†** | `bookings.cancel` | global | **Per-case admin decision:** waive a computed cancellation or no-show fee with a mandatory reason, before the refund is processed / settlement line approved (`409 CANCELLATION_FEE_LOCKED` after). Audited `NOTICE`. **OQ-05.** |
| GET | `/bookings/{id}/cancellation-quote` | `bookings.read` | party → global | Dry run of the cancellation fee under the **currently effective admin policy**: `hoursBeforePickup`, `feeAmount`, `refundAmount`, `feeRuleSnapshot`, `feeSource`. Read-only, no state change — so the confirmation dialog shows the customer exactly what `POST …/cancel` will do. **OQ-05**. |

### 8.15 `/trips` (8)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/trips` | `trips.read` | own → party → global | Drivers see their assigned trips; owners their fleet's; customers their own. Filters: `status`, `transportType`, `vehicleId`, `driverProfileId`, `bookingId`, `dateFrom`/`dateTo`. |
| GET | `/trips/active` | `trips.read` | own → global | Trips currently in a non-terminal state, with last known position. The owner dashboard and the admin live-operations board both call this. |
| GET | `/trips/{id}` | `trips.read` | party → global | Trip + booking summary + driver and vehicle summary + current status. |
| POST | `/trips/{id}/status` **†⧗** | `trips.update_status` | party → global | The single state-transition endpoint for the trip lifecycle. |
| GET | `/trips/{id}/status-history` | `trips.read` | party → global | `trip_status_history` with the coordinates captured at each transition — what makes a delivery dispute resolvable. |
| PATCH | `/trips/{id}` | `trips.update_status` | party → global | `driverNotes`, `customerNotes`, `startOdometerKm`, `endOdometerKm`. Notes are append-only in effect: edits are audited with before/after. |
| POST | `/trips/{id}/cancel` | `trips.manage` | global | Any state → `CANCELLED` with a reason. Releases the calendar entry, cascades to the booking, triggers the refund assessment. |
| POST | `/trips/{id}/proofs` | `trips.update_status` | party → global | Record a `TripProof` (`PICKUP_CONFIRMATION`, `DELIVERY_CONFIRMATION`, `DAMAGE_REPORT`, `EXCEPTION`) with recipient, coordinates and linked document IDs. `GET` on the same path lists them. Architected now, UI later (BRIEF-§14, V9). |

### 8.16 `/tracking` (7)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| POST | `/tracking/ping` **†** | `tracking.publish` | party | Driver app or GPS gateway posts a position sample. Highest-volume endpoint in the system. |
| POST | `/tracking/ping/batch` | `tracking.publish` | party | Up to 200 buffered samples from a device that was offline. Same validation and sampling rules; points older than the reorder tolerance are dropped individually with a per-item result, not a whole-batch rejection. |
| GET | `/tracking/trips/{id}` **†** | `tracking.read` | party → global | Live position + status + ETA for one trip. The customer's tracking screen. |
| GET | `/tracking/trips/{id}/history` | `tracking.read` | party → global | Cursor-paginated `vehicle_location_points` for replay. Retained 12 months (A-12). |
| GET | `/tracking/vehicles/{id}` | `tracking.read_any` | global | Live position of a vehicle irrespective of trip. Ops/fleet only — a customer can only ever track through a trip they are party to (BRIEF-§15). |
| GET | `/tracking/vehicles` | `tracking.read_any` | global | Fleet live map: last known position of every vehicle matching a filter (`ownerProfileId`, `cityId`, `operationalStatus`, `movedWithinMinutes`). Served from the Redis mirror. |
| POST | `/tracking/sessions/{id}/end` | `tracking.publish` | party → global | Close a `tracking_sessions` row (`ENDED` or `INTERRUPTED`), finalising `point_count` and `total_distance_km`. Sessions are opened automatically at trip start. |

### 8.17 `/payments` (8)

> **Payment success is established by the gateway webhook and by nothing else** (BRIEF-§17, §10 below). No endpoint in this section allows a client to assert that a payment succeeded.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| POST | `/payments` **†⧗** | `payments.create` | own(customer) → global | Initiate payment for **either** a booking (`bookingId`) **or** an invoice (`invoiceId`) — never both, never neither. Returns a `PENDING` payment and a provider redirect/SDK payload. |
| GET | `/payments` | `payments.read` | own → global | Filters: `status`, `bookingId`, `invoiceId`, `customerProfileId`, `providerCode`, `paymentMethodType`, `dateFrom`/`dateTo`, `minAmount`/`maxAmount`. |
| GET | `/payments/{id}` | `payments.read` | party → global | Payment aggregate. `paymentMethodLast4` only; no PAN, no token, ever. |
| GET | `/payments/{id}/status` | `payments.read` | party → global | Lightweight poll for the checkout return page: `{ status, paidAt, failureCode }`. Reads local state — it does **not** call the gateway (that is `/sync`). |
| POST | `/payments/{id}/sync` | `payments.manage` | global | Reconciliation: call `PaymentGateway.getPaymentStatus()` and apply the authoritative result. Used by the reconciliation job and by support for stuck payments. |
| POST | `/payments/{id}/cancel` **⧗** | `payments.manage` | party → global | Cancel a `PENDING` payment (abandoned checkout). `409 PAYMENT_ALREADY_CAPTURED` if it has settled. |
| GET | `/payments/{id}/transactions` | `payments.read_any` | global | `payment_transactions` attempt log with redacted request/response payloads. Support and finance only. |
| GET | `/payments/config` | `payments.read` | — | Client-safe payment configuration: enabled `methodTypes`, provider code, publishable key, currency, 3-DS behaviour. `PUT /payments/config` requires `payments.config.manage`. **Never returns a secret** (`system_settings.scope = SECRET` is filtered out unconditionally). |

Saved instruments live at `GET`/`POST`/`DELETE /payments/methods/saved` under `payments.read` / `payments.create`, scoped `own`; they store `payment_method_tokens` (gateway tokens only) and are counted within this module's 8.

### 8.18 `/refunds` (5)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/refunds` | `payments.read` | own → global | Filters: `status`, `paymentId`, `bookingId`, `reasonCode`, `dateFrom`/`dateTo`. |
| POST | `/refunds` **⧗** | `payments.refund` | global | Create a `REQUESTED` refund against a payment. Validates Σ refunds ≤ captured amount inside a `FOR UPDATE` on the payment → `422 REFUND_EXCEEDS_CAPTURED`. Customer-initiated refunds arrive through `POST /bookings/{id}/cancel`, not here. |
| GET | `/refunds/{id}` | `payments.read` | party → global | |
| POST | `/refunds/{id}/approve` **⧗** | `payments.refund` | global | `REQUESTED` → `APPROVED`. Four-eyes: the approver may not be `requested_by_user_id`. `POST …/reject` shares the route. |
| POST | `/refunds/{id}/process` **⧗** | `payments.refund` | global | `202`. Enqueues `PaymentGateway.refundPayment()`. Terminal state is set by the gateway's refund webhook, not by the job's own return value. |

### 8.19 `/invoices` (12)

**An invoice is a header plus lines covering many bookings over a billing period** (**A-46**, [database.md §12.6](database.md)) — it is not one-invoice-per-booking. A `PREPAID` booking still produces an invoice; it is simply a single-line invoice issued at payment rather than a consolidated one issued at period end. One code path, two triggers.

`invoice_status` is `DRAFT`, `PENDING_CLEARANCE`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOID`, `CREDITED`, `CLEARANCE_FAILED`. `invoiceType` is `TAX_INVOICE`, `SIMPLIFIED_TAX_INVOICE`, `CREDIT_NOTE`, `DEBIT_NOTE`. Every invoice DTO carries `subtotalAmount`, `vatAmount`, `totalAmount`, `paidAmount`, `outstandingAmount`, `currency`, `issueDate`, `supplyDate`, `dueDate` and `billingPeriodStart`/`billingPeriodEnd`, plus the e-invoicing block below.

#### Two flows, and why one of them blocks delivery

> **No compliance is claimed.** What follows is the delivery team's understanding of the Saudi e-invoicing regime, used to shape the contract so that compliance is *achievable* without a v2. **Applicability, wave and obligations are for UniGate's tax advisor to confirm — OQ-04.** Nothing in this section asserts that the platform is compliant.

UniGate is the invoice issuer and supplies VAT-reclaim invoices (**A-49**). Our understanding is that this splits into two flows with very different timing:

| Buyer | `invoiceType` | Flow | Status path |
|---|---|---|---|
| Holds a VAT registration (`customerProfile.vatNumber` present) | `TAX_INVOICE` (and its `DEBIT_NOTE`/`CREDIT_NOTE` corrections) | **Clearance** — submitted and cleared by the authority *before* the document may be given to the buyer. Blocking. | `DRAFT` → `PENDING_CLEARANCE` → `ISSUED`, or → `CLEARANCE_FAILED` |
| No VAT registration | `SIMPLIFIED_TAX_INVOICE` | **Reporting** — issued immediately, submitted afterwards. Non-blocking. | `DRAFT` → `ISSUED`, `clearanceStatus` reaching `REPORTED` asynchronously |

Three consequences are load-bearing on this contract:

1. **Type is resolved at issue time, never on request.** The system reads the buyer's VAT registration when the invoice is created; the client does not choose. There is no "generate me a tax invoice" endpoint, because a tax invoice minted months after the supply was never cleared at the time and the buyer's entitlement to reclaim input VAT depends on holding one that was. **"On request" is served by re-delivering an invoice that already exists** — `GET /invoices/{id}/pdf-url`, not a generation call ([ADR-007](decisions/ADR-007-e-invoicing.md)).
2. **A standard invoice is undeliverable until cleared.** `GET /invoices/{id}/pdf-url` and `GET /invoices/{id}/xml` return `409 INVOICE_NOT_CLEARED` while `clearanceStatus = PENDING`. This is not a cache miss to retry around: the customer's document is rendered from the **authority-returned** artefact (`clearedXmlDocumentId`), not from our own copy, so before clearance there is nothing correct to serve.
3. **Invoices are immutable past `DRAFT`.** No edit, no recalculation, no re-render — `409 INVOICE_IMMUTABLE`. `icv` and `previousInvoiceHash` chain each invoice to its predecessor, so a number cannot be silently reused or a bad row quietly deleted; a failure rests in `CLEARANCE_FAILED` as a retained state. Corrections are forward-only: a `CREDIT_NOTE` to reduce, a `DEBIT_NOTE` to increase.

The e-invoicing block on every invoice DTO — `null` throughout for an invoice whose `clearanceStatus` is `NOT_REQUIRED`:

| Field | Type | Notes |
|---|---|---|
| `einvoiceUuid` | uuid \| null | Per-invoice UUID, distinct from `id` |
| `icv` | integer \| null | Invoice counter value — strictly sequential, gapless |
| `invoiceHash` | string \| null | This invoice's hash |
| `previousInvoiceHash` | string \| null | Hash of the preceding invoice; makes omission or reordering detectable |
| `qrCodeTlv` | string \| null | TLV-encoded, base64 QR payload as rendered on the document |
| `clearanceStatus` | enum | `NOT_REQUIRED`, `PENDING`, `CLEARED`, `REPORTED`, `REJECTED` |
| `clearanceSubmittedAt` / `clearanceCompletedAt` | timestamp \| null | |
| `xmlDocumentId` | uuid \| null | The generated UBL 2.1 XML, a `documents` row |
| `clearedXmlDocumentId` | uuid \| null | The authority-returned cleared XML — **this, not our copy, is the artefact the customer receives** |

> **`cryptographicStamp`, the onboarding credentials and the raw clearance request/response are never exposed on any endpoint, to any permission, at any scope.** They are not filtered by a DTO field list a future refactor could drop — the serialiser never sees them, in the same manner as `SECRET`-scoped settings (§8.31) and `iban_encrypted`. A stamp is a signing artefact, not invoice data; `clearance_response` is retained in the database for audit and is read there, not through the API. Buyer and seller VAT numbers **are** returned on the invoice, because they are printed on the document itself.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/invoices` | `invoices.read` | own → global | Filters: `invoiceType`, `status`, `clearanceStatus`, `bookingId` (matches any `BOOKING` line), `issuedToCustomerProfileId`, `corporateCustomerProfileId`, `overdueOnly`, `dueFrom`/`dueTo`, `dateFrom`/`dateTo` (on `issue_date`), `minOutstanding`. |
| GET | `/invoices/{id}` | `invoices.read` | party → global | Invoice header incl. `outstandingAmount`, `dueDate`, seller/buyer VAT numbers and the e-invoicing block above. Readable at every status — a buyer may see that their invoice is `PENDING_CLEARANCE`; what they may not do is *download* it (see `…/pdf-url`). |
| GET | `/invoices/{id}/lines` | `invoices.read` | party → global | `invoice_lines` in `sort_order`: `lineType` (`BOOKING`, `ADJUSTMENT`, `PENALTY`, `DISCOUNT`), `bookingId`/`bookingNumber`, bilingual description, `quantity`, `unitAmount`, `netAmount`, `vatRate`, `vatAmount`, `totalAmount`. Paginated; a monthly corporate invoice can carry hundreds of lines. |
| POST | `/invoices` **⧗** | `invoices.issue` | global | Issue a single-booking invoice for a `COMPLETED` booking (the `PREPAID` trigger, and the ad-hoc corporate case). **Resolves `invoiceType` from the buyer's `vatNumber`**, consumes the next gapless number and the next `icv` from a sequence inside the transaction, chains `previousInvoiceHash`, then clears (standard) or reports (simplified). Returns `201` with `status: PENDING_CLEARANCE` for a standard invoice — issuance is not complete when the call returns. `409 INVOICE_ALREADY_ISSUED` / `409 INVOICE_BOOKING_ALREADY_BILLED` on a second attempt; `503 CLEARANCE_PROVIDER_UNAVAILABLE` if clearance cannot be reached, with the invoice left in `PENDING_CLEARANCE` for the retry job. |
| POST | `/admin/invoices/generate` **†⧗** | `invoices.issue` | global | `202`. Run a **billing cycle**: consolidate every unbilled `COMPLETED` `INVOICED` booking in a period into one invoice per customer, resolve each invoice's type, assign `icv`, chain hashes, and submit for clearance or reporting. The primary corporate billing path. |
| GET | `/invoices/{id}/pdf-url` | `invoices.read` | party → global | 120-second signed URL for the rendered PDF, by the identical mechanism and TTL as `GET /documents/{id}/download-url`. Every issuance is audited. **`409 INVOICE_NOT_CLEARED` while `clearanceStatus = PENDING`** on a standard invoice, and `422 INVOICE_CLEARANCE_REJECTED` when it is `REJECTED` — in neither case does a deliverable document exist. Once `CLEARED`, the PDF is rendered from `clearedXmlDocumentId` and cached. Simplified invoices are downloadable immediately; their reporting runs behind the response. |
| GET | `/invoices/{id}/xml` | `invoices.read` | party → global | 120-second signed URL for the **cleared** UBL 2.1 XML (`clearedXmlDocumentId`). This is the machine-readable artefact a corporate buyer's own accounting system ingests, which is why it is a customer-facing route and not an admin one. Same `409 INVOICE_NOT_CLEARED` gate as `…/pdf-url`. `404 NOT_FOUND` when `clearanceStatus = NOT_REQUIRED` — there is no XML for an invoice that was never submitted. Audited per issuance. |
| POST | `/invoices/{id}/void` **⧗** | `invoices.issue` | global | `DRAFT`, `CLEARANCE_FAILED`, or `ISSUED`/`OVERDUE` **while `clearanceStatus = NOT_REQUIRED`** → `VOID` with a `reason`. **Refused once any money has been received** (`422 INVOICE_NOT_VOIDABLE`) and **refused once the authority holds it** (`409 INVOICE_ALREADY_CLEARED` for `CLEARED`/`REPORTED`) — a submitted invoice is corrected with a credit note, never erased. The number is **not** reused; voiding preserves the gapless sequence and the `icv` chain. Releases `uq_invoice_lines_booking`, so the bookings become billable again. |
| POST | `/invoices/{id}/credit-note` **⧗** | `invoices.issue` | global | Issue a linked `CREDIT_NOTE` (`corrects_invoice_id`) **reducing** all or part of an issued invoice, with per-line amounts and a `reason`. Consumes its own gapless number and `icv`, and follows the source invoice's flow — a credit note against a `TAX_INVOICE` is itself cleared before delivery. Moves the source to `CREDITED` when fully credited; reduces `outstandingAmount` when partial. Posts a reversing entry against `CUSTOMER_RECEIVABLE`, which immediately restores available credit. |
| POST | `/invoices/{id}/debit-note` **⧗** | `invoices.issue` | global | Issue a linked `DEBIT_NOTE` **increasing** an already-issued invoice — an undercharge, a post-hoc waiting-time charge, a penalty agreed after billing. Mirror image of the credit note: own gapless number and `icv`, same clearance flow, a `reason` required, and it posts an *additional* `CUSTOMER_RECEIVABLE` debit, so it **consumes credit headroom and can therefore be refused by the credit check** (`422 RULE_CREDIT_LIMIT_EXCEEDED`). A `VOID` or `DRAFT` source is refused with `422 VALIDATION_FAILED` naming the source status — there is nothing to increase. |
| POST | `/admin/invoices/{id}/retry-clearance` **⧗** | `invoices.issue` | global | `202`. Resubmit a `CLEARANCE_FAILED` or stuck `PENDING_CLEARANCE` invoice **without minting a new number or a new `icv`** — the same document is re-presented, because consuming a second number to fix the first would break the chain. `409 INVOICE_ALREADY_CLEARED` when `clearanceStatus` is already `CLEARED`/`REPORTED`. A rejection that is not transient (a malformed buyer VAT number, say) will fail again identically; the fix is a void plus a re-issue, which the response says explicitly rather than leaving an operator to retry a losing call. |
| GET | `/admin/invoices/clearance-queue` | `invoices.issue` | global | The operational view of everything not yet through: invoices in `PENDING_CLEARANCE` or `CLEARANCE_FAILED` with `clearanceStatus`, `clearanceSubmittedAt`, `attemptCount`, `ageSeconds`, the last authority error code, and the buyer. Filters: `clearanceStatus`, `invoiceType`, `minAgeSeconds`, `customerProfileId`. Sorted oldest-first by default, because the oldest unresolved invoice is the one with a deadline problem. This is the screen a clearance outage is worked from, and the query behind the alert on **AR-9**. |

> **Why `void` and `credit-note` are two endpoints and not one flag.** A void says "this document should never have existed"; a credit note says "it existed and is now partly or wholly reversed". Tax authorities treat them differently and so must the ledger — a void posts nothing, a credit note posts a reversal. Collapsing them into `PATCH /invoices/{id}` with a status field would let a client turn a settled receivable into a non-event (P2). Clearance sharpens this: past clearance, void is simply unavailable, and `PATCH /invoices/{id}` does not exist at all (`409 INVOICE_IMMUTABLE`).

> **Why `clearance-queue` and `retry-clearance` sit under `invoices.issue` and not a new code.** Both are acts of issuance — one observes invoices mid-issue, the other completes an issue that stalled. A separate `invoices.clearance.manage` code would have to be granted to exactly the people who already hold `invoices.issue`, and a permission nobody holds independently is a permission that only adds a seeding step. They are grouped with `/invoices` rather than `/admin/*` for the same reason as `POST /admin/invoices/generate`: admin-only path, finance module, one route file.

> **Implemented (Phase 11) — notes that sharpen the table above.** Postings are made when an invoice becomes ISSUED (after clearance for a standard invoice), never at DRAFT; a void of an ISSUED invoice that was never submitted (`NOT_REQUIRED`) therefore posts a **reversing** group so the receivable disappears with the document — "void posts nothing" holds for everything that never reached ISSUED. A credit note is limited to the outstanding balance (received money goes back through `/refunds`) and the platform bears it (DEBIT `REFUNDS_ISSUED`); a debit note is **itself payable** (its own `outstandingAmount`, so `ck_invoices_outstanding` on the source is never violated). The seller VAT number is `finance.seller_vat_number` — empty answers `422 INVOICE_SELLER_VAT_NOT_CONFIGURED`. Numbers and `icv` are minted as MAX+1 under a transaction advisory lock, which is what makes them gapless under rollback. `pdf-url` / `xml` apply the gates above and then answer `501 INVOICE_RENDERING_NOT_AVAILABLE` until the certified adapter lands; the portal renders the document from `/lines`. `EINVOICING_PROVIDER=none` issues plain invoices (`NOT_REQUIRED`, no chain); `mock` is the development stand-in and is refused in production. No compliance is claimed (OQ-04).

### 8.20 `/commissions` (5)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/commissions/rules` | `commissions.read` | global | Filters: `scope`, `vehicleCategoryId`, `ownerProfileId`, `isActive`, `effectiveOn`. |
| POST | `/commissions/rules` | `commissions.manage` | global | Create a rule (`GLOBAL`, `VEHICLE_CATEGORY`, `OWNER`, `OWNER_CATEGORY`) with `calculationType` `NONE` \| `PERCENTAGE` \| `FIXED`. `409 COMMISSION_RULE_OVERLAP` on an identical-scope, overlapping-window duplicate. **OQ-01 answered:** the value is whatever the admin sets; the production seed is a `GLOBAL` `NONE` rule. |
| PATCH | `/trip-requests/{id}/commission` **†** | `commissions.override` | global | **Per-trip admin decision.** Body `{ type: NONE \| PERCENTAGE \| FIXED, value?, basis?, reason }` or `null` to clear. Applies to every booking awarded from this request from now on, including later waves. Guards: `COMMISSION_OVERRIDE_INVALID`, `COMMISSION_OVERRIDE_AFTER_BIDS` (may only lower once bids exist), `COMMISSION_OVERRIDE_LOCKED`. Audited `NOTICE` with before/after. The response echoes `effectiveCommission` — what the next award would actually charge, override or rule. |
| PATCH | `/commissions/rules/{id}` | `commissions.manage` | global | Editing a rule **never** rewrites history — existing `booking_financial_snapshots` hold their own frozen copy (D6). Deactivating the last active `GLOBAL` rule → `422 COMMISSION_GLOBAL_RULE_REQUIRED`. `DELETE` shares this guard. |
| POST | `/commissions/rules/preview` | `commissions.read` | global | Dry run: given an owner, category, transport type and gross amount — and optionally a `commissionOverride` or a `tripRequestId` whose override should apply — return which path resolves (`RULE` \| `OVERRIDE` \| `NONE`) and the resulting split. No writes. Makes rule precedence *and* overrides testable before they touch real money. |
| GET | `/commissions/earnings` | `commissions.read` | own → global | Aggregated commission lines. For an owner, scoped to their own bookings and rendered as *what was deducted*; for finance (`reports.financial.read` also required for cross-tenant totals), as platform revenue. Filters: `ownerProfileId`, `vehicleCategoryId`, `dateFrom`/`dateTo`, `groupBy`. |

### 8.21 `/settlements` and `/ledger` (9)

Settlement cycle and minimum payout are **OQ-06**; the endpoints are period-driven so any cycle is a scheduling concern, not a schema concern.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/settlements` | `settlements.read` | own → global | Owners see their own. Filters: `status`, `ownerProfileId`, `periodFrom`/`periodTo`, `minAmount`. |
| POST | `/settlements` **⧗** | `settlements.create` | global | Build a settlement for `(ownerProfileId, periodStart, periodEnd)`. Inserts `settlement_lines` for every eligible booking; the partial unique index makes double-settlement impossible (`409 SETTLEMENT_BOOKING_ALREADY_SETTLED`). `422 SETTLEMENT_NO_ELIGIBLE_LINES` when the period is empty. |
| GET | `/settlements/preview` | `settlements.read` | own → global | Dry run of the above: eligible bookings, gross, commission, adjustments, net payable — no rows written. Owners use it as "pending settlement" (BRIEF-§19). |
| GET | `/settlements/{id}` | `settlements.read` | own → global | Header + totals + bank account (`ibanLast4`). |
| GET | `/settlements/{id}/lines` | `settlements.read` | own → global | `settlement_lines` with `lineType` and per-booking amounts. `POST` to the same path adds an `ADJUSTMENT`/`PENALTY` line (`settlements.create`, ⧗) while the settlement is `DRAFT`. |
| POST | `/settlements/{id}/submit` **⧗** | `settlements.create` | global | `DRAFT` → `PENDING_APPROVAL`. Freezes the line set. |
| POST | `/settlements/{id}/approve` **⧗** | `settlements.approve` | global | `PENDING_APPROVAL` → `APPROVED`. Four-eyes: approver ≠ creator. `POST …/reject` returns it to `DRAFT` with a reason. |
| POST | `/settlements/{id}/pay` **⧗** | `settlements.pay` | global | `202`. `APPROVED` → `PROCESSING`, records `paymentReference`, posts the `OWNER_PAYABLE` debit set to the ledger. `422 SETTLEMENT_BANK_ACCOUNT_MISSING` without a verified default account. |
| GET | `/ledger/entries` | `ledger.read` | global | `ledger_entries`, append-only, grouped by `transactionGroupId`. Filters: `ledgerAccountCode`, `bookingId`, `paymentId`, `settlementId`, `dateFrom`/`dateTo`. `GET /ledger/balances/owners/{ownerProfileId}` returns the `OWNER_PAYABLE` balance as `SUM(credits) − SUM(debits)` — one query, never drifting from the snapshots. |

> **Platform fleet (A-57, Phase 11).** `POST /trip-requests/{id}/assign-platform-vehicle` (`bookings.manage`, ⧗, body `{ vehicleId, baseAmount, driverProfileId?, extrasBreakdown?, estimatedDurationMinutes?, notes? }`) dispatches one of UniGate's own vehicles without a bid: a bid row is written as the ops decision and the normal award path runs, so the reservation and the frozen snapshot are the shared ones — with **no commission** whatever the rules say. `422 PLATFORM_FLEET_VEHICLE_REQUIRED` for any subcontracted vehicle. Capture and invoice issue post `TRANSPORT_REVENUE` + fare `VAT_PAYABLE` instead of `OWNER_PAYABLE`; the platform owner is never settled (`SETTLEMENT_NO_ELIGIBLE_LINES` with `details.reason = PLATFORM_FLEET`).

> **Implemented (Phase 11).** Eligibility for a `BOOKING_EARNING` line = COMPLETED, funded (PAID for PREPAID; on a live invoice for INVOICED) and past `settlement.hold_days_after_completion`; the preview lists held bookings with the reason. Four-eyes compares the approver with the **submitter** recorded in the audit trail. On the `BANK_TRANSFER` rail the transfer is executed outside the platform, so `POST …/pay` records the reference and lands in **PAID** in the same call (PROCESSING is reserved for the gateway payout rail, which answers `501 SETTLEMENT_PAYOUT_RAIL_NOT_AVAILABLE` until wired); `SETTLEMENT_BANK_ACCOUNT_MISSING` carries `details.reason` MISSING | UNVERIFIED | COOLOFF. `GET /ledger/entries` pages over transaction groups so a page never splits a posting.

### 8.22 `/expenses` (5)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/expenses` | `expenses.read` | own → global | Filters: `expenseCategoryId`, `vehicleId`, `driverProfileId`, `tripId`, `dateFrom`/`dateTo` (on `expense_date`), `minAmount`/`maxAmount`, `isReimbursable`. |
| POST | `/expenses` **⧗** | `expenses.create` | own | Record an expense. `receiptDocumentId` links a previously uploaded `documents` row. VAT is captured separately from the net amount. |
| GET | `/expenses/{id}` | `expenses.read` | own → global | |
| PATCH | `/expenses/{id}` | `expenses.update` | own → global | `409 EXPENSE_IMMUTABLE` once the expense has been included in a `PAID` settlement. `DELETE` (soft, `expenses.delete`) shares the guard. |
| GET | `/expenses/summary` | `expenses.read` | own → global | Totals grouped by `category`, `vehicle` or `month`. Feeds the owner's expense dashboard and vehicle profitability (BRIEF-§19). |

> **Implemented (Phase 11).** `EXPENSE_IMMUTABLE` fires once the expense date falls inside a **PAID** settlement period of the owner (`isLocked` on the DTO); references are resolved through the owning modules under the caller's scope, so a foreign vehicle/driver/trip/document id is a `422` on that field. Reimbursable expenses are flagged only — whether they flow into settlements is UniGate's decision.

### 8.23 `/maintenance` (8)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/maintenance/records` | `maintenance.read` | own → global | Filters: `vehicleId`, `maintenanceKind`, `status`, `serviceTypeId`, `dateFrom`/`dateTo`, `workshopName`. |
| POST | `/maintenance/records` **⧗** | `maintenance.create` | own → global | Create a record. A `PLANNED` or `IN_PROGRESS` record **also inserts a `MAINTENANCE` calendar entry in the same transaction** — so a vehicle under maintenance becomes unbookable structurally (BRIEF-§21). `409 MAINTENANCE_CALENDAR_CONFLICT` names the blocking booking. |
| GET | `/maintenance/records/{id}` | `maintenance.read` | own → global | Record + linked documents + calendar entry. |
| PATCH | `/maintenance/records/{id}` | `maintenance.update` | own → global | Costs, workshop, parts, next-service thresholds. Changing the window re-attempts the calendar entry and can 409. |
| POST | `/maintenance/records/{id}/complete` | `maintenance.update` | own → global | → `COMPLETED`, sets `actual_end_at`, releases the calendar entry, updates the vehicle's `odometer_km` and `operational_status`, and rolls the linked `maintenance_schedules` row forward. `POST …/cancel` shares the route. |
| DELETE | `/maintenance/records/{id}` | `maintenance.delete` | global | Only for `PLANNED` records created in error. Releases the calendar entry. `204`. |
| GET | `/maintenance/schedules` | `maintenance.read` | own → global | Interval definitions per vehicle. `POST`/`PATCH`/`DELETE` under `maintenance.create` / `.update` / `.delete`. |
| GET | `/maintenance/due` | `maintenance.read` | own → global | Vehicles past or approaching `next_due_at` / `next_due_odometer_km`. Filters: `withinDays`, `withinKm`, `overdueOnly`. The reminder job and the owner dashboard share this query. |

### 8.24 `/ratings` (5)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/ratings` | `ratings.read` | party → global | Published ratings for a subject. Filters: `subjectType`, `subjectId`, `bookingId`, `minScore`, `status` (moderators only). Non-moderators see `PUBLISHED` only. |
| POST | `/ratings` | `ratings.create` | party | Rate a driver, vehicle, owner, customer or the trip overall. Eligibility: booking `COMPLETED`, rater is a party in the claimed role, within the rating window (A-10, 14 days). A booking the actor is not party to returns **404**, not 403 — a 403 would confirm the booking exists ([database.md §13.2](database.md)). |
| GET | `/ratings/eligible` | `ratings.create` | own | Completed bookings the actor may still rate, with the subjects available on each and the window deadline. Drives the "rate your trip" prompt without the client guessing the rules. |
| GET | `/ratings/summary` | `ratings.read` | — | Aggregate for a subject: `ratingAvg`, `ratingCount`, score histogram. Recomputed by job on publish, not by trigger. |
| POST | `/ratings/{id}/moderate` | `ratings.moderate` | global | `PUBLISHED` ⇄ `PENDING_REVIEW` ⇄ `HIDDEN` with a reason. Aggregates are recomputed. `DELETE /ratings/{id}` (`ratings.moderate`) hard-hides abusive content. |

### 8.25 `/complaints` (6)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/complaints` | `complaints.read` | own → global | Raisers see their own; `complaints.read_any` sees all. Filters: `status`, `severity`, `category`, `againstType`, `bookingId`, `assignedToUserId`, `dateFrom`/`dateTo`. |
| POST | `/complaints` | `complaints.create` | own | Raise a complaint against a driver, owner, customer, vehicle or the platform. Optionally linked to a booking/trip. Attachments are `documents` rows. |
| GET | `/complaints/{id}` | `complaints.read` | party → global | Detail. **Internal notes are excluded** from every non-admin projection. |
| PATCH | `/complaints/{id}` | `complaints.manage` | global | Severity, category, assignment. `POST /complaints/{id}/assign` is the dedicated assignment route. |
| POST | `/complaints/{id}/status` | `complaints.manage` | global | Transition through `OPEN` → `IN_REVIEW` → `AWAITING_RESPONSE` → `RESOLVED`/`REJECTED` → `CLOSED`, with `resolution` required on resolve. |
| POST | `/complaints/{id}/notes` | `complaints.read` | party → global | Add a note. `isInternal: true` requires `complaints.manage` and the note never leaves the admin portal. `GET` on the same path lists notes the actor may see. |

### 8.26 `/notifications` (7)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/notifications` | `notifications.read` | self | **Cursor-paginated** in-app inbox for `sub`. Filters: `category`, `unreadOnly`, `channel`. |
| GET | `/notifications/unread-count` | `notifications.read` | self | `{ total, byCategory }`. Cheap; polled as a socket fallback. |
| POST | `/notifications/{id}/read` | `notifications.read` | self | Sets `read_at`. `POST /notifications/read-all` marks the whole inbox, optionally filtered by category. |
| DELETE | `/notifications/{id}` | `notifications.read` | self | Remove from the inbox. `204`. |
| POST | `/notifications/send` | `notifications.send` | global | Ops broadcast or targeted send using a template code and audience filter. Goes through the outbox and the normal template renderer — never free text. Requires `Idempotency-Key`. |
| GET | `/notifications/templates` | `notifications.templates.manage` | global | `notification_templates` by `code`, `channel`, `locale`. `POST`/`PATCH` on the same paths edit them so operations can correct wording without a deploy (BRIEF-§23). |
| POST | `/notifications/templates/{id}/preview` | `notifications.templates.manage` | global | Render a template against sample variables in both locales without sending. Catches a broken interpolation before it reaches 4,000 devices. |

### 8.27 `/geo` — maps provider proxy (5)

The maps provider key is **server-side only** (BRIEF-§16). The browser never sees it; every maps call is proxied, quota-accounted per actor, and cached.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/geo/autocomplete` | `geo.use` | — | Address autocomplete. Params: `q`, `cityId`, `sessionToken` (passed through to the provider so a multi-keystroke session bills as one). Results cached 24 h. |
| GET | `/geo/geocode` | `geo.use` | — | Address → coordinates + `placeId`. |
| GET | `/geo/reverse-geocode` | `geo.use` | — | Coordinates → address. Used by the driver app when a pickup pin is dragged. |
| POST | `/geo/route` | `geo.use` | — | Route geometry, distance and duration between two points. Result is cached by rounded coordinate pair; this is what populates `trip_requests.estimated_distance_km`. |
| GET | `/geo/config` | `geo.use` | — | Client-safe map configuration: provider name, map style ID, default centre/zoom, a **restricted** browser key scoped to the platform's origins if the provider requires one. Never the server key. |

`POST /geo/distance-matrix` exists for the matching job and is not exposed to end users; it is an internal service call, not a route.

### 8.28 `/reports` (6)

Reports are asynchronous by construction. There is no endpoint that streams an unbounded result set inline.

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/reports` | `reports.read` | — | The report registry: `code`, name, description, supported filters, supported formats, maximum date span, and the permission each requires. The admin Reports screen is generated from this. |
| GET | `/reports/{code}` | `reports.read` (+ `reports.financial.read` for financial codes) | own → global | Run a report **inline**, paginated, max 200 rows per page. For on-screen viewing. Scope applies: an owner running `owner-earnings` sees only their own. |
| POST | `/reports/{code}/export` **†⧗** | `reports.export` | own → global | `202`. Queue a CSV/XLSX/PDF export job. |
| GET | `/reports/exports` | `reports.export` | self → global | The actor's export jobs with status and expiry. |
| GET | `/reports/exports/{jobId}` | `reports.export` | self → global | Job status: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, with `rowCount` and `errorMessage`. |
| GET | `/reports/exports/{jobId}/download-url` | `reports.export` | self → global | 120-second signed URL for the generated file. Expires with `export_jobs.expires_at` (24 h). Every issuance is audited. |

Report codes (`{code}` above), all BRIEF-§25 items:

| Code | Financial? | Primary scope |
|---|---|---|
| `bookings` | no | own → global |
| `trips` | no | own → global |
| `vehicle-utilisation` | no | own → global |
| `customer-activity` | no | global |
| `vehicle-maintenance` | no | own → global |
| `expenses` | no | own → global |
| `order-fulfilment` | no | own → global |
| `revenue` | **yes** | global |
| `accounts-receivable-ageing` | **yes** | global |
| `commission` | **yes** | global |
| `owner-earnings` | **yes** | own → global |
| `settlements` | **yes** | own → global |
| `payments` | **yes** | global |
| `refunds` | **yes** | global |
| `spo-performance` | **yes** | own → global |

Two codes exist because the confirmed business rules created reporting questions the existing set cannot answer:

| Code | Rows | Why it is its own report |
|---|---|---|
| `order-fulfilment` | One row per trip request: `requestNumber`, `vehiclesRequired`, `vehiclesAwarded`, `vehiclesDispatched`, `vehiclesCompleted`, `vehiclesCancelled`, `fillRate` (`vehiclesCompleted / vehiclesRequired`, 4dp), `waveCount` (distinct `fulfilment_sequence`), `daysToFill`, `status`. Filters: `status`, `transportType`, `allowPartialFulfilment`, `customerProfileId`, `minFillRate`, `dateFrom`/`dateTo`. | Every other report treats the **booking** as the unit. Partial fulfilment makes the **order** a distinct object whose health — did we fill it, in how many waves, how long did the balance sit open — is invisible in a booking-level report (**A-45**, [database.md §8.6](database.md)). This is the report that says whether taking partial orders is working. |
| `accounts-receivable-ageing` | One row per corporate customer: `companyNameEn`, `creditStatus`, `creditLimitAmount`, `outstandingAmount`, then the ageing buckets `current`, `1-30`, `31-60`, `61-90`, `90+` keyed on `invoices.due_date`, plus `oldestInvoiceNumber` and `oldestDueDate`. Filters: `creditStatus`, `minOutstanding`, `asOf`. | Billing in arrears creates a receivable, and a receivable that is not aged is not managed. Balances are summed from `ledger_entries` over `CUSTOMER_RECEIVABLE`, so the report, `GET /customers/{id}/credit` and the credit check inside the award transaction are the **same number by construction** (**A-46**). |

### 8.29 `/admin/*` (9)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/admin/dashboard` | `dashboard.read` | global | The BRIEF-§24 KPI block for a date range: users, customers, owners, drivers, vehicles, active vehicles, trip requests, bids, bookings, active trips, completed trips, cancelled bookings, gross booking value, platform commission, pending settlements. Money as strings. `meta.computedAt` reflects the 60-second cache. |
| GET | `/admin/dashboard/series` | `dashboard.read` | global | Time series for the same measures, bucketed `day`/`week`/`month`. |
| GET | `/admin/roles` | `roles.read` | global | Roles with grant counts. `GET /admin/permissions` (`permissions.read`) lists the seeded permission catalogue grouped by module — this is what the role editor renders. |
| POST | `/admin/roles` | `roles.manage` | global | Create a role. `PATCH`/`DELETE` on `/{id}` refuse `is_system` rows with `409 PERM_ROLE_IMMUTABLE`. Adding a role is data, never code (BRIEF-§5). |
| PUT | `/admin/roles/{id}/permissions` | `permissions.assign` | global | Replace the role's permission set. Bumps `permission_version` for every holder, invalidating `perm:{userId}:{pv}` immediately. Audited with full before/after. |
| GET | `/admin/system/health` | `system.health.read` | global | Deep health: DB pool, Redis, storage, queue depths, outbox backlog, oldest unprocessed webhook, schema migration version. Distinct from the unauthenticated `/health`. |
| GET | `/admin/webhooks/payments` | `payments.manage` | global | `payment_webhook_events` with signature validity and processing status. Filters: `providerCode`, `processingStatus`, `signatureValid`, `dateFrom`/`dateTo`. The primary payment-incident tool. |
| POST | `/admin/webhooks/payments/{id}/replay` | `payments.manage` | global | Re-run the handler for a stored event. Safe by construction — the handler is idempotent on `(provider_code, provider_event_id)`. Refused for `signature_valid = false` rows. |
| POST | `/admin/outbox/{id}/retry` | `platform.jobs.manage` | global | Reset a `FAILED` `outbox_events` row to `PENDING`. `GET /admin/system/queues` (same permission) reports BullMQ depth, failure counts and the outbox backlog. |

### 8.30 `/audit-logs` (3)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/audit-logs` | `audit_logs.read` | global | **Cursor-paginated.** Filters: `actorUserId`, `action`, `entityType`, `entityId`, `severity`, `requestId`, `ipAddress`, `dateFrom`/`dateTo`. `before_value`/`after_value` are already redaction-filtered at write time — there is no code path that could return a password hash or token. |
| GET | `/audit-logs/entities/{entityType}/{entityId}` | `audit_logs.read` | global | The full change history of one record, oldest first. Backed by `audit_logs(entity_type, entity_id, occurred_at DESC)`. This is the "who changed this vehicle's approval status" view. |
| POST | `/audit-logs/export` **⧗** | `audit_logs.read` + `reports.export` | global | `202`. Queue an audit export for a bounded window (max 90 days per job). Exporting the audit trail is itself audited. |

### 8.31 `/settings` (4)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| GET | `/settings/public` | public | public | The `PUBLIC`-scoped subset: VAT rate, supported locales, default currency, min/max booking lead time, maintenance-mode flag. Cached, served to unauthenticated clients so the marketing site and the request form render correctly. |
| GET | `/settings/sections` | `settings.read` | global | The thirteen sections with key counts and last-changed timestamps — the admin portal's settings navigation ([ADR-009](decisions/ADR-009-configuration-over-constants.md)). |
| GET | `/settings` | `settings.read` | global | Filter `?section=bidding`. `PUBLIC` + `INTERNAL` settings with `section`, `valueType`, bilingual description, validation summary and `isCodeManaged`. **`SECRET`-scoped keys are filtered out unconditionally**, before serialisation — not hidden by a DTO field list that a future refactor could drop. |
| PUT | `/settings/{key}` | `settings.manage` | global | Update one setting. Value is validated against `valueType` and a per-key Zod schema **including cross-field rules** (e.g. `bidding.bid_validity_hours ≤ bidding.max_window_hours` — see the catalogue). `409 SETTINGS_KEY_IMMUTABLE` for code-managed keys. Audited `NOTICE` with before/after. **Never rewrites history** — values that affect money or commitments are snapshotted where used. |
| GET | `/settings/{key}/history` | `settings.read` | global | Change history for one key, drawn from `audit_logs`. Commission and VAT changes are the ones auditors ask about. |

### 8.32 Webhooks, health and docs (5)

| Method | Path | Permission | Scope | Description |
|---|---|---|---|---|
| POST | `/webhooks/payments/{provider}` **†** | — | signed | Inbound gateway callback. HMAC-verified, persisted, then processed asynchronously. §10. |
| POST | `/webhooks/tracking/{provider}` | — | signed | Inbound position batch from a GPS hardware vendor's platform (**OQ-11**). Same persist-then-process discipline; feeds the same pipeline as `/tracking/ping`. |
| GET | `/health` | public | public | Liveness. Returns `200 {"status":"ok","version":"…","uptimeSeconds":…}` if the process is running. **Never** touches the database — a liveness probe that depends on Postgres restarts healthy pods during a database blip. |
| GET | `/ready` | public | public | Readiness. Checks Postgres (`SELECT 1`), Redis (`PING`) and storage reachability with a 2-second budget each. `200` when all pass, `503 SERVICE_UNAVAILABLE` with a per-dependency breakdown otherwise. Returns `503` during shutdown drain so the load balancer stops sending traffic before connections are closed. |
| GET | `/docs` | see §1.1 | — | Interactive OpenAPI 3.1 UI. `GET /docs/openapi.json` serves the raw document. Disabled in production by default. |

### 8.33 Endpoint count

| Group | n | Group | n | Group | n |
|---|---|---|---|---|---|
| `/auth` | 12 | `/trip-requests` | 11 | `/expenses` | 5 |
| `/me` | 10 | `/opportunities` | 3 | `/maintenance` | 8 |
| `/users` | 8 | `/bids` | 7 | `/ratings` | 5 |
| `/customers` | 9 | `/bookings` | 12 | `/complaints` | 6 |
| `/owners` | 9 | `/trips` | 8 | `/notifications` | 7 |
| `/drivers` | 8 | `/tracking` | 7 | `/geo` | 5 |
| `/spo` | 6 | `/payments` | 8 | `/reports` | 6 |
| `/vehicles` | 13 | `/refunds` | 5 | `/admin/*` | 9 |
| `/vehicle-categories` + `/reference` | 10 | `/invoices` | 12 | `/audit-logs` | 3 |
| `/documents` | 8 | `/commissions` | 5 | `/settings` | 4 |
| | | `/settlements` + `/ledger` | 9 | webhooks/health/docs | 5 |

**Total: 243.**

`/customers` counts `PATCH /admin/customers/{id}/credit` (and `PATCH /admin/customers/{id}/vat-number`, which shares the `/customers/{id}/verify` row); `/invoices` counts `POST /admin/invoices/generate`, `POST /admin/invoices/{id}/retry-clearance` and `GET /admin/invoices/clearance-queue`. All are admin-only paths but belong to their resource's module and route file, not to the `/admin/*` platform group.

The four added since the last revision are all in `/invoices` (8 → 12): `POST /invoices/{id}/debit-note`, `GET /invoices/{id}/xml`, `POST /admin/invoices/{id}/retry-clearance`, `GET /admin/invoices/clearance-queue` — see §8.19 and [ADR-007](decisions/ADR-007-e-invoicing.md).

---

### 8.34 Detailed endpoint specifications

---

#### `POST /auth/login`

Authenticate with an identifier and a password.

**Request**

```json
{
  "identifier": "+966512345678",
  "password": "correct horse battery staple",
  "clientType": "WEB",
  "deviceId": "0192f3d5-1c22-7f31-a4b8-11c0de2e9f77",
  "deviceName": "Chrome on Windows"
}
```

| Field | Type | Rules |
|---|---|---|
| `identifier` | string | An email (citext, normalised lowercase) or an E.164 phone. The server detects which. |
| `password` | string | 8–256 chars. Never logged, never echoed, redacted in the audit trail. |
| `clientType` | `WEB` \| `IOS` \| `ANDROID` | Determines cookie vs body token transport (§6.2). Immutable for the session's life. |
| `deviceId` | uuid, optional | Stable per install. Lets `GET /me/sessions` show one row per device instead of one per login. |
| `deviceName` | string, optional | Display only, sanitised. |

**Response — mobile mode (`200`)**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "0192f3a0-5e10-7c44-b911-64d2a7e1f003",
      "fullNameEn": "Faisal Al-Harbi",
      "fullNameAr": "فيصل الحربي",
      "email": null,
      "phoneE164": "+966512345678",
      "status": "ACTIVE",
      "preferredLocale": "ar",
      "timezone": "Asia/Riyadh",
      "roles": ["VEHICLE_OWNER"],
      "profiles": { "ownerProfileId": "0192e2b1-0000-7000-8000-0000000000b1" }
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
      "accessTokenExpiresAt": "2026-09-14T11:17:44.817Z",
      "refreshToken": "v1.8f3b2c…",
      "refreshTokenExpiresAt": "2026-10-14T11:02:44.817Z",
      "tokenType": "Bearer"
    },
    "sessionId": "0192f3d6-9a01-7b20-8c31-55ee01a2b3c4",
    "requiresPhoneVerification": false,
    "requiresPasswordChange": false
  },
  "message": null,
  "meta": {}
}
```

**Response — web mode (`200`)** — identical, except `tokens` is `null` and:

```http
Set-Cookie: ug_at=eyJhbGciOi…; HttpOnly; Secure; SameSite=Lax; Path=/api/v1; Max-Age=900
Set-Cookie: ug_rt=v1.8f3b2c…; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=2592000
```

**Errors**

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_INVALID_CREDENTIALS` | Unknown identifier **or** wrong password. Both paths run a full Argon2id verification (against a dummy hash for unknown identifiers) so response time does not leak account existence. |
| 403 | `AUTH_ACCOUNT_SUSPENDED` | `users.status` is `SUSPENDED`/`DEACTIVATED`. Returned only after correct credentials — a suspended-account message for a wrong password would itself be an oracle. |
| 403 | `AUTH_ACCOUNT_LOCKED` | Progressive lockout from `login_attempts`. `details.retryAfterSeconds`. |
| 422 | `VALIDATION_FAILED` | Malformed identifier, missing `clientType`. |
| 429 | `RATE_LIMITED` | 5 attempts / 15 min per `(identifier, IP)`; 20 / 15 min per IP. |

**Notes**

- Every attempt writes a `login_attempts` row (success or failure) with `identifier_hash`, IP and user agent. The raw identifier is stored as supplied for support; the hash drives the lockout counter.
- A successful login creates a `sessions` row and the first `refresh_tokens` row of a new `family_id`.
- `requiresPhoneVerification: true` means the account exists and the password is right but `phone_verified_at` is null. Tokens are still issued, with a restricted permission set; the client must complete `/auth/otp/verify` before `POST /trip-requests` will succeed (`403 AUTH_PHONE_NOT_VERIFIED`).
- OTP-only accounts (drivers, typically) have `password_hash = NULL` and cannot use this endpoint at all; they receive `AUTH_INVALID_CREDENTIALS` and must use `/auth/otp/request` + `/auth/otp/verify`.

---

#### `POST /auth/refresh`

Rotate the refresh token and mint a new access token.

**Request — web mode**

```http
POST /api/v1/auth/refresh HTTP/1.1
Cookie: ug_rt=v1.8f3b2c…
X-Requested-With: unigate-web
Content-Length: 0
```

Body is empty. The `X-Requested-With` header is **mandatory** in cookie mode (canonical decision); its absence is `403 AUTH_CSRF_HEADER_MISSING`.

**Request — mobile mode**

```json
{ "refreshToken": "v1.8f3b2c…" }
```

**Response (`200`)** — same `tokens` block as login (mobile) or a fresh `Set-Cookie` pair (web), plus:

```json
{
  "success": true,
  "data": {
    "tokens": { "accessToken": "eyJ…", "accessTokenExpiresAt": "2026-09-14T11:32:10.004Z",
                "refreshToken": "v1.c71d9a…", "refreshTokenExpiresAt": "2026-10-14T11:02:44.817Z",
                "tokenType": "Bearer" },
    "sessionId": "0192f3d6-9a01-7b20-8c31-55ee01a2b3c4",
    "permissionVersion": 7
  },
  "message": null,
  "meta": {}
}
```

`permissionVersion` lets the client detect that its cached permission set is stale and re-fetch `GET /me` — the mechanism by which a role change reaches an open tab within 15 minutes without a WebSocket push.

**Errors**

| Status | Code | Client action |
|---|---|---|
| 401 | `AUTH_TOKEN_INVALID` | Unknown token, or mode mismatch (cookie token presented as a Bearer body). Log out. |
| 401 | `AUTH_REFRESH_EXPIRED` | Past 30 days. Log out, re-authenticate. |
| 401 | `AUTH_SESSION_REVOKED` | Logged out elsewhere, admin revocation, or password changed. Log out. |
| **401** | **`AUTH_REFRESH_REUSE_DETECTED`** | **Every session for the user is now revoked.** Clear all state, drop queued requests, route to login with a security interstitial. **Do not retry.** |
| 403 | `AUTH_CSRF_HEADER_MISSING` | Cookie mode without `X-Requested-With`. |
| 429 | `RATE_LIMITED` | 30 refreshes / 5 min per session — a client looping on refresh is a bug, and the limit surfaces it. |

**Notes** — the rotation algorithm, its transaction boundary and the accepted parallel-refresh consequence are in §6.3. Clients must implement single-flight refresh.

---

#### `POST /auth/otp/request`

Issue a one-time code. This is the endpoint most exposed to abuse: each call can cost money (SMS) and each call to a foreign destination can cost a lot of money.

**Request**

```json
{
  "channel": "SMS",
  "destination": "+966512345678",
  "purpose": "LOGIN"
}
```

| Field | Type | Rules |
|---|---|---|
| `channel` | `SMS` \| `EMAIL` | |
| `destination` | string | E.164 for `SMS` (Saudi `+9665XXXXXXXX` accepted without restriction; other country codes are allow-listed — see §11.3), email for `EMAIL`. |
| `purpose` | `REGISTRATION` \| `LOGIN` \| `PHONE_VERIFICATION` \| `PASSWORD_RESET` \| `SENSITIVE_ACTION` | Determines the code TTL, the template and what `/auth/otp/verify` returns. |

`SENSITIVE_ACTION` additionally requires an authenticated session, and the destination must match the actor's own verified phone — it cannot be used to send codes anywhere else.

**Response (`200`)**

```json
{
  "success": true,
  "data": {
    "otpRequestId": "0192f3e1-44ab-7c09-9d12-8f30ab77e201",
    "channel": "SMS",
    "destinationMasked": "+9665•••••678",
    "expiresAt": "2026-09-14T11:07:44.817Z",
    "maxAttempts": 5,
    "resendAvailableAt": "2026-09-14T11:03:44.817Z"
  },
  "message": null,
  "meta": {}
}
```

The response is **identical in shape and timing** whether or not the destination belongs to a registered account (§4.6). `otpRequestId` is returned in all cases and must be echoed to `/auth/otp/verify`.

**Errors**

| Status | Code | When |
|---|---|---|
| 422 | `VALIDATION_FAILED` | Not a valid E.164 / email; unsupported country code. |
| 429 | `AUTH_OTP_THROTTLED` | Any of the four buckets in §11.3 is exhausted. `details: { scope: "DESTINATION" \| "IP" \| "ACCOUNT" \| "GLOBAL", retryAfterSeconds }`, plus `Retry-After`. |
| 403 | `AUTH_ACCOUNT_SUSPENDED` | `SENSITIVE_ACTION` on a suspended account. |

**Notes**

- The code is 6 digits, generated with `crypto.randomInt`, TTL 5 minutes (A-03), stored as `HMAC-SHA256(code, server_pepper)` — never the code itself ([database.md §5.3](database.md)).
- In development the `ConsoleOtpProvider` logs the code to stdout and returns it in `data.devCode`; that field is stripped by a response guard whenever `NODE_ENV === 'production'`, and an integration test asserts its absence.
- `resendAvailableAt` is a 60-second cooldown the client must honour; the server enforces it independently.
- The production SMS adapter is **OQ-10**. No provider is assumed or implemented.

---

#### `POST /trip-requests`

Create a trip request — the central domain object (BRIEF-§11). Requires `Idempotency-Key`.

**Request — passenger**

```json
{
  "transportType": "PASSENGER",
  "vehicleCategoryId": "0192e050-0000-7000-8000-0000000000c3",
  "vehiclesRequired": 1,
  "allowPartialFulfilment": false,
  "tripDirection": "ROUND_TRIP",
  "pickup": {
    "addressLine": "King Khalid International Airport, Terminal 5, Riyadh",
    "cityId": "0192e100-0000-7000-8000-00000000a001",
    "latitude": 24.9576100, "longitude": 46.6987800,
    "placeId": "ChIJ_____placeref"
  },
  "dropoff": {
    "addressLine": "Al Faisaliah Tower, Olaya, Riyadh",
    "cityId": "0192e100-0000-7000-8000-00000000a001",
    "latitude": 24.6905600, "longitude": 46.6852700,
    "placeId": "ChIJ_____placeref2"
  },
  "pickupAt": "2026-09-20T05:30:00.000Z",
  "returnAt": "2026-09-20T14:00:00.000Z",
  "biddingClosesAt": "2026-09-19T05:30:00.000Z",
  "budgetAmount": "1500.00",
  "currency": "SAR",
  "specialInstructions": "Two wheelchairs, please bring a ramp.",
  "passengerDetails": {
    "passengerCount": 6,
    "luggageCount": 8,
    "tripPurpose": "AIRPORT_TRANSFER",
    "requiresFemaleDriver": false,
    "requiresWheelchairAccess": true,
    "childSeatsRequired": 0,
    "waitingTimeMinutes": 45,
    "isMultiDay": false,
    "driverLanguagePreference": ["ar", "en"]
  },
  "publish": true
}
```

**Request — goods** replaces `passengerDetails` with `goodsDetails`:

```json
{
  "goodsDetails": {
    "cargoType": "PERISHABLE",
    "cargoDescription": "Chilled dairy, palletised",
    "cargoWeightKg": "8400.00",
    "cargoVolumeM3": "22.50",
    "packageCount": 16,
    "requiresRefrigeration": true,
    "requiredTemperatureMinC": 2,
    "requiredTemperatureMaxC": 6,
    "requiresTailLift": true,
    "requiresCrane": false,
    "loadingResponsibility": "CUSTOMER",
    "unloadingResponsibility": "THIRD_PARTY",
    "loadingInstructions": "Dock 4, 06:00–09:00 only",
    "declaredValueAmount": "185000.00",
    "requiresInsurance": true,
    "shipperContactName": "Omar Zahrani", "shipperContactPhone": "+966555000111",
    "consigneeContactName": "Hind Qahtani", "consigneeContactPhone": "+966555000222"
  }
}
```

**Validation**

| Rule | Failure |
|---|---|
| Exactly one of `passengerDetails` / `goodsDetails`, matching `transportType` | `422 TRIP_REQUEST_DETAIL_MISMATCH` |
| `pickupAt > now()` | `422 VALIDATION_FAILED` |
| `returnAt` required and `> pickupAt` when `tripDirection = ROUND_TRIP` | `422 VALIDATION_FAILED` |
| `biddingClosesAt > now()`; defaults to `pickupAt − leadTime` (A-02, **OQ-02**). It is **not** constrained to `<= pickupAt` — a later wave on a partially-fulfilled order is bid on and awarded after the original pickup time, which is the entire point ([database.md §8.1](database.md)) | `422 VALIDATION_FAILED` |
| `remainderClosesAt`, if supplied, `> biddingClosesAt`. `null` (the default) means the balance stays open until the customer closes it (**OQ-23**) | `422 VALIDATION_FAILED` |
| `vehiclesRequired >= 1` | `422 VALIDATION_FAILED` |
| `allowPartialFulfilment` optional; **defaults to `true` for `GOODS` and `false` for `PASSENGER`** (**A-45**). Ignored when `vehiclesRequired = 1`, where the two behaviours are identical | — |
| `vehicleCategoryId`'s `transport_type` matches `transportType` | `422 VALIDATION_FAILED` |
| Actor's phone verified | `403 AUTH_PHONE_NOT_VERIFIED` |

**Response (`201`)**

```json
{
  "success": true,
  "data": {
    "id": "0192f400-1111-7000-8000-000000000001",
    "requestNumber": "TR-2026-000871",
    "status": "PUBLISHED",
    "transportType": "PASSENGER",
    "vehiclesRequired": 1,
    "allowPartialFulfilment": false,
    "vehiclesAwarded": 0,
    "vehiclesDispatched": 0,
    "vehiclesCompleted": 0,
    "vehiclesCancelled": 0,
    "estimatedDistanceKm": "38.40",
    "estimatedDurationMinutes": 42,
    "biddingClosesAt": "2026-09-19T05:30:00.000Z",
    "remainderClosesAt": null,
    "budgetAmount": "1500.00",
    "currency": "SAR",
    "invitedOwnerCount": 14,
    "createdAt": "2026-09-14T11:02:44.817Z"
  },
  "message": null,
  "meta": {}
}
```

```http
Location: /api/v1/trip-requests/0192f400-1111-7000-8000-000000000001
```

**Notes**

- `estimatedDistanceKm` / `estimatedDurationMinutes` are fetched from the `MapsProvider` at creation and **snapshotted**. If the provider is unavailable the request is still created with both `null` and `meta.degraded: ["maps"]` — a maps outage must not block demand.
- With `publish: true` the matcher runs in the same transaction as the insert: it writes `trip_request_invitations` for owners whose `owner_service_areas` include the pickup city and who hold a dispatchable vehicle in the requested category, then writes one `outbox_events` row. Notification delivery is the relay's job, so a broker outage cannot lose an invitation.
- `specialInstructions` and the contact fields are **redacted** from the owner-facing projection until that owner holds an accepted bid. An open bidding pool should not be a phone-number harvest.
- Idempotency: a retry with the same key replays the same `201` and does **not** re-invite owners.
- **`allowPartialFulfilment` is surfaced to the customer as a plain question** ("Can we send these in batches, or do you need them all together?"), not as a technical toggle. The default is right for most traffic — 5 truckloads can leave in waves, 5 wedding cars cannot — and the customer overrides it when their case is the exception (**A-45**).
- With `allowPartialFulfilment: false` the matcher and the invitation set are unchanged; only the **award** path differs. Bids accumulate normally and are awarded as one atomic group through `POST /trip-requests/{id}/award`.

---

#### `POST /bids`

Submit a quotation against a trip request (BRIEF-§12). Requires `Idempotency-Key`.

**Request**

```json
{
  "tripRequestId": "0192f400-1111-7000-8000-000000000001",
  "vehicleId": "0192e3c0-2222-7000-8000-0000000000v1",
  "driverProfileId": "0192e4d0-3333-7000-8000-0000000000d1",
  "baseAmount": "1250.00",
  "extrasBreakdown": [
    { "labelEn": "Airport permit",   "labelAr": "تصريح المطار", "amount": "50.00" },
    { "labelEn": "Waiting 45 min",   "labelAr": "انتظار ٤٥ دقيقة", "amount": "0.00" }
  ],
  "estimatedArrivalAt": "2026-09-20T05:15:00.000Z",
  "estimatedDurationMinutes": 50,
  "validUntil": "2026-09-18T20:00:00.000Z",
  "ownerNotes": "Driver speaks English and Arabic. Ramp-equipped Hiace."
}
```

`vatAmount`, `extrasAmount` and `totalAmount` are **not accepted**. They are `.strict()`-rejected if present. The server computes:

```
extrasAmount = Σ extrasBreakdown[].amount
vatAmount    = round_half_up((baseAmount + extrasAmount) × vatRate, 2)
totalAmount  = baseAmount + extrasAmount + vatAmount
```

using the `vatRate` read from `system_settings` at submission time and **snapshotted onto the bid row**. A later VAT change does not alter a live bid.

> Accepting a client-supplied total and validating it against the computed one looks safer and is not: the two can disagree for legitimate rounding reasons, the endpoint then has to decide which wins, and whichever answer is chosen becomes a pricing exploit. The client total is not compared — it is not accepted at all.

**Validation and errors**

| Status | Code | When |
|---|---|---|
| 422 | `BID_AMOUNT_INVALID` | `baseAmount <= 0`, any extra `< 0`, or more than 2 fraction digits |
| 422 | `BID_VALIDITY_INVALID` | `validUntil <= now()`, or `validUntil` past the applicable deadline (`biddingClosesAt`, or `remainderClosesAt` when the request is `PARTIALLY_AWARDED` and it is set) |
| 422 | `TRIP_REQUEST_NOT_OPEN` | Request status not in `PUBLISHED` / `PARTIALLY_AWARDED`. A `PARTIALLY_AWARDED` request is open — bidding for the balance is the point (**A-45**) |
| 422 | `TRIP_REQUEST_BIDDING_WINDOW_CLOSED` | `now() > biddingClosesAt` while `PUBLISHED`, or `now() > remainderClosesAt` while `PARTIALLY_AWARDED`. `details.deadlineField` says which |
| 422 | `TRIP_REQUEST_REMAINDER_CLOSED` | Status is `CLOSED_PARTIAL` — the customer abandoned the balance |
| 422 | `BID_NOT_ELIGIBLE` | No `trip_request_invitations` row for this owner, or the vehicle's category does not match the request |
| 422 | `VEHICLE_NOT_DISPATCHABLE` | Vehicle fails the dispatchable predicate — `details.reasons` lists which: `NOT_APPROVED`, `NOT_ACTIVE`, `DOCUMENTS_EXPIRED` (with the document type codes) |
| 422 | `OWNER_NOT_APPROVED` | Owner `onboarding_status ≠ APPROVED` |
| 422 | `DRIVER_NOT_APPROVED` / `DRIVER_LICENSE_EXPIRED` | When `driverProfileId` is supplied |
| 409 | `BID_DUPLICATE_VEHICLE` | `uq_bids_active_vehicle_per_request` — this vehicle already has a `SUBMITTED` bid on this request |
| 404 | `NOT_FOUND` | Request or vehicle outside the actor's scope |

**Response (`201`)**

```json
{
  "success": true,
  "data": {
    "id": "0192f410-4444-7000-8000-000000000001",
    "bidNumber": "BD-2026-002144",
    "tripRequestId": "0192f400-1111-7000-8000-000000000001",
    "status": "SUBMITTED",
    "version": 1,
    "baseAmount": "1250.00",
    "extrasAmount": "50.00",
    "vatRate": "0.1500",
    "vatAmount": "195.00",
    "totalAmount": "1495.00",
    "currency": "SAR",
    "estimatedArrivalAt": "2026-09-20T05:15:00.000Z",
    "validUntil": "2026-09-18T20:00:00.000Z",
    "submittedAt": "2026-09-14T12:10:03.221Z"
  },
  "message": null,
  "meta": {}
}
```

**Notes**

- The bid does **not** reserve the vehicle. An owner may bid the same vehicle on ten overlapping requests; reservation happens only at acceptance, which is where the exclusion constraint adjudicates. Reserving at bid time would let a bidder trivially deny the marketplace its fleet.
- A `bid.received` socket event and an outbox notification go to the customer.
- Whether a driver must be named at bid time or may be assigned later is **OQ-18**; the field is optional and the booking flow re-validates at dispatch.

---

#### `POST /bids/{id}/accept`

The concurrency-critical path (BRIEF-§12, §45). Requires `Idempotency-Key`. Accepts **one** bid, creating **one** booking — this is the partial-fulfilment path. For a request with `allowPartialFulfilment: false`, use `POST /trip-requests/{id}/award` instead.

**Request**

```json
{ "customerNotes": "Please call on arrival." }
```

`customerNotes` is optional; an empty object `{}` is valid. The bid identifies everything else — the vehicle, the schedule, the price and the request. There is no slot or wave parameter: `fulfilmentSequence` is **assigned by the server** as `vehicles_awarded + 1` under the request's row lock, because a client-supplied wave number is a number two concurrent acceptances can both claim.

**Behaviour** — one transaction, lock order **`trip_requests` → `bids` → `vehicles` → `corporate_customer_profiles`**, globally fixed so deadlock is structurally impossible ([database.md §9.2](database.md)):

1. `SELECT … FOR UPDATE` the trip request. Assert `status ∈ {PUBLISHED, PARTIALLY_AWARDED}` and `vehicles_awarded < vehicles_required`. Assert the applicable bidding deadline has not passed.
2. **Assert `allow_partial_fulfilment = true` OR `vehicles_required = 1`.** A single-bid acceptance against an all-or-nothing request is rejected with `422 RULE_PARTIAL_AWARD_NOT_ALLOWED`, whose `details` names the group-award endpoint and the remainder the client must cover.
3. `SELECT … FOR UPDATE` the bid. Assert `status = SUBMITTED`, `valid_until > now()`, `trip_request_id` matches.
4. `SELECT … FOR UPDATE` the vehicle. Re-assert the dispatchable predicate — documents may have expired since the bid was placed.
5. **Resolve `billingMode`.** Read the customer's `corporate_customer_profiles.billing_cycle`; `PER_BOOKING` (or no corporate profile) ⇒ `PREPAID`, otherwise `INVOICED`. The resolved value is **snapshotted onto the booking** and never re-derived (**A-46**).
6. **Credit check — only when `billingMode = INVOICED`.** `SELECT … FOR UPDATE` the corporate profile, then assert `credit_status = 'APPROVED'` (else `422 RULE_CREDIT_NOT_APPROVED`) and `outstanding + total <= credit_limit_amount` (else `422 RULE_CREDIT_LIMIT_EXCEEDED`). `outstanding` is `SUM(debits) − SUM(credits)` over `CUSTOMER_RECEIVABLE` for that customer — read from the ledger, never from a cached column. The row lock is what stops two concurrent awards each passing a check that only one of them fits.
7. Resolve the commission rule effective **now** and freeze it.
8. `INSERT INTO bookings` with every commercial term snapshotted, `billing_mode`, and `fulfilment_sequence = vehicles_awarded + 1`. The entry status is keyed on `billingMode`: `PREPAID` → `PENDING_PAYMENT` with `payment_due_by` set from `booking.payment_window_minutes`; `INVOICED` → **`CONFIRMED` directly**, with `payment_status = INVOICED`, `payment_due_by = null` and `confirmed_at = now()`. An `INVOICED` booking never enters `PENDING_PAYMENT` and is never touched by the payment-expiry sweeper.
9. `INSERT INTO vehicle_calendar_entries (entry_type='RESERVATION', period=[start−buffer, end+buffer), status='HELD')`. **The `EXCLUDE` constraint adjudicates here.** The period comes from the **bid's** schedule, not the request's `pickup_at` — later waves have different times by definition ([database.md §8.6](database.md)).
10. `INSERT INTO booking_financial_snapshots`, asserting `ownerNet + commission + commissionVat + paymentFee = gross` before writing.
11. Update the bid to `ACCEPTED`; increment `vehicles_awarded`; set the request to `FULLY_AWARDED` when `vehicles_awarded = vehicles_required`, otherwise `PARTIALLY_AWARDED`. **Sibling bids are rejected only on full award** — while a remainder is open they stay `SUBMITTED` and keep competing for the next wave.
12. `INSERT INTO outbox_events` in the same transaction.

**Response (`201`) — full award of a single-vehicle request, `PREPAID`**

```json
{
  "success": true,
  "data": {
    "booking": {
      "id": "0192f420-5555-7000-8000-000000000001",
      "bookingNumber": "BK-2026-000124",
      "status": "PENDING_PAYMENT",
      "paymentStatus": "UNPAID",
      "billingMode": "PREPAID",
      "fulfilmentSequence": 1,
      "vehiclePlateSnapshot": "ABC 1234",
      "vehicleDescriptionSnapshot": "Toyota Hiace 2022 — Van",
      "ownerNameSnapshot": "Al Rajhi Transport Est.",
      "scheduledStartAt": "2026-09-20T05:30:00.000Z",
      "scheduledEndAt": "2026-09-20T14:00:00.000Z",
      "agreedBaseAmount": "1250.00",
      "agreedExtrasAmount": "50.00",
      "vatRate": "0.1500",
      "vatAmount": "195.00",
      "totalAmount": "1495.00",
      "currency": "SAR",
      "paymentDueBy": "2026-09-14T13:10:03.221Z"
    },
    "tripRequest": {
      "id": "0192f400-…", "status": "FULLY_AWARDED",
      "vehiclesRequired": 1, "vehiclesAwarded": 1, "remainder": 0,
      "allowPartialFulfilment": false, "remainderClosesAt": null
    },
    "bid": { "id": "0192f410-…", "status": "ACCEPTED", "decidedAt": "2026-09-14T12:40:11.905Z" },
    "siblingBidsRejected": 6
  },
  "message": null,
  "meta": {}
}
```

**Response (`201`) — partial award, wave 2 of an order for 5, `INVOICED`**

The request for 5 trucks already had 1 awarded. This acceptance makes it 2; the order **remains open** and keeps taking bids for the remaining 3.

```json
{
  "success": true,
  "data": {
    "booking": {
      "id": "0192f428-…",
      "bookingNumber": "BK-2026-000131",
      "status": "CONFIRMED",
      "paymentStatus": "INVOICED",
      "billingMode": "INVOICED",
      "fulfilmentSequence": 2,
      "scheduledStartAt": "2026-09-22T04:00:00.000Z",
      "scheduledEndAt": "2026-09-22T19:00:00.000Z",
      "totalAmount": "8625.00",
      "currency": "SAR",
      "paymentDueBy": null,
      "confirmedAt": "2026-09-15T09:41:02.610Z"
    },
    "tripRequest": {
      "id": "0192f401-…", "status": "PARTIALLY_AWARDED",
      "vehiclesRequired": 5, "vehiclesAwarded": 2, "remainder": 3,
      "vehiclesDispatched": 1, "vehiclesCompleted": 0, "vehiclesCancelled": 0,
      "allowPartialFulfilment": true, "remainderClosesAt": null
    },
    "bid": { "id": "0192f411-…", "status": "ACCEPTED", "decidedAt": "2026-09-15T09:41:02.610Z" },
    "siblingBidsRejected": 0,
    "credit": {
      "creditLimitAmount": "250000.00",
      "outstandingAmount": "94300.00",
      "availableAmount": "155700.00",
      "currency": "SAR"
    }
  },
  "message": "Request remains PARTIALLY_AWARDED; 3 of 5 vehicles still open for bidding",
  "meta": {}
}
```

`siblingBidsRejected: 0` is the visible consequence of the rule: nothing was rejected because the order is still hiring. `credit` is present only for `INVOICED` bookings and is the post-award position, so the customer's UI can show remaining headroom without a second call. `message` is a developer-facing note (§2.1), not a display string — the client renders the counters.

**The 409 `BID_VEHICLE_UNAVAILABLE` path**

Two customers accept bids offering the same vehicle for overlapping windows. Both transactions reach step 6. One commits; the other's insert raises PostgreSQL `23P01 exclusion_violation` on `ex_vehicle_calendar_no_overlap`. The service catches `23P01`, rolls back the **entire** transaction (no orphan booking, no orphan snapshot, no outbox event), and returns:

```json
{
  "success": false,
  "data": null,
  "message": "Vehicle 0192e3c0-… is already reserved for an overlapping period; exclusion constraint ex_vehicle_calendar_no_overlap rejected the reservation",
  "error": {
    "code": "BID_VEHICLE_UNAVAILABLE",
    "details": {
      "bidId": "0192f410-4444-7000-8000-000000000001",
      "vehicleId": "0192e3c0-2222-7000-8000-0000000000v1",
      "conflictingPeriod": { "from": "2026-09-20T04:30:00.000Z", "to": "2026-09-20T15:00:00.000Z" }
    },
    "requestId": "0192f421-6d0a-7e11-8b22-4f9c1d30e5a7"
  }
}
```

`conflictingPeriod` is the **buffered** window (booked window ± `booking.turnaround_buffer_minutes`, default 60 — A-07), which is why it is wider than the trip itself. The losing bid stays `SUBMITTED` so the customer can accept a different bid immediately; the UI refreshes the comparison list.

This is the only correct outcome. An application-level "check availability, then insert" would have both transactions read "free" and both insert — the constraint is what makes the race impossible rather than merely unlikely.

**Other errors**

| Status | Code | When |
|---|---|---|
| 409 | `BID_ALREADY_DECIDED` | Bid is not `SUBMITTED` — double-click, or another party already decided it |
| 422 | `BID_EXPIRED` | `now() > valid_until`. A retry can never succeed; the customer must request a fresh quote |
| 409 | `TRIP_REQUEST_FULLY_AWARDED` | `vehicles_awarded` already reached `vehicles_required`. `details` carries both counters |
| 422 | `TRIP_REQUEST_REMAINDER_CLOSED` | The customer closed the balance (`CLOSED_PARTIAL`) between the bid landing and the acceptance |
| 422 | `TRIP_REQUEST_BIDDING_WINDOW_CLOSED` | `remainderClosesAt` passed while the request sat `PARTIALLY_AWARDED` |
| 422 | `RULE_PARTIAL_AWARD_NOT_ALLOWED` | `allow_partial_fulfilment = false` and `vehicles_required > 1`. **Not retryable through this endpoint** — `details.awardEndpoint` points the client at `POST /trip-requests/{id}/award` and `details.remainder` says how many bids that call must carry |
| 422 | `RULE_CREDIT_NOT_APPROVED` | `INVOICED` customer whose `credit_status` is `NONE`, `PENDING_APPROVAL` or `SUSPENDED`. `details.creditStatus` says which |
| 422 | `RULE_CREDIT_LIMIT_EXCEEDED` | `INVOICED` and `outstanding + total > credit_limit_amount`. `details` carries the limit, the outstanding balance, the requested amount and the shortfall — enough for the UI to say "SAR 12,400 over limit" without arithmetic |
| 422 | `VEHICLE_NOT_DISPATCHABLE` | Documents expired between bid and acceptance |
| 404 | `NOT_FOUND` | Bid outside the actor's scope — accepting a bid on someone else's request |

> **Why the credit failures are 422 and not 403.** The actor is permitted to accept bids; the request is well-formed; nothing in the persisted state *collides*. What fails is a domain rule about the customer's standing, and no retry of the identical request succeeds until a human changes the limit or the balance is paid down (§3.3). A 403 would also be a misdiagnosis in the client's error handling — it would log the customer out of the flow rather than telling them to pay an invoice.

**Idempotency behaviour**

A retry with the same `Idempotency-Key` replays the stored response verbatim, including `meta.idempotentReplay: true` and `Idempotency-Replayed: true`. Crucially, **failures replay too**: a retry of a call that returned `409 BID_VEHICLE_UNAVAILABLE` returns that same 409, not a fresh attempt. Without this, a client retrying after a network timeout — unable to tell whether the original succeeded — could create a second booking, a second reservation and a second financial snapshot for one customer intent. With it, the retry is provably safe and the client can retry blindly.

The idempotency row is written **inside** the same transaction as the booking, so there is no window in which a booking exists but its key does not.

**Cancelling an awarded booking reopens the order**

`POST /bookings/{id}/cancel` on a booking created here decrements `trip_requests.vehicles_awarded`, increments `vehicles_cancelled`, and moves the request `FULLY_AWARDED → PARTIALLY_AWARDED`. The request is immediately visible to owners again with no re-publish, and the reservation is released so the vehicle is bookable. `vehicles_cancelled` is never decremented — it is a reliability signal about the order, not a live count (**A-45**).

---

#### `POST /trip-requests/{id}/award`

**All-or-nothing group award.** Accepts a set of bids covering the entire remainder of a request in **one transaction**: every booking is created, or none is. Requires `Idempotency-Key`. Permission `bids.accept`, scope `own(customer) → global`.

This is the only award path for a request with `allowPartialFulfilment: false`, and it is also available — as a convenience — on a partial-fulfilment request when the customer wants to award several bids at once.

> **Why this is a separate endpoint and not a flag on `/bids/{id}/accept`.** The atomicity guarantee is the product. A client looping over `POST /bids/{id}/accept` cannot get it: the third call can fail on `BID_VEHICLE_UNAVAILABLE` after two bookings are already committed, leaving a company shuttle for 5 buses with 2 buses, which is precisely the outcome `allowPartialFulfilment: false` exists to prevent. Atomicity across *n* bids has to be one request, because it has to be one transaction.

**Request**

```json
{
  "bidIds": [
    "0192f410-4444-7000-8000-000000000001",
    "0192f410-4444-7000-8000-000000000002",
    "0192f410-4444-7000-8000-000000000003"
  ],
  "customerNotes": "All five buses to the same gate, please."
}
```

| Field | Type | Rules |
|---|---|---|
| `bidIds` | uuid[] | 1–20 entries, **unique**, each `SUBMITTED` and belonging to this request. Count must equal `vehiclesRequired − vehiclesAwarded` **exactly** — not fewer (the order would rest partially awarded, which this request type forbids) and not more (`vehicles_awarded` would exceed `vehicles_required` and trip `ck_trip_requests_counters`). |
| `customerNotes` | string ≤ 1000, optional | Copied to every booking created. |

**Behaviour** — one transaction, the same global lock order as single acceptance, with the bids locked in **ascending `id` order** so two concurrent group awards on overlapping bid sets cannot deadlock:

1. `SELECT … FOR UPDATE` the trip request. Assert `status ∈ {PUBLISHED, PARTIALLY_AWARDED}`, the deadline has not passed, and compute `remainder = vehicles_required − vehicles_awarded`.
2. Assert `bidIds.length = remainder`, else `422 RULE_AWARD_SET_INCOMPLETE` with `details.remainder` and `details.suppliedBidCount`.
3. `SELECT … FOR UPDATE` all bids ordered by `id`. Each must be `SUBMITTED`, unexpired and on this request. **All distinct vehicles** — two bids offering the same vehicle would be caught by the exclusion constraint at step 6, but rejecting them up front gives a `VALIDATION_FAILED` naming the duplicate instead of an opaque 409.
4. Lock and re-assert the dispatchable predicate on every vehicle.
5. Resolve `billingMode` once for the customer. When `INVOICED`, run the credit check **against the sum of all bids in the set**, not per booking — five trucks that each fit under the limit but do not fit together must fail, and failing per booking would let the first four through.
6. For each bid in order: resolve and freeze the commission rule, insert the booking (`fulfilment_sequence` assigned `vehicles_awarded + 1 … + n`), insert the calendar reservation, insert the financial snapshot. **Any `23P01` here rolls back the whole set** — no partial group.
7. Set every bid to `ACCEPTED`, set `vehicles_awarded = vehicles_required`, set the request to `FULLY_AWARDED`, and reject all remaining `SUBMITTED` siblings.
8. One `outbox_events` row per created booking plus one for the order, inside the transaction.

**Response (`201`)**

```json
{
  "success": true,
  "data": {
    "bookings": [
      { "id": "0192f42a-…", "bookingNumber": "BK-2026-000140", "status": "CONFIRMED",
        "billingMode": "INVOICED", "fulfilmentSequence": 3, "bidId": "0192f410-…001",
        "vehiclePlateSnapshot": "ABC 1234", "scheduledStartAt": "2026-09-20T04:00:00.000Z",
        "totalAmount": "1495.00", "currency": "SAR" },
      { "id": "0192f42b-…", "bookingNumber": "BK-2026-000141", "status": "CONFIRMED",
        "billingMode": "INVOICED", "fulfilmentSequence": 4, "bidId": "0192f410-…002",
        "vehiclePlateSnapshot": "DEF 5678", "scheduledStartAt": "2026-09-20T04:00:00.000Z",
        "totalAmount": "1510.00", "currency": "SAR" },
      { "id": "0192f42c-…", "bookingNumber": "BK-2026-000142", "status": "CONFIRMED",
        "billingMode": "INVOICED", "fulfilmentSequence": 5, "bidId": "0192f410-…003",
        "vehiclePlateSnapshot": "GHI 9012", "scheduledStartAt": "2026-09-20T04:00:00.000Z",
        "totalAmount": "1480.00", "currency": "SAR" }
    ],
    "tripRequest": {
      "id": "0192f402-…", "status": "FULLY_AWARDED",
      "vehiclesRequired": 5, "vehiclesAwarded": 5, "remainder": 0,
      "allowPartialFulfilment": false
    },
    "totals": { "bookingCount": 3, "totalAmount": "4485.00", "currency": "SAR" },
    "siblingBidsRejected": 11
  },
  "message": null,
  "meta": {}
}
```

```http
Location: /api/v1/trip-requests/0192f402-…/bids
```

There is no single created resource, so `Location` points at the request's bid list rather than at one booking. Bookings are returned in `fulfilmentSequence` order, which is the order of `bidIds` as supplied.

**Errors**

| Status | Code | When |
|---|---|---|
| 422 | `RULE_AWARD_SET_INCOMPLETE` | `bidIds.length ≠ remainder`. `details: { tripRequestId, remainder, suppliedBidCount, bidIds }` |
| 422 | `VALIDATION_FAILED` | Duplicate entries in `bidIds`, two bids on the same vehicle, or more than 20 entries |
| 409 | `BID_ALREADY_DECIDED` | Any bid in the set is not `SUBMITTED`. `details.bidId` names the first offender; **nothing is created** |
| 422 | `BID_EXPIRED` | Any bid past `valid_until` |
| 409 | `BID_VEHICLE_UNAVAILABLE` | Any reservation loses the exclusion constraint. Same `details` shape as single acceptance, plus the offending `bidId`. **The whole group is rolled back** — the customer re-picks and retries with a new key |
| 409 | `TRIP_REQUEST_FULLY_AWARDED` | `remainder` is already 0 |
| 422 | `TRIP_REQUEST_NOT_OPEN` / `TRIP_REQUEST_REMAINDER_CLOSED` / `TRIP_REQUEST_BIDDING_WINDOW_CLOSED` | Request state or deadline |
| 422 | `RULE_CREDIT_LIMIT_EXCEEDED` | Sum of the set exceeds available credit. `details.requestedAmount` is the **set total**, not one booking |
| 422 | `RULE_CREDIT_NOT_APPROVED` | Credit not approved |
| 422 | `VEHICLE_NOT_DISPATCHABLE` | Any vehicle fails the predicate. `details.vehicleId` and `details.reasons` |
| 404 | `NOT_FOUND` | Request outside the actor's scope, or any bid is not on this request |

**Notes**

- **Failures name one offender and create nothing.** The endpoint deliberately does not return a per-bid result array on failure. A partial success report would imply a partial award happened, and the entire contract of this endpoint is that it cannot.
- A retry with the same `Idempotency-Key` replays the stored envelope verbatim, success or failure — so a client that times out mid-award cannot double-award an order.
- On a request with `allowPartialFulfilment: true`, this endpoint behaves identically but the `bidIds.length = remainder` rule still applies. A customer awarding *some* of the balance on a partial-fulfilment order uses `POST /bids/{id}/accept` per bid; that is what it is for.

---

#### `POST /trip-requests/{id}/close-remainder`

Close the unfilled balance of a partially-awarded order. `PARTIALLY_AWARDED → CLOSED_PARTIAL`. Requires `Idempotency-Key`. Permission `trip_requests.update`, scope `own → global`.

> **Only the customer closes a balance.** The expiry sweeper skips any request with `vehicles_awarded > 0` — a partially fulfilled order is a live commercial commitment, not a stale request, and the system never abandons a customer's remaining demand on its own ([database.md §8.4](database.md)). An admin may call this *for* a customer; the audit entry records who.

**Request**

```json
{ "reason": "Remaining two loads moved by our own fleet.", "rejectRemainingBids": true }
```

| Field | Type | Rules |
|---|---|---|
| `reason` | string ≤ 1000, required | Recorded on the request and in `audit_logs`. Feeds the `order-fulfilment` report's unfilled-balance analysis, so it is not optional. |
| `rejectRemainingBids` | boolean, default `true` | `false` leaves live bids `SUBMITTED` to expire naturally at `valid_until`. Owners are notified either way. |

**Behaviour** — one transaction: lock the request; assert `status = PARTIALLY_AWARDED` (anything else is `422 TRIP_REQUEST_INVALID_TRANSITION` with `details.allowed`); set `status = CLOSED_PARTIAL`; reject the remaining `SUBMITTED` bids with a system reason when `rejectRemainingBids`; stop the opportunity feed by dismissing open `trip_request_invitations`; write outbox events to every owner holding a live bid or an open invitation.

**Awarded bookings are untouched.** Closing the balance is a statement about the *unfilled* part of the order only — the dispatched and scheduled bookings run to completion, and the request moves on to `COMPLETED` when they all finish.

**Response (`200`)**

```json
{
  "success": true,
  "data": {
    "tripRequest": {
      "id": "0192f401-…", "requestNumber": "TR-2026-000872",
      "status": "CLOSED_PARTIAL",
      "vehiclesRequired": 5, "vehiclesAwarded": 3, "unfilledCount": 2,
      "vehiclesDispatched": 2, "vehiclesCompleted": 1, "vehiclesCancelled": 0,
      "closedAt": "2026-09-18T07:20:11.004Z",
      "closureReason": "Remaining two loads moved by our own fleet."
    },
    "bidsRejected": 4,
    "invitationsDismissed": 9
  },
  "message": null,
  "meta": {}
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| 422 | `TRIP_REQUEST_INVALID_TRANSITION` | Status is not `PARTIALLY_AWARDED`. `details: { tripRequestId, from, to: "CLOSED_PARTIAL", allowed }` |
| 422 | `VALIDATION_FAILED` | `reason` missing or empty |
| 404 | `NOT_FOUND` | Request outside the actor's scope |

---

#### `PATCH /trip-requests/{id}/remainder`

Adjust the open balance of a partially-awarded order without disturbing what is already awarded. Permission `trip_requests.update`, scope `own → global`.

`PATCH /trip-requests/{id}` is editable in `DRAFT` only, because changing commercial terms would invalidate live bids. The remainder is the one part of a published request that legitimately changes after award — the customer's need shrinks, or they want to put a deadline on a balance that has sat open for a week — so it gets its own narrow route with exactly two writable fields (P2).

**Request**

```json
{ "vehiclesRequired": 4, "remainderClosesAt": "2026-09-25T20:00:00.000Z" }
```

| Field | Type | Rules |
|---|---|---|
| `vehiclesRequired` | smallint, optional | `>= vehiclesAwarded`. Below that → `422 RULE_VEHICLES_REQUIRED_BELOW_AWARDED`; the customer must cancel a booking instead, which is a different operation with a fee and a refund. Setting it **equal** to `vehiclesAwarded` closes the order into `FULLY_AWARDED` and rejects the remaining bids — the same effect as `close-remainder`, reached by arithmetic. |
| `remainderClosesAt` | timestamp \| `null`, optional | Must be `> now()`. `null` restores the open-ended default (**OQ-23**). Setting it does **not** retro-invalidate bids whose `validUntil` now falls beyond it; those are simply undecidable after the deadline and expire. |

At least one field must be present. Both are `.strict()`-validated; no other request field is accepted here.

**Response (`200`)** — the updated request DTO, with `status` recomputed:

```json
{
  "success": true,
  "data": {
    "id": "0192f401-…", "requestNumber": "TR-2026-000872",
    "status": "PARTIALLY_AWARDED",
    "vehiclesRequired": 4, "vehiclesAwarded": 3, "remainder": 1,
    "allowPartialFulfilment": true,
    "biddingClosesAt": "2026-09-19T05:30:00.000Z",
    "remainderClosesAt": "2026-09-25T20:00:00.000Z",
    "updatedAt": "2026-09-18T07:02:44.817Z"
  },
  "message": null,
  "meta": {}
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| 422 | `RULE_VEHICLES_REQUIRED_BELOW_AWARDED` | `details: { tripRequestId, requested, vehiclesAwarded }` |
| 422 | `TRIP_REQUEST_INVALID_TRANSITION` | Request is not `PARTIALLY_AWARDED` |
| 422 | `TRIP_REQUEST_REMAINDER_CLOSED` | Already `CLOSED_PARTIAL` |
| 422 | `VALIDATION_FAILED` | Neither field supplied, `remainderClosesAt <= now()`, or `vehiclesRequired < 1` |
| 404 | `NOT_FOUND` | Outside the actor's scope |

**Notes** — the counter change and any resulting status transition happen under the request's row lock, so this cannot race an in-flight acceptance into a state where `vehicles_awarded > vehicles_required`. `ck_trip_requests_counters` is the backstop if it ever did.

---

#### `GET /customers/{id}/credit` + `PATCH /admin/customers/{id}/credit`

The corporate credit position, and the admin decision that sets it (**A-46**).

**`GET /customers/{id}/credit`** — permission `invoices.read`, scope `own → global`. A corporate customer reads their own; finance and ops read any.

```json
{
  "success": true,
  "data": {
    "customerProfileId": "0192e200-…",
    "companyNameEn": "Najd Logistics Co.",
    "isVerified": true,
    "creditStatus": "APPROVED",
    "creditLimitAmount": "250000.00",
    "creditTermsDays": 30,
    "billingCycle": "MONTHLY",
    "defaultBillingMode": "INVOICED",
    "outstandingAmount": "94300.00",
    "availableAmount": "155700.00",
    "overdueAmount": "0.00",
    "oldestOverdueDueDate": null,
    "currency": "SAR",
    "creditApprovedAt": "2026-06-02T08:15:00.000Z",
    "computedAt": "2026-09-18T07:02:44.817Z"
  },
  "message": null,
  "meta": {}
}
```

> **`outstandingAmount` is a query, not a column.** It is `SUM(debits) − SUM(credits)` over `CUSTOMER_RECEIVABLE` in `ledger_entries` for this customer, computed on read. There is deliberately no `outstanding_balance` column to cache it. A denormalised balance is the field that drifts under concurrent posting, and the failure mode is not a wrong number on a screen — it is quietly extending unapproved credit ([database.md §12.6](database.md)). The credit check inside the award transaction reads the same expression, so the number the customer sees here and the number that gates their next booking cannot disagree.

`availableAmount` is `max(creditLimitAmount − outstandingAmount, 0)` and is returned as `"0.00"`, never negative, when the customer is over their limit; `outstandingAmount` carries the real figure. `meta.computedAt` reflects a 30-second cache on the ledger aggregate; the award transaction never uses the cache.

A customer with no `corporate_customer_profiles` row gets `404 NOT_FOUND` — individual customers have no credit position, and returning a zeroed one would imply the feature applies to them.

**`PATCH /admin/customers/{id}/credit`** — permission `customers.verify`, scope `global`.

```json
{
  "creditStatus": "APPROVED",
  "creditLimitAmount": "250000.00",
  "creditTermsDays": 30,
  "billingCycle": "MONTHLY",
  "reason": "CR and VAT verified; 12-month trading history reviewed."
}
```

| Field | Rules |
|---|---|
| `creditStatus` | `NONE`, `PENDING_APPROVAL`, `APPROVED`, `SUSPENDED`. Moving to `APPROVED` requires `corporate_customer_profiles.is_verified = true` and a non-null `creditLimitAmount` → otherwise `422 VALIDATION_FAILED`. Approving a customer who was never verified is the control this endpoint exists to enforce. |
| `creditLimitAmount` | Money string `>= "0.00"`. **Lowering it below the current outstanding balance is permitted** and is a deliberate operational act — it blocks new `INVOICED` awards without touching live bookings. The response returns the resulting negative headroom so the operator sees what they did. |
| `creditTermsDays` | 0–180. Drives `invoices.due_date` on the **next** invoice; issued invoices keep their own `due_date`. |
| `billingCycle` | `PER_BOOKING`, `WEEKLY`, `MONTHLY`. `PER_BOOKING` resolves `billingMode` to `PREPAID` at award. |
| `reason` | Required for `SUSPENDED`; stored in `credit_suspended_reason` and in the audit entry. |

Writes `credit_approved_by_user_id` / `credit_approved_at`, audited at `severity = NOTICE` with full before/after. **No retroactive effect**: bookings already awarded keep their snapshotted `billing_mode`, and issued invoices keep their terms (D6). Suspension changes only what the *next* award may do.

**Errors** — `422 VALIDATION_FAILED` (approval without verification or without a limit; unknown status), `404 NOT_FOUND` (no corporate profile), `403 PERM_DENIED` (missing `customers.verify`).

---

#### `POST /admin/invoices/generate`

Run a billing cycle: consolidate every unbilled `COMPLETED` booking with `billing_mode = INVOICED` in a period into **one invoice per customer**, resolve each invoice's type from the buyer's VAT registration, assign `icv`, chain `previousInvoiceHash`, and submit each for clearance or reporting. `202`. Requires `Idempotency-Key`. Permission `invoices.issue`, scope `global`.

This is the endpoint where the e-invoicing decision is most visible: a run no longer just *creates rows*, it hands documents to a third party, and it can finish with some invoices delivered and some not. Both facts are in the contract below rather than left to the job's internals.

**Request**

```json
{
  "billingPeriodStart": "2026-09-01",
  "billingPeriodEnd": "2026-10-01",
  "billingCycle": "MONTHLY",
  "customerProfileIds": null,
  "issueDate": "2026-10-01",
  "dryRun": false
}
```

| Field | Rules |
|---|---|
| `billingPeriodStart` / `billingPeriodEnd` | Dates, inclusive-exclusive `[start, end)` on `bookings.completed_at`. Max span 92 days. `end > start`, and `end <= today` — a period that has not finished cannot be billed. |
| `billingCycle` | Optional filter; restricts the run to customers on that cycle. Omitted ⇒ all cycles except `PER_BOOKING`. |
| `customerProfileIds` | Optional uuid[] (≤ 200). `null` ⇒ every eligible corporate customer. Named customers let finance re-run one account after a correction without touching the rest. |
| `issueDate` | Defaults to today. `dueDate` is computed per customer as `issueDate + creditTermsDays`. |
| `dryRun` | `true` returns the same per-customer breakdown with **no writes and no numbers consumed** — the finance team's pre-flight check. |

**Behaviour** — the job, per customer, in its own transaction:

1. Select `COMPLETED`, `INVOICED` bookings in the period with no live `BOOKING` invoice line.
2. **Resolve `invoiceType` from the buyer**: `customer_profiles.vat_number` present ⇒ `TAX_INVOICE`, absent ⇒ `SIMPLIFIED_TAX_INVOICE`. Read once, at this moment, and snapshotted onto the invoice as `buyerVatNumber` — a change to the customer's registration afterwards does not reach back into it (D6), which is why the field locks on first issue (§8.4).
3. Insert the `invoices` header in `DRAFT`, consuming the next gapless number **and the next `icv`** from the sequence under the same lock, and set `previousInvoiceHash` from the preceding invoice in the chain.
4. Insert one `BOOKING` line per booking — bilingual description from the booking's snapshot fields, not from a join, so the invoice reads as the contract did on the day.
5. Sum to `subtotal_amount` / `vat_amount` / `total_amount`; set `paid_amount = "0.00"`, `outstanding_amount = total_amount`, `due_date`.
6. Build the UBL 2.1 XML, stamp it, compute `invoice_hash`, and store `xml_document_id`.
7. **Then split by type**, and this is the step that makes a billing run a partially-failing operation:
   - `TAX_INVOICE` → `status = PENDING_CLEARANCE`, `clearance_status = PENDING`, submit for clearance. On acceptance: `clearance_status = CLEARED`, `cleared_xml_document_id` set from the authority's response, `status = ISSUED`. On rejection: `status = CLEARANCE_FAILED`, `clearance_status = REJECTED`, authority errors retained.
   - `SIMPLIFIED_TAX_INVOICE` → `status = ISSUED` immediately; reporting is enqueued and moves `clearance_status` to `REPORTED` behind the response.
8. Post the `CUSTOMER_RECEIVABLE` debit set to the ledger. **This happens for a `PENDING_CLEARANCE` invoice too** — the supply occurred and the receivable is real whether or not the document has cleared. A clearance failure is a delivery problem, not a reason to forget the customer owes money.
9. Outbox event → the customer's billing contact, **gated on deliverability**: sent immediately for a simplified invoice, and only on `CLEARED` for a standard one. Emailing "your invoice is ready" while `…/pdf-url` returns `409` is the specific defect this gate exists to prevent.

**One customer failing does not abort the run.** Each customer is a separate transaction; failures are reported per customer in the job result and the rest are issued. A run that aborted wholesale on one bad row would mean a single data defect delays every corporate invoice in the month.

**A run can finish partially delivered, and that is a normal outcome.** With clearance in the path there are now three terminal shapes per invoice — `ISSUED` (cleared or not required), `PENDING_CLEARANCE` (submitted, no answer yet, retry job owns it), `CLEARANCE_FAILED` (rejected). The job result reports all three separately and the run's own `status` is `COMPLETED` even when some invoices are in the latter two: they are *outstanding work with an owner*, not a failed run. `GET /admin/invoices/clearance-queue` is where that work is then handled, and a run that leaves anything in it raises an operational alert (**AR-9**). Treating a partial clearance outcome as a failed run would make the failure of one third party look like the failure of UniGate's own billing.

**Idempotency.** `Idempotency-Key` is mandatory (§7). A replay with the same key returns the original `202` and the original `jobId` — it does not start a second run. Beneath that, `uq_invoice_lines_booking` makes a re-run with a *new* key safe as well: it finds nothing eligible and issues nothing. Two layers, because at this value the header protects against the client's retry and the index protects against everything else, including an operator running the cycle twice by hand.

**Response (`202`)**

```json
{
  "success": true,
  "data": {
    "jobId": "0192f4f0-…",
    "status": "QUEUED",
    "billingPeriodStart": "2026-09-01",
    "billingPeriodEnd": "2026-10-01",
    "estimatedCustomerCount": 23,
    "estimatedBookingCount": 418,
    "estimatedTotalAmount": "1284300.00",
    "estimatedStandardInvoiceCount": 19,
    "estimatedSimplifiedInvoiceCount": 4,
    "currency": "SAR",
    "dryRun": false
  },
  "message": null,
  "meta": {}
}
```

`estimatedStandardInvoiceCount` is how many invoices this run will put through blocking clearance — with `dryRun: true` it is the number finance should read before starting a cycle during a known provider degradation.

Progress and the per-customer result are read from `GET /reports/exports/{jobId}`-style job polling on `/admin/system/queues`; the issued invoices appear in `GET /invoices?dateFrom=…`. The per-customer result carries `invoiceNumber`, `invoiceType`, `status`, `clearanceStatus` and, on rejection, the authority errors in the same shape as `INVOICE_CLEARANCE_REJECTED.details.authorityErrors`.

**Errors**

| Status | Code | When |
|---|---|---|
| 422 | `VALIDATION_FAILED` | `end <= start`, span over 92 days, `end` in the future, or over 200 named customers |
| 422 | `INVOICE_NO_ELIGIBLE_BOOKINGS` | No unbilled bookings matched. `details: { billingPeriodStart, billingPeriodEnd, customerCount: 0 }` |
| 409 | `INVOICE_BOOKING_ALREADY_BILLED` | Raised **per customer** into the job result, not for the run, by `uq_invoice_lines_booking`. The structural guarantee that a booking can never appear on two live invoices |
| 422 | `INVOICE_CLEARANCE_REJECTED` | Raised **per invoice** into the job result, not for the run. The invoice rests in `CLEARANCE_FAILED`; it is never deleted, because deleting it would consume an `icv` and break the chain |
| 503 | `CLEARANCE_PROVIDER_UNAVAILABLE` | Returned **for the run** only when the provider is already known unreachable at enqueue time, with `Retry-After`. Mid-run unavailability does not fail the run: affected invoices stay `PENDING_CLEARANCE` and the retry job takes them |

**Notes**

- `uq_invoice_lines_booking` is a partial unique index, so double-billing is prevented by the database rather than by the job remembering what it did. This is the same protection `settlement_lines` gives against double-paying an owner, applied to double-billing a customer.
- **Numbers and `icv` are consumed before clearance is attempted, and are never given back.** A rejected invoice keeps both. This is deliberate and is the point of the chain ([database.md §12.7](database.md), [ADR-007](decisions/ADR-007-e-invoicing.md)): an invoice that vanishes leaves a gap that is externally detectable, so "clean up the bad row and re-run" is not available here and the code must not offer it.
- Applicability of any of this to UniGate is **OQ-04**, pending the tax advisor's confirmation. **No compliance is claimed.**

---

#### `POST /bookings/{id}/cancel`

Cancel a booking, compute the fee, release the vehicle and assess a refund. Requires `Idempotency-Key`.

**Request**

```json
{
  "reasonCode": "CUSTOMER_PLANS_CHANGED",
  "reasonText": "Flight rescheduled to the following week.",
  "requestRefund": true
}
```

| Field | Type | Rules |
|---|---|---|
| `reasonCode` | enum | `CUSTOMER_PLANS_CHANGED`, `CUSTOMER_FOUND_ALTERNATIVE`, `PRICE`, `OWNER_UNAVAILABLE`, `VEHICLE_BREAKDOWN`, `DRIVER_UNAVAILABLE`, `WEATHER`, `ADMIN_INTERVENTION`, `PAYMENT_FAILED`, `OTHER`. Which codes are permitted depends on the canceller's role — a customer cannot cite `VEHICLE_BREAKDOWN`. |
| `reasonText` | string ≤ 1000, required when `reasonCode = OTHER` | |
| `requestRefund` | boolean, default `true` | Ignored when `payment_status = UNPAID`. |
| `waiveFee` | boolean | **Admin only** (`bookings.manage`). Requires `reasonText`; recorded in the audit trail with the approving user. |

**Behaviour** — one transaction:

1. Assert the transition against `BOOKING_TRANSITIONS`. Legal from `PENDING_PAYMENT`, `CONFIRMED`, `DRIVER_ASSIGNED`, `READY`. **Not** from `IN_PROGRESS` (use `POST /trips/{id}/cancel`, which is `trips.manage`), nor from any terminal state.
2. Compute `hoursBeforePickup` and resolve the `cancellation_policies` charge for the canceller's role (admin-configured; **OQ-05 answered** — production seeds no charge). A global-scope admin may pass `feeOverride { type, value, reason }` instead (`403 CANCELLATION_FEE_OVERRIDE_FORBIDDEN` otherwise). The applied policy or override is **snapshotted** into `booking_cancellations.fee_rule_snapshot` / `fee_override_snapshot` with `fee_source` — changing the policy later never rewrites this record. Previously: until they are confirmed the seeded rule is a single configurable threshold from `system_settings`.
3. Write `booking_cancellations`; append to `booking_status_history`; set `bookings.status = CANCELLED`, `cancelled_at`.
4. Set the `vehicle_calendar_entries` row to `RELEASED` — retained for audit, excluded from the exclusion constraint, so the vehicle is immediately bookable again.
5. If paid and `requestRefund`, create a `refunds` row in `REQUESTED` for `total − fee`. It is **not** processed here; it enters the refund approval flow (§8.18). A refund that moves money on the same request as a cancellation would couple two failure domains.
6. Outbox events to owner, driver and customer.

**Response (`200`)**

```json
{
  "success": true,
  "data": {
    "booking": { "id": "0192f420-…", "bookingNumber": "BK-2026-000124",
                 "status": "CANCELLED", "paymentStatus": "PAID",
                 "cancelledAt": "2026-09-16T09:12:00.113Z" },
    "cancellation": {
      "cancelledByRole": "CUSTOMER",
      "reasonCode": "CUSTOMER_PLANS_CHANGED",
      "hoursBeforePickup": "92.30",
      "cancellationFeeAmount": "149.50",
      "refundAmount": "1345.50",
      "currency": "SAR",
      "feeRuleSnapshot": { "ruleCode": "DEFAULT_TIERED", "tier": ">72h", "percentage": "0.1000", "openQuestion": "OQ-05" }
    },
    "refund": { "id": "0192f440-…", "refundNumber": "RF-2026-000311", "status": "REQUESTED", "amount": "1345.50", "currency": "SAR" },
    "calendarEntryReleased": true
  },
  "message": null,
  "meta": {}
}
```

When nothing was paid, `refund` is `null` and `cancellationFeeAmount` is `"0.00"`.

**Errors**

| Status | Code | When |
|---|---|---|
| 422 | `BOOKING_INVALID_TRANSITION` | `IN_PROGRESS`, `COMPLETED`, or already terminal. `details.allowed` lists legal targets. |
| 409 | `BOOKING_ALREADY_CANCELLED` | Second cancel without the idempotency key (with the key it replays). |
| 422 | `BOOKING_CANCELLATION_WINDOW_PASSED` | Inside the no-cancel window for the canceller's role (**OQ-05**). |
| 403 | `PERM_DENIED` | `waiveFee` without `bookings.manage`. |
| 404 | `NOT_FOUND` | Not a party to the booking. |

**Notes** — `GET /bookings/{id}/cancellation-quote` runs steps 1–2 with no writes, so the confirmation dialog shows the exact fee before the customer commits. The quote and the cancellation share one service function; they cannot disagree.

---

#### `POST /payments`

Initiate payment for a booking **or** an invoice. Requires `Idempotency-Key`.

> **No client can mark a payment successful.** This endpoint creates an *intent* and hands back whatever the gateway needs the client to do next. The terminal state is set only by the gateway webhook (§10) or by an authenticated `POST /payments/{id}/sync` reconciliation.

**Request — paying one booking** (the `PREPAID` individual-customer path)

```json
{
  "bookingId": "0192f420-5555-7000-8000-000000000001",
  "invoiceId": null,
  "amount": "1495.00",
  "currency": "SAR",
  "methodType": "MADA",
  "savedMethodId": null,
  "returnUrl": "https://app.unigate.sa/ar/customer/bookings/0192f420-…/payment-return",
  "purpose": "BOOKING_PAYMENT"
}
```

**Request — paying one invoice** covering many bookings (the corporate `INVOICED` path, **A-46**)

```json
{
  "bookingId": null,
  "invoiceId": "0192f4d0-7777-7000-8000-000000000001",
  "amount": "84200.00",
  "currency": "SAR",
  "methodType": "BANK_TRANSFER",
  "returnUrl": "https://app.unigate.sa/ar/customer/invoices/0192f4d0-…/payment-return",
  "purpose": "BOOKING_PAYMENT"
}
```

| Field | Rules |
|---|---|
| `bookingId` / `invoiceId` | **Exactly one must be non-null.** Both or neither is `422 VALIDATION_FAILED` with `formErrors: ["exactly one of bookingId or invoiceId must be supplied"]` — a form-level error, not a field-level one, because neither field is individually wrong. The Zod refinement is mirrored by `ck_payments_single_target` (`num_nonnulls(booking_id, invoice_id) = 1`) in the database ([database.md §12.6](database.md)), so a payment row targeting both or neither cannot exist even if the validation is bypassed. **A payment settles a booking or an invoice, never both** — an invoice already covers its bookings, and letting one payment claim both would double-credit the receivable. |
| `amount` | Decimal string. Must equal the target's outstanding balance exactly — the booking's, or `invoices.outstanding_amount` — otherwise `422 PAYMENT_AMOUNT_MISMATCH`. It is sent **only** so the server can detect a client showing the user a stale price; it is never used as the charged amount. The charged amount is always the server's own computation. |
| `currency` | Must equal the target's currency. |
| `methodType` | `MADA`, `VISA`, `MASTERCARD`, `STC_PAY`, `APPLE_PAY`, `BANK_TRANSFER`, `CASH`. Must be enabled in `GET /payments/config`. `BANK_TRANSFER` is the dominant corporate method and returns `action.type: "NONE"` — the payment stays `PENDING` until ops reconciles it against the bank statement. |
| `savedMethodId` | Optional `payment_method_tokens` id owned by the actor. |
| `returnUrl` | Must match an allow-listed origin. An open redirect here is a phishing primitive. |

On capture of an **invoice** payment the webhook worker increments `invoices.paid_amount`, recomputes `outstanding_amount`, and moves the invoice `ISSUED`/`OVERDUE` → `PARTIALLY_PAID` → `PAID`. It does **not** iterate the invoice's bookings: a booking's `payment_status` is `INVOICED` from award and stays there. The receivable is the invoice, and settling it is one ledger posting, not *n*.

**Response (`201`)**

```json
{
  "success": true,
  "data": {
    "payment": {
      "id": "0192f430-6666-7000-8000-000000000001",
      "paymentNumber": "PM-2026-004512",
      "bookingId": "0192f420-5555-7000-8000-000000000001",
      "status": "PENDING",
      "amount": "1495.00",
      "currency": "SAR",
      "methodType": "MADA",
      "providerCode": "mock",
      "expiresAt": "2026-09-14T13:10:03.221Z",
      "createdAt": "2026-09-14T12:40:12.004Z"
    },
    "action": {
      "type": "REDIRECT",
      "url": "https://checkout.example-gateway.test/pay/ses_9f2c…",
      "method": "GET",
      "fields": null
    }
  },
  "message": null,
  "meta": {}
}
```

`action.type` is one of `REDIRECT` (hosted page), `FORM_POST` (with `fields`), `SDK` (with an opaque `clientSecret`-style payload for the mobile SDK), or `NONE` (`BANK_TRANSFER`/`CASH`, where the payment stays `PENDING` until ops reconciles it). The client must treat `action` as opaque and must not attempt to interpret provider-specific fields.

**Errors**

| Status | Code | When |
|---|---|---|
| 422 | `VALIDATION_FAILED` | Both `bookingId` and `invoiceId`, or neither (`ck_payments_single_target`) |
| 422 | `PAYMENT_AMOUNT_MISMATCH` | `details: { expected, received, currency }` |
| 409 | `PAYMENT_ALREADY_CAPTURED` | Booking or invoice already `PAID` |
| 422 | `PAYMENT_METHOD_UNSUPPORTED` | Method not enabled for the active provider |
| 422 | `BOOKING_INVALID_TRANSITION` | Booking is cancelled or completed |
| 422 | `INVOICE_NOT_PAYABLE` | Invoice status is not `ISSUED`/`PARTIALLY_PAID`/`OVERDUE` — `DRAFT`, `VOID`, `CREDITED` or already `PAID` |
| 502 | `PAYMENT_GATEWAY_ERROR` | Adapter error. The local `payments` row stays `PENDING` and a `payment_transactions` row records the failed `AUTHORIZE` attempt, so reconciliation can resolve it. **The payment is not marked `FAILED`** — an adapter error means "unknown", not "did not happen". |

**Notes**

- The active gateway is selected by configuration through the `PaymentGateway` interface. Development uses `MockGateway`. **No real provider integration exists and none is implied** — the adapter choice is **OQ-03** (candidates named in [architecture.md](architecture.md) are unimplemented).
- `payments.idempotency_key` stores the header value, giving a second, database-level guarantee against duplicate charges independent of the `idempotency_keys` table.
- `expires_at` defaults to 30 minutes; a sweeper cancels expired `PENDING` payments and returns the booking to the payment window.

---

#### `POST /webhooks/payments/:provider`

Inbound gateway callback. **No session; authenticated by signature.**

```http
POST /api/v1/webhooks/payments/mock HTTP/1.1
Content-Type: application/json
X-Signature: t=1789387200,v1=8f3b2c9e1d…
X-Event-Id: evt_01J9Z8Q2M7
```

**Processing**

1. Read the **raw body** (a `express.raw` route-level parser; JSON parsing before signature verification would let a semantically-equivalent-but-textually-different body pass a signature check).
2. Resolve `:provider` against the registry → unknown gives `404 WEBHOOK_UNKNOWN_PROVIDER`.
3. Verify the HMAC over `timestamp ‖ "." ‖ rawBody` with the provider secret, in constant time. Reject timestamps outside ±5 minutes (replay window).
4. **Persist first.** `INSERT INTO payment_webhook_events (provider_code, provider_event_id, event_type, signature_header, signature_valid, raw_payload, http_headers, processing_status='RECEIVED')`.
   - Unique violation on `uq_webhook_provider_event` ⇒ already received ⇒ return `200` immediately without reprocessing.
   - `signature_valid = false` rows **are stored** and alerted on, then answered with `401 WEBHOOK_SIGNATURE_INVALID`. A forged webhook is evidence, not an error to discard.
5. Enqueue processing. **Return `200` now** — target under 200 ms.
6. The worker loads the event, `FOR UPDATE`s the referenced `payments` row, applies the state transition (`PENDING`→`AUTHORIZED`/`PAID`/`FAILED`, or refund transitions), writes a `payment_transactions` row with redacted payloads, posts the ledger entries, advances the booking (`PENDING_PAYMENT`→`CONFIRMED` on capture), and writes outbox events. It sets `processing_status = PROCESSED` or `FAILED` with `last_error` and an incremented `attempt_count`.

**Response (`200`)**

```json
{ "success": true, "data": { "received": true, "eventId": "evt_01J9Z8Q2M7", "duplicate": false }, "message": null, "meta": {} }
```

Duplicates return the same body with `"duplicate": true`. The status is `200` either way — a 409 would make most gateways retry forever.

**Notes**

- Idempotency is the unique index `(provider_code, provider_event_id)`, not a code path that can be forgotten.
- Out-of-order delivery is handled by the state machine, not by arrival order: a late `authorized` event for an already-`PAID` payment is recorded as `IGNORED`, never a regression.
- `raw_payload` is stored whole for dispute resolution, but passes the shared `redact()` allowlist first — no PAN, CVV, token or provider secret is ever persisted, even here.
- The endpoint is exempt from the global rate limiter and instead has a per-provider limit of 600 requests/minute with a burst allowance.

---

#### `POST /documents/upload-url` + `POST /documents/{id}/confirm`

The presigned two-step. File bytes go **client → object store**, never through the API.

**Step 1 — `POST /documents/upload-url`**

```json
{
  "documentTypeCode": "VEHICLE_INSURANCE",
  "target": { "kind": "VEHICLE", "id": "0192e3c0-2222-7000-8000-0000000000v1" },
  "originalFilename": "insurance-2026.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 482113,
  "checksumSha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "issueDate": "2026-04-01",
  "expiryDate": "2027-03-31",
  "visibility": "INTERNAL"
}
```

Server-side: resolve the `document_types` row; assert `applies_to` matches `target.kind` (`422 DOCUMENT_TYPE_NOT_ALLOWED`); assert `mimeType ∈ allowed_mime_types` (`422 DOCUMENT_MIME_NOT_ALLOWED`); assert `sizeBytes ≤ max_size_bytes` (`422 DOCUMENT_SIZE_EXCEEDED`); assert `expiryDate` present when `requires_expiry` (`422 DOCUMENT_EXPIRY_REQUIRED`); assert the actor's scope covers the target (`404` otherwise). Then insert a `documents` row with `upload_status = PENDING` and a **server-generated** `storage_key` — `{bucket}/{targetKind}/{targetId}/{uuidv7}.{ext}`, never derived from `originalFilename` (path traversal, collisions, and filename-based XSS all die here).

**Response (`201`)**

```json
{
  "success": true,
  "data": {
    "documentId": "0192f450-7777-7000-8000-000000000001",
    "uploadStatus": "PENDING",
    "upload": {
      "method": "PUT",
      "url": "https://s3.example/unigate-docs/vehicle/0192e3c0-…/0192f450-….pdf?X-Amz-Signature=…",
      "headers": { "Content-Type": "application/pdf", "Content-Length": "482113" },
      "expiresAt": "2026-09-14T12:55:00.000Z"
    }
  },
  "message": null,
  "meta": {}
}
```

The presigned URL is valid for **15 minutes**, is bound to the exact `Content-Type` and `Content-Length`, and permits `PUT` only.

**Step 2 — `POST /documents/{id}/confirm`** (requires `Idempotency-Key`)

```json
{ "checksumSha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" }
```

The server calls `StorageProvider.head(storageKey)`:

| Check | Failure |
|---|---|
| Object exists | `409 DOCUMENT_UPLOAD_INCOMPLETE` |
| Stored size = declared `sizeBytes` | `422 DOCUMENT_CHECKSUM_MISMATCH` |
| Stored checksum = declared checksum | `422 DOCUMENT_CHECKSUM_MISMATCH` |
| **Magic bytes match the declared MIME** | `422 DOCUMENT_MIME_NOT_ALLOWED`, `details: { declared, detected, allowed }` |

The client's `Content-Type` header is advisory and is never trusted; the first bytes of the object decide. On success: `upload_status = UPLOADED`, `verification_status = PENDING`, and an AV scan is queued. A scan hit sets `QUARANTINED`, and every subsequent read or download of that document fails with `422 DOCUMENT_SCAN_QUARANTINED`.

```json
{
  "success": true,
  "data": {
    "id": "0192f450-7777-7000-8000-000000000001",
    "documentTypeCode": "VEHICLE_INSURANCE",
    "uploadStatus": "UPLOADED",
    "verificationStatus": "PENDING",
    "originalFilename": "insurance-2026.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 482113,
    "issueDate": "2026-04-01",
    "expiryDate": "2027-03-31",
    "visibility": "INTERNAL",
    "createdAt": "2026-09-14T12:41:55.006Z"
  },
  "message": null,
  "meta": {}
}
```

A `PENDING` row never confirmed is swept after 24 hours, and the orphaned object (if any) is deleted.

---

#### `GET /documents/{id}/download-url`

Issue a short-lived signed read URL.

**Authorization** — evaluated in this order; the first failure returns **404**, never 403 (§3.2):

1. `documents.read` permission present.
2. One of: the document is within the actor's `ActorScope`; or the actor holds `documents.download_any`; or `visibility = SHARED_WITH_COUNTERPARTY` **and** the actor is the counterparty on a booking that links the document's subject.
3. `upload_status = UPLOADED` (not `PENDING`, `FAILED` or `QUARANTINED`).

**Response (`200`)**

```json
{
  "success": true,
  "data": {
    "url": "https://s3.example/unigate-docs/vehicle/…?X-Amz-Expires=120&X-Amz-Signature=…",
    "expiresAt": "2026-09-14T12:44:00.000Z",
    "mimeType": "application/pdf",
    "originalFilename": "insurance-2026.pdf",
    "sizeBytes": 482113
  },
  "message": null,
  "meta": {}
}
```

**Notes**

- TTL is **120 seconds** — long enough to start a download, short enough that a URL pasted into a chat is useless by the time anyone clicks it.
- The URL is `Content-Disposition: attachment`-forced by the presign, with the sanitised `original_filename`. Serving a user-supplied PDF or SVG inline from a domain that shares cookies with the app is stored XSS.
- **Every issuance writes an `audit_logs` entry** (`action = document.download_url_issued`, `severity = NOTICE`) with actor, document, IP and request ID. The signed URL itself is never logged.
- `GET /invoices/{id}/pdf-url` and `GET /reports/exports/{jobId}/download-url` use the identical mechanism and TTL.

---

#### `POST /trips/{id}/status`

The single state-transition endpoint for trip execution (BRIEF-§14). Requires `Idempotency-Key`.

**Request**

```json
{
  "status": "ARRIVED_AT_PICKUP",
  "occurredAt": "2026-09-20T05:26:41.000Z",
  "latitude": 24.9576100,
  "longitude": 46.6987800,
  "accuracyM": 8,
  "note": "Waiting at Terminal 5 arrivals, column 14.",
  "odometerKm": 84213
}
```

| Field | Rules |
|---|---|
| `status` | Target `trip_status`. Validated against `TRIP_TRANSITIONS[transportType][currentStatus]` — **two transition maps keyed by transport type** ([database.md §11.2](database.md)). |
| `occurredAt` | When it happened on the device. May be in the past (offline capture); rejected if more than 15 minutes in the future or more than 24 hours in the past. `recorded_at` is server time and is always stored alongside. |
| `latitude`/`longitude`/`accuracyM` | Optional but strongly expected from the driver app. Capturing *where* a transition happened is what makes a delivery dispute resolvable. |
| `odometerKm` | Required on `TRIP_STARTED`/`LOADED` (start reading) and on `COMPLETED`/`DELIVERED` (end reading). Must be ≥ the vehicle's current `odometer_km`. |
| `proofId` | Required for `DELIVERED` on a goods trip → otherwise `422 TRIP_PROOF_REQUIRED`. |

**Transition rules.** A passenger trip has no `LOADING`/`LOADED`/`UNLOADING`/`DELIVERED` states available at all — requesting one is `422 TRIP_INVALID_TRANSITION` with `details.allowed` naming the legal targets. A goods trip cannot skip `LOADED`. `EXCEPTION` is reachable from any active state and resolves back to the prior state or to `CANCELLED`.

**Side effects**, all in one transaction:

| Target status | Effects |
|---|---|
| `DRIVER_EN_ROUTE` | Opens a `tracking_sessions` row; driver `availability_status → ON_TRIP`; vehicle `operational_status → ON_TRIP` |
| `TRIP_STARTED` / `LOADED` | Sets `actual_start_at`, `start_odometer_km`; booking → `IN_PROGRESS` |
| `ARRIVED_AT_DESTINATION` | Emits `trip.status`; notifies the customer |
| `COMPLETED` | Sets `actual_end_at`, `end_odometer_km`, `actual_distance_km`; closes the tracking session; releases the calendar entry; booking → `COMPLETED`; updates the vehicle odometer; queues invoice issuance, settlement eligibility and the rating prompt |
| `CANCELLED` | Releases the calendar entry; cascades to the booking; triggers refund assessment |

Every transition appends to `trip_status_history` with coordinates and actor, and emits a `trip.status` socket event plus an outbox notification.

**Response (`200`)**

```json
{
  "success": true,
  "data": {
    "id": "0192f460-8888-7000-8000-000000000001",
    "tripNumber": "TP-2026-000118",
    "status": "ARRIVED_AT_PICKUP",
    "previousStatus": "DRIVER_EN_ROUTE",
    "transportType": "PASSENGER",
    "occurredAt": "2026-09-20T05:26:41.000Z",
    "recordedAt": "2026-09-20T05:26:43.118Z",
    "allowedNextStatuses": ["TRIP_STARTED", "CANCELLED", "EXCEPTION"],
    "booking": { "id": "0192f420-…", "status": "READY" }
  },
  "message": null,
  "meta": {}
}
```

`allowedNextStatuses` lets the driver app render exactly the buttons that will work, from the server's own transition map rather than a duplicated client copy.

**Errors**

| Status | Code | When |
|---|---|---|
| 422 | `TRIP_INVALID_TRANSITION` | `details: { tripId, transportType, from, to, allowed }` |
| 422 | `TRIP_NOT_ACTIVE` | Trip is `COMPLETED`/`CANCELLED` |
| 409 | `TRIP_ALREADY_COMPLETED` | Completion sent twice (with an idempotency key it replays instead) |
| 422 | `TRIP_PROOF_REQUIRED` | `DELIVERED` without a delivery proof |
| 422 | `VALIDATION_FAILED` | `odometerKm` below the vehicle's current reading; `occurredAt` outside tolerance |
| 404 | `NOT_FOUND` | Actor is not a party to the trip |

---

#### `POST /tracking/ping`

Position sample from a driver app or GPS gateway. The highest-volume endpoint in the platform.

**Request**

```json
{
  "tripId": "0192f460-8888-7000-8000-000000000001",
  "latitude": 24.8201430,
  "longitude": 46.6871200,
  "accuracyM": 6,
  "headingDeg": 184,
  "speedKmh": 96.4,
  "recordedAt": "2026-09-20T06:04:11.000Z",
  "source": "DRIVER_APP"
}
```

| Field | Rules |
|---|---|
| `latitude` / `longitude` | Numbers. `-90..90` / `-180..180`. |
| `accuracyM` | Integer metres. Samples with `accuracyM > 500` are accepted but flagged `lowConfidence` and never used for ETA. |
| `recordedAt` | Device time. More than 60 s in the future, or older than the last persisted point beyond the reorder tolerance → `422 TRACKING_STALE_POINT`. |
| `source` | `DRIVER_APP` \| `GPS_DEVICE` \| `EXTERNAL_API`. |

**Write path** — deliberately tiered, so 1,000 concurrently tracked vehicles cost ~100 bounded writes/s rather than 100 appends/s to an unbounded table ([database.md §11.4](database.md)):

| Layer | Behaviour |
|---|---|
| Redis | **Every** ping. `SET loc:{vehicleId}` with 60 s TTL. Drives the socket fan-out. |
| `current_vehicle_locations` | UPSERT every ping. One row per vehicle — bounded forever. |
| `vehicle_location_points` | **Sampled.** Persisted only if ≥30 s elapsed **or** ≥50 m moved **or** heading changed >30° since the last persisted point. Monthly RANGE-partitioned. |
| Socket.IO | `trip.location` emitted to `trip:{tripId}` (§9). |

**Response (`202`)**

```json
{
  "success": true,
  "data": { "accepted": true, "persisted": false, "sequence": 412 },
  "message": null,
  "meta": {}
}
```

`persisted: false` means the sample updated the live position but was not appended to history — normal, and not an error. `202` rather than `200` because the durable write is conditional.

**Errors**

| Status | Code | When |
|---|---|---|
| 422 | `TRACKING_SESSION_NOT_ACTIVE` | No `ACTIVE` session — the trip has not reached `DRIVER_EN_ROUTE`, or it has completed |
| 422 | `TRACKING_STALE_POINT` | Clock skew or out-of-order replay beyond tolerance |
| 404 | `NOT_FOUND` | The actor is not the assigned driver (or the device is not bound to the vehicle) |
| 429 | `RATE_LIMITED` | > 30 pings/minute per trip |

**Notes**

- `tracking.publish` is held by the `DRIVER` role, and the scope layer additionally requires the actor to be the trip's assigned driver. A driver cannot publish positions for a trip that is not theirs.
- Request bodies on `/tracking/*` are capped at 256 KB.
- The batch variant (`POST /tracking/ping/batch`) returns per-item results so one bad sample does not reject 199 good ones.

---

#### `GET /tracking/trips/{id}`

The customer's live-tracking read (BRIEF-§15).

**Response (`200`)**

```json
{
  "success": true,
  "data": {
    "tripId": "0192f460-8888-7000-8000-000000000001",
    "tripStatus": "IN_PROGRESS",
    "bookingNumber": "BK-2026-000124",
    "position": {
      "latitude": 24.8201430,
      "longitude": 46.6871200,
      "headingDeg": 184,
      "speedKmh": 96.4,
      "accuracyM": 6,
      "recordedAt": "2026-09-20T06:04:11.000Z",
      "ageSeconds": 7,
      "stale": false
    },
    "vehicle": { "plateNumberEn": "ABC 1234", "description": "Toyota Hiace 2022 — Van", "colorCode": "WHITE" },
    "driver": { "fullNameEn": "Saeed Al-Otaibi", "phoneE164": "+966512000333", "ratingAvg": "4.80" },
    "destination": { "latitude": 24.6905600, "longitude": 46.6852700, "addressLine": "Al Faisaliah Tower, Olaya, Riyadh" },
    "eta": { "arrivalAt": "2026-09-20T06:31:00.000Z", "remainingDistanceKm": "41.20", "confidence": "MEDIUM" },
    "socket": { "namespace": "/rt", "room": "trip:0192f460-8888-7000-8000-000000000001" }
  },
  "message": null,
  "meta": { "computedAt": "2026-09-20T06:04:18.220Z" }
}
```

**Notes**

- `position` is read from the Redis mirror, falling back to `current_vehicle_locations`. `stale: true` when `ageSeconds > 120` — the client shows a "last seen" state rather than a confidently wrong dot.
- `driver.phoneE164` is exposed **only** while the trip is in an active state and **only** to the booking's customer. Once the trip is `COMPLETED` the field is omitted; the counterparty's phone number is not a permanent entitlement.
- `eta` is `null` with `meta.degraded: ["maps"]` when the maps provider is unavailable. Tracking degrades to a position on a map; it does not fail.
- Authorization is the scope layer: the actor must be the booking's customer, the vehicle's owner, the assigned driver, or hold `tracking.read_any`. Anyone else gets **404**.
- `socket` tells the client exactly which room to join, so room naming is not duplicated in client code.

---

#### `POST /reports/{code}/export`

Queue an export (BRIEF-§25). Requires `Idempotency-Key`.

**Request**

```json
{
  "format": "XLSX",
  "filters": {
    "dateFrom": "2026-08-01",
    "dateTo": "2026-09-01",
    "ownerProfileId": "0192e2b1-0000-7000-8000-0000000000b1",
    "status": ["COMPLETED", "CANCELLED"]
  },
  "locale": "ar",
  "timezone": "Asia/Riyadh"
}
```

`filters` is validated against the report's registered Zod schema — an unknown key is `422 VALIDATION_UNSUPPORTED_FILTER`, not silently ignored, because a silently-ignored filter produces an export that looks right and is wrong. `locale` and `timezone` affect rendering only: the underlying data stays UTC and money stays a decimal string until the writer formats it.

**Response (`202`)**

```json
{
  "success": true,
  "data": {
    "jobId": "0192f470-9999-7000-8000-000000000001",
    "reportCode": "owner-earnings",
    "format": "XLSX",
    "status": "QUEUED",
    "estimatedRowCount": 1842,
    "expiresAt": "2026-09-15T12:45:00.000Z",
    "statusUrl": "/api/v1/reports/exports/0192f470-9999-7000-8000-000000000001"
  },
  "message": null,
  "meta": {}
}
```

```http
Location: /api/v1/reports/exports/0192f470-9999-7000-8000-000000000001
```

**Errors**

| Status | Code | When |
|---|---|---|
| 404 | `REPORT_UNKNOWN_CODE` | Not in the registry |
| 403 | `PERM_DENIED` | Financial report without `reports.financial.read` |
| 422 | `REPORT_RANGE_TOO_LARGE` | Window exceeds the report's maximum span; `details.maxSpanDays` |
| 422 | `VALIDATION_INVALID_DATE_RANGE` | `dateFrom > dateTo` |
| 409 | `REPORT_EXPORT_IN_PROGRESS` | An identical `(actor, code, filters, format)` job is already `QUEUED`/`RUNNING`; `details.jobId` points at it |
| 429 | `RATE_LIMITED` | 10 exports/hour per actor; 3 concurrent |

**Notes**

- **The scope layer applies to reports exactly as it does to list endpoints** (BRIEF-§25). An owner exporting `owner-earnings` gets their own rows whatever `filters.ownerProfileId` says. The report SQL receives the same `ActorScope` predicate; there is no separate "reporting" query path that could bypass it.
- The job writes to object storage and creates a `documents` row; the result is reachable only through `GET /reports/exports/{jobId}/download-url` (120 s signed URL). There is no inline unbounded response anywhere in the reporting surface.
- `export_jobs.expires_at` is 24 hours; the object is deleted by a sweeper afterwards.
- Every export of a financial or personal-data report writes an `audit_logs` entry naming the actor, report, filters and row count.

---

## 9. Realtime contract (Socket.IO)

> **The socket layer is a delivery channel only. It never carries an authorization decision.** Every event it emits describes data the recipient could already have fetched over HTTP with the same scope rules. A client that ignores the socket entirely loses freshness, never capability — and a client that forges socket traffic gains nothing, because no server-side state changes originate from a socket message.

### 9.1 Namespace and handshake

Single namespace: **`/rt`**, mounted on the same origin and port as the API. The Engine.IO path is **`/api/v1/rt/socket.io`** — under `/api/v1` so the `ug_at` cookie (scoped to `path=/api/v1`) reaches the handshake without widening where the token travels.

```ts
const socket = io('https://api.unigate.sa/rt', {
  transports: ['websocket'],
  auth: { token: accessToken },          // mobile: the Bearer access token
  withCredentials: true                   // web: the ug_at cookie travels instead
});
```

Handshake authentication runs in `io.use()`:

1. Read the JWT from `handshake.auth.token`, or from the `ug_at` cookie when the connection carries credentials. **Never from a query string** — query strings land in proxy logs, browser history and `Referer` headers.
2. Verify signature, `iss`, `aud`, `typ = "access"` and `exp`. Failure → `connect_error` with `{ code: 'AUTH_TOKEN_INVALID' | 'AUTH_TOKEN_EXPIRED' }`.
3. Confirm the `sid` session is not revoked and the user is `ACTIVE`.
4. Resolve the permission set from `perm:{userId}:{pv}`, exactly as the HTTP middleware does, and attach `{ userId, sessionId, roles, permissions, scope }` to the socket.
5. Auto-join `user:{userId}`.

The access token expires after 15 minutes but a socket may stay connected for hours. The client therefore re-authenticates in place after each HTTP refresh:

```ts
socket.emit('auth.refresh', { token: newAccessToken }, (ack) => { /* { ok: true } */ });
```

The server re-verifies and **re-resolves the permission set**, then re-evaluates every joined room; rooms the actor can no longer access are left. A socket whose token has expired and which has not re-authenticated within a 60-second grace period is disconnected with `AUTH_TOKEN_EXPIRED`. Redis adapter (`@socket.io/redis-adapter`) provides cross-instance fan-out.

### 9.2 Rooms

| Room | Joined by | Authorization checked at join |
|---|---|---|
| `user:{userId}` | Automatic on connect | `userId === socket.data.userId`. No other user's room can be joined, ever. |
| `trip:{tripId}` | Explicit `room.join` | Actor must be the booking's customer, the vehicle's owner, the assigned driver, or hold `tracking.read_any` — **the same predicate `GET /tracking/trips/{id}` uses, calling the same policy function.** |
| `owner:{ownerProfileId}` | Explicit | Actor's `ownerProfileId` must match, or they hold `bookings.read_any`. |
| `booking:{bookingId}` | Explicit | Actor is a party to the booking, or holds `bookings.read_any`. |
| `admin:ops` | Explicit | Requires `dashboard.read` **and** `trips.read_any`. Live operations board. |

There is no wildcard room, no `broadcast` to all sockets, and no room whose name a client can construct to reach data it could not fetch over HTTP.

### 9.3 Authorization at join time — and afterwards

```
client → room.join { room: "trip:0192f460-…" }
server:  parse room name → { kind: 'trip', id }
         load the trip (via the repository, with ActorScope)
         not found or out of scope → ack { ok: false, error: { code: 'NOT_FOUND' } }
         policy.canTrack(actor, trip) === false → ack { ok: false, error: { code: 'NOT_FOUND' } }
         socket.join(room) → ack { ok: true, backfill: { … } }
```

The join ack returns **404-equivalent** for both "does not exist" and "not yours", preserving the anti-enumeration rule of §3.2 on the socket surface too.

Join-time authorization alone is not sufficient for long-lived connections: an actor's access can be revoked while they hold a room. Three mitigations:

1. `auth.refresh` re-evaluates all rooms (§9.1).
2. When a booking is cancelled or a driver is unassigned, the server explicitly evicts the affected sockets from `trip:{tripId}` and `booking:{bookingId}`.
3. Rooms are re-evaluated every 15 minutes by a sweep. Combined with the 15-minute access-token lifetime this bounds stale access to roughly one token period — the same bound the HTTP surface has.

### 9.4 Server → client events

All payloads are the same DTOs the HTTP API returns, so a client has one set of types. Every payload carries `emittedAt` and a monotonic `seq` per room.

| Event | Room | Payload |
|---|---|---|
| `trip.location` | `trip:{tripId}` | `{ tripId, latitude, longitude, headingDeg, speedKmh, accuracyM, recordedAt, stale, emittedAt, seq }` |
| `trip.status` | `trip:{tripId}`, `booking:{bookingId}` | `{ tripId, bookingId, status, previousStatus, occurredAt, allowedNextStatuses, emittedAt, seq }` |
| `bid.received` | `user:{customerUserId}` | `{ bidId, bidNumber, tripRequestId, requestNumber, ownerNameSnapshot, totalAmount, currency, estimatedArrivalAt, validUntil, emittedAt, seq }` |
| `bid.accepted` | `owner:{ownerProfileId}`, `user:{ownerUserId}` | `{ bidId, bidNumber, bookingId, bookingNumber, tripRequestId, billingMode, fulfilmentSequence, totalAmount, currency, scheduledStartAt, emittedAt, seq }` |
| `trip_request.fulfilment` | `user:{customerUserId}` | `{ tripRequestId, requestNumber, status, vehiclesRequired, vehiclesAwarded, remainder, vehiclesDispatched, vehiclesCompleted, vehiclesCancelled, emittedAt, seq }` — emitted on every counter change, including the decrement when an awarded booking is cancelled and the order reopens (**A-45**) |
| `booking.updated` | `booking:{bookingId}`, `owner:{ownerProfileId}` | `{ bookingId, bookingNumber, status, previousStatus, paymentStatus, driverProfileId, emittedAt, seq }` |
| `notification.created` | `user:{userId}` | `{ notificationId, category, templateCode, title, body, data, createdAt, unreadCount, emittedAt, seq }` |
| `opportunity.created` | `owner:{ownerProfileId}` | `{ invitationId, tripRequestId, requestNumber, transportType, pickupCityId, pickupAt, biddingClosesAt, matchScore, emittedAt, seq }` |

Example:

```json
{
  "tripId": "0192f460-8888-7000-8000-000000000001",
  "latitude": 24.8201430,
  "longitude": 46.6871200,
  "headingDeg": 184,
  "speedKmh": 96.4,
  "accuracyM": 6,
  "recordedAt": "2026-09-20T06:04:11.000Z",
  "stale": false,
  "emittedAt": "2026-09-20T06:04:11.412Z",
  "seq": 412
}
```

Every event is emitted from the **outbox relay**, after the business transaction has committed — never from inside the transaction. A rolled-back bid acceptance therefore cannot emit `bid.accepted`.

### 9.5 Client → server events

| Event | Payload | Ack | Notes |
|---|---|---|---|
| `room.join` | `{ room }` | `{ ok, backfill? }` or `{ ok: false, error }` | Authorized per §9.3 |
| `room.leave` | `{ room }` | `{ ok: true }` | |
| `auth.refresh` | `{ token }` | `{ ok, permissionVersion }` | Re-verifies and re-evaluates rooms |
| `ping` | `{}` | `{ serverTime }` | Clock-skew measurement for the driver app |

**There is no client→server event that mutates domain state.** Position updates go to `POST /tracking/ping`, not over the socket. Reasons: the HTTP path already has rate limiting, idempotency, validation, audit and a permission check; duplicating all of it on a second transport would double the attack surface and guarantee the two copies diverge. The socket is read-only by design.

### 9.6 Reconnect and backfill

Socket.IO's own reconnection is used (exponential backoff, 1 s → 30 s, jittered). On reconnect the client **re-joins** its rooms — rooms are not restored server-side, because a re-join is also a re-authorization.

`room.join` accepts an optional `sinceSeq` (or `sinceAt`) and returns a bounded backfill in the ack:

```json
{
  "ok": true,
  "backfill": {
    "trip": { "status": "IN_PROGRESS", "allowedNextStatuses": ["ARRIVED_AT_DESTINATION", "EXCEPTION", "CANCELLED"] },
    "position": { "latitude": 24.8201430, "longitude": 46.6871200, "recordedAt": "2026-09-20T06:04:11.000Z", "stale": false },
    "missedStatusEvents": [
      { "status": "ARRIVED_AT_PICKUP", "occurredAt": "2026-09-20T05:26:41.000Z", "seq": 388 }
    ],
    "seq": 412
  }
}
```

Rules:

- **Backfill is current state, not a replay of every missed message.** Location history is not replayed — a client that missed 400 pings wants the current position, and the full trail is available at `GET /tracking/trips/{id}/history`.
- **Status transitions are replayed**, capped at 50 events, because each one is semantically meaningful.
- A `seq` gap the backfill cannot close (more than 50 missed status events, or a room rejoined after more than 30 minutes) returns `backfill.truncated: true`; the client must re-fetch over HTTP.
- **The socket is never the only delivery path for anything that matters.** Every socket event corresponds to a durable row — a `notifications` row, a `trip_status_history` row, a `bookings` row. A client that was offline for the entire trip reconstructs complete state from HTTP alone. This is what makes the "delivery channel only" claim operational rather than aspirational.

---

## 10. Inbound webhooks

Applies to `POST /webhooks/payments/{provider}` (fully specified in §8.34) and `POST /webhooks/tracking/{provider}`.

| Property | Rule |
|---|---|
| **Signature verification** | HMAC-SHA256 over `timestamp ‖ "." ‖ rawBody`, compared in constant time against the provider secret held in an environment variable. The **raw body** is used — the route mounts `express.raw({ type: '*/*' })` and JSON parsing happens only after verification. Verifying a re-serialised body would accept a semantically equivalent but textually different payload and defeat the signature. |
| **Replay window** | Timestamps outside ±5 minutes are rejected, even with a valid signature. |
| **Persist, then process** | The event is written to `payment_webhook_events` and the response is sent. Processing happens in a BullMQ job. A crash mid-processing loses nothing; the provider always gets a fast acknowledgement. |
| **Idempotency** | `uq_webhook_provider_event` on `(provider_code, provider_event_id)`. A duplicate delivery hits the unique violation, is recognised as already-received, and returns `200` without reprocessing. **Idempotency is a database constraint, not a code path that can be forgotten.** |
| **Fast 200** | Target < 200 ms, budget 2 s. Gateways treat slow responses as failures and retry, amplifying load exactly when the system is already struggling. |
| **Replay tolerance** | Providers retry on any non-2xx. Because the handler is idempotent, retries are harmless. Out-of-order delivery is resolved by the payment state machine, not by arrival order: a late `authorized` for an already-`PAID` payment is recorded `IGNORED`, never applied as a regression. |
| **Invalid signatures are stored** | `signature_valid = false` rows are persisted and alerted on, then answered `401`. A forged webhook is evidence of an attack in progress, not an error to drop. |
| **Redaction** | `raw_payload` and `http_headers` pass the shared `redact()` allowlist. No PAN, CVV, token or provider secret is persisted. |
| **No authentication bypass** | The webhook route carries no session, holds no permission code, and cannot read or write anything outside the payment aggregate it names. Compromising the signing secret yields the ability to move one payment's state — which is why a state change from a webhook always writes an audit entry and a `payment_transactions` row. |
| **Rate limiting** | Exempt from the global limiter; per-provider 600 req/min with burst. |

### The rule that matters most

> **Payment success is established by the gateway and by nothing else** (BRIEF-§17, BRIEF-§49).

There is no request a client can make that marks a payment `PAID`. The customer's browser returning to `returnUrl` with `?status=success` changes nothing — `POST /payments/{id}/status` reads local state and `GET` endpoints report what the webhook (or the authenticated `POST /payments/{id}/sync` reconciliation, which calls `PaymentGateway.getPaymentStatus()` server-to-server) has established. The return URL is a navigation hint for the UI and is treated as untrusted input.

Two consequences the client team must design for:

1. After returning from the gateway, the booking may still read `PENDING_PAYMENT` for a few seconds. The UI polls `GET /payments/{id}/status` (or waits for `booking.updated` on the socket) with a bounded backoff, and shows a "confirming your payment" state — never an optimistic "paid".
2. If the webhook never arrives, the reconciliation job calls `sync` on every `PENDING` payment older than 10 minutes. Payment state converges without human intervention and without ever trusting the client.

---

## 11. Rate limiting

Implemented as a Redis sliding-window counter in `middleware/rate-limit.ts`, applied per route group. Limits are configuration, not constants in handlers.

### 11.1 Tiers

| Tier | Endpoints | Limit | Window | Key |
|---|---|---|---|---|
| **OTP send** | `POST /auth/otp/request` | see §11.3 | — | destination + IP + account + global |
| **OTP verify** | `POST /auth/otp/verify` | 5 | 10 min | `otpRequestId` (plus the durable `attempt_count` limit of 5) |
| **Auth — credential** | `POST /auth/login`, `/auth/password/forgot`, `/auth/password/reset` | 5 | 15 min | `(identifier, IP)`; **and** 20/15 min per IP |
| **Auth — session** | `POST /auth/refresh` | 30 | 5 min | `sessionId` |
| **Registration** | `POST /auth/register` | 3 | 60 min | IP |
| **Write — general** | All other `POST`/`PATCH`/`PUT`/`DELETE` | 120 | 1 min | `userId` |
| **Write — money** | `POST /payments`, `/refunds`, `/settlements/*`, `/invoices` | 20 | 1 min | `userId` |
| **Bid submission** | `POST /bids`, `PATCH /bids/{id}` | 60 | 1 min | `ownerProfileId` |
| **Read — general** | All `GET` | 300 | 1 min | `userId`, or IP when unauthenticated |
| **Reference / public** | `GET /reference/*`, `/vehicle-categories`, `/settings/public` | 600 | 1 min | IP (mostly served from cache) |
| **Tracking ping** | `POST /tracking/ping` | **30** | 1 min | `tripId` |
| **Tracking batch** | `POST /tracking/ping/batch` | 6 | 1 min | `tripId`, max 200 items |
| **Maps proxy** | `GET /geo/*` | 60 | 1 min | `userId`; plus a platform-wide daily budget guard |
| **Reports — inline** | `GET /reports/{code}` | 30 | 1 min | `userId` |
| **Reports — export** | `POST /reports/{code}/export` | **10** | 1 hour | `userId`; **max 3 concurrent jobs** |
| **Document upload** | `POST /documents/upload-url` | 60 | 1 min | `userId` |
| **Webhooks** | `POST /webhooks/*` | 600 | 1 min | `providerCode` |
| **Health** | `GET /health`, `/ready` | exempt | — | — |

Tracking ping is the highest-volume tier by design — 30/min per trip comfortably exceeds the 10-second ping interval (6/min) while still bounding a malfunctioning or malicious device. Reports are the lowest-**concurrency** tier rather than the lowest-rate tier, because the cost of a report is measured in seconds of database time, not in requests: three concurrent exports per actor is the constraint that protects the instance, and the hourly cap is secondary.

### 11.2 Headers

Every response from a rate-limited route carries the IETF draft headers:

```http
RateLimit-Limit: 120
RateLimit-Remaining: 117
RateLimit-Reset: 43
RateLimit-Policy: 120;w=60
```

`RateLimit-Reset` is **seconds remaining**, not an epoch. On a 429:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 43
RateLimit-Limit: 120
RateLimit-Remaining: 0
RateLimit-Reset: 43
```

```json
{
  "success": false,
  "data": null,
  "message": "Rate limit exceeded for policy write-general",
  "error": {
    "code": "RATE_LIMITED",
    "details": { "limit": 120, "remaining": 0, "resetAt": "2026-09-14T11:04:27.000Z", "policy": "write-general" },
    "requestId": "0192f3c2-1b88-70a4-8e55-9d2c7f41aa03"
  }
}
```

Clients must honour `Retry-After` with jitter. A client that retries immediately on 429 is treated as abusive and escalated to a longer block.

### 11.3 OTP keying and SMS toll fraud

`POST /auth/otp/request` is the one endpoint where a successful request costs real money. **SMS pumping** (also called toll fraud or IRSF) works like this: an attacker controls, or is paid by, the operator of a premium-rate number range in some jurisdiction, scripts an OTP form to request codes to thousands of numbers in that range, and collects a share of the termination fees. The victim platform's only symptom is an SMS bill — no data is stolen, no account is compromised, and a naive per-IP limit does nothing because the attacker rotates IPs while the *destinations* are what generates revenue.

Four independent buckets, all of which must pass:

| Bucket | Key | Limit |
|---|---|---|
| **Destination** | `otp:dest:{sha256(destination)}` | 3 per 15 min, 10 per 24 h |
| **IP** | `otp:ip:{ip}` | 10 per hour |
| **Account** | `otp:user:{userId}` (when known) | 10 per 24 h |
| **Global circuit breaker** | `otp:global` | A configured per-minute platform ceiling; breaching it pages on-call and degrades to email-only |

Additional controls:

| Control | Rationale |
|---|---|
| **Country allow-list** | Saudi `+966` is unrestricted. Every other country code must be explicitly enabled. This single control removes almost all toll-fraud value, because premium ranges are overwhelmingly outside the platform's actual market. A blocked prefix returns `422 VALIDATION_FAILED` with `details.reason = "UNSUPPORTED_COUNTRY"` — deliberately not `AUTH_OTP_THROTTLED`, so operations can distinguish the two in metrics. |
| **Number-range denylist** | Known premium and disposable-number ranges are refused. The list is configuration, updatable without a deploy. |
| **60 s resend cooldown** | Enforced server-side via `resendAvailableAt`, not only in the UI. |
| **Cost metering & alerting** | Every send increments a per-country counter; a 10× hour-over-hour deviation alerts. Detection speed is the real control — an unnoticed weekend of pumping is the expensive scenario. |
| **Progressive friction** | After the second request to a destination within an hour, the next requires a CAPTCHA (deferred to Phase 14 — the abstraction exists in the schema as an optional challenge token). |
| **Destination hashing** | Buckets key on `sha256(destination)`, so the Redis keyspace is not a list of phone numbers. |

`otp_requests` remains the durable audit record ([database.md §5.3](database.md)); Redis holds only the fast-path counters.

---

## 12. Versioning and deprecation

### 12.1 What is in the contract

The contract is: path, method, request schema, response schema, `error.code` values, status codes, enum values, and pagination shape. Everything in the generated OpenAPI document is contractual. `error.message` prose is not.

### 12.2 Additive changes — allowed within v1

| Change | Allowed |
|---|---|
| New endpoint | Yes |
| New **optional** request field | Yes |
| New response field | Yes — clients must ignore unknown fields |
| New optional query parameter | Yes |
| New `error.code` (for a genuinely new condition) | Yes — clients must handle unknown codes with a generic fallback |
| New enum value in a **response** | Yes, with 30 days' notice. Clients must render unknown enum values as a neutral state rather than crashing. |
| Relaxing a validation rule | Yes |
| New optional header | Yes |

### 12.3 Breaking changes — require v2

| Change | Why breaking |
|---|---|
| Removing or renaming any field | Client reads break |
| Changing a field's type (`"1250.00"` → `1250.00`) | Silent data corruption |
| Making an optional request field required | Existing writes break |
| Tightening validation on an existing field | Previously valid requests start failing |
| Removing or renaming an `error.code` | Client error handling and i18n keys break |
| New enum value accepted in a **request** where the client must produce it | Old clients cannot |
| Changing a status code for an existing condition | Retry logic breaks |
| Changing default sort, default page size, or pagination style | Silent result-set changes |
| Changing authentication or token semantics | Everything breaks |

v2 is a **new path prefix** (`/api/v2`) served by the same process. v1 and v2 coexist; they are not separate deployments. Only the changed resources are re-implemented — unchanged v1 routes are mounted into v2 unmodified, so a v2 is not a rewrite.

### 12.4 Deprecation

| Stage | Action |
|---|---|
| **T−180 days** | Deprecation announced. Affected responses carry `Deprecation` and `Sunset` headers, the OpenAPI operation is marked `deprecated: true` with an `x-sunset` extension and a migration note, and the mobile team is notified directly. |
| **T−90 days** | Reminder. Per-client usage of deprecated endpoints is reported from the access log so the remaining callers are known by name, not guessed. |
| **T−30 days** | Responses additionally carry `Warning: 299 - "This endpoint is deprecated and will be removed on 2027-03-14"`. |
| **T−7 days** | Scheduled brownouts: the endpoint returns `410 Gone` for a five-minute window each day, to surface callers that have ignored every prior signal. |
| **T** | Removal. The path returns `410 Gone` with `error.code = "ENDPOINT_SUNSET"` and a `Link` header pointing at the replacement — permanently, not a 404. A 404 would be indistinguishable from a typo. |

```http
HTTP/1.1 200 OK
Deprecation: @1789387200
Sunset: Sun, 14 Mar 2027 00:00:00 GMT
Link: </api/v2/bookings>; rel="successor-version"
```

**Minimum notice period: 180 days for any breaking change or endpoint removal; 30 days for a new response enum value.** The period is measured from the announcement, and the clock does not start until the replacement is available in production — deprecating something before its successor exists is an instruction to rewrite against nothing.

Security fixes are the single exception. A change required to close a vulnerability ships immediately, with a post-hoc notice and direct contact to affected clients.

### 12.5 Client obligations

A client is conformant to v1 if it: ignores unknown response fields; treats unknown `error.code` values as a generic failure rather than crashing; renders unknown enum values as neutral; never parses opaque strings (cursors, `action` payloads, storage URLs, tokens); and never depends on key order or on `error.message` text.

---

## 13. OpenAPI generation and client consumption

### 13.1 How the specification is produced

```
packages/validation/src/<module>/*.schema.ts
        │  Zod schemas, extended with .openapi({ … }) metadata
        │  (used unchanged by React Hook Form on the web)
        ▼
apps/api/src/modules/<module>/<module>.routes.ts
        │  registry.registerPath({ method, path, request, responses, security, tags })
        ▼
apps/api/src/openapi/generate.ts
        │  OpenApiGeneratorV31 → openapi.json (3.1.0)
        ▼
docs/openapi.json (committed)   +   GET /api/v1/docs
```

The same Zod object is the runtime validator **and** the schema source. There is no second definition to keep in sync, which is the entire point of the arrangement (P5). Shared components — the success envelope, the error envelope, `PaginationMeta`, `MoneyString`, `UuidString`, `IsoTimestamp`, every domain enum — are registered once and referenced by `$ref`, so the money and timestamp rules of §2.3 appear identically on every operation.

`pnpm openapi:generate` writes `docs/openapi.json`. CI runs it and fails if the working tree differs, so the committed spec cannot lag the code. A second CI job runs Spectral lint (operation IDs unique, every operation tagged, every response documented, no untyped `object`) and a breaking-change diff (`oasdiff`) against the previous release — a breaking diff on a `v1` path fails the build unless the PR carries an explicit `api-breaking-change` label and a §12.4 deprecation entry.

### 13.2 What the spec declares

| Element | Content |
|---|---|
| `info` | Title, version (`1.0.0`, independent of the `/v1` path prefix), contact, description linking back to this document |
| `servers` | Production, staging, and `http://localhost:4000/api/v1` |
| `tags` | One per module, ordered to match §8 |
| `securitySchemes` | `bearerAuth` (HTTP bearer, JWT) and `cookieAuth` (apiKey in cookie `ug_at`). Operations declare `[{ bearerAuth: [] }, { cookieAuth: [] }]` — either satisfies. |
| `x-permission` | Vendor extension on every operation naming the required permission code, generated from the route's `requirePermission` argument — so the spec is also the authorization reference, and it cannot drift from the middleware |
| `x-scope` | Vendor extension naming the scope class (§6.6) |
| `x-idempotent` | Vendor extension marking operations that require `Idempotency-Key` |
| Parameters | Every query parameter including the per-resource `sortBy` enum, so the allow-lists of §5.3 are discoverable |
| Responses | Success plus every documented error code per operation, each with an example |
| Examples | At least one request and one response example per operation, taken from the fixtures the contract tests use — so the documented examples are known to be valid |

### 13.3 Where it is published

| Environment | Availability |
|---|---|
| Local / CI | `http://localhost:4000/api/v1/docs` |
| Staging | `https://api-staging.unigate.sa/api/v1/docs`, open to the team network |
| Production | **Disabled by default** (`API_DOCS_ENABLED=false`). When enabled for a partner, it sits behind session auth + `system.health.read`. |
| Repository | `docs/openapi.json`, committed and versioned — the artefact the mobile team consumes, so they are never blocked on an environment being reachable |
| Release | Attached to each GitHub release tag, giving a stable historical spec per version |

### 13.4 Consumption by the future React Native client (BRIEF-§37)

The mobile app is **not** in the first implementation phase (**OQ-14**), but the API is built so that it needs no server-side work when it starts.

```
docs/openapi.json
   └─ openapi-typescript      → packages/types/src/generated/api.d.ts   (paths, operations, schemas)
   └─ openapi-fetch / Orval   → a typed client with TanStack Query hooks
```

- **Types are generated, not hand-written.** `packages/types` already holds hand-written DTOs and domain enums (canonical repo layout); the generated file sits beside them under `generated/` and is regenerated by `pnpm types:api`. A response field removed on the server becomes a **compile error** in the mobile app on the next regeneration, rather than a runtime `undefined` in front of a user.
- **The web app consumes the identical artefact**, so web and mobile cannot drift apart in their understanding of the API. The shared Zod schemas in `packages/validation` additionally give both clients the exact same form validation the server enforces — one definition, three consumers.
- **Mobile-specific transport is already in the contract**: `clientType: "IOS" | "ANDROID"` at login, body tokens instead of cookies, no CSRF header, refresh tokens in Keychain/Keystore (§6.2). No endpoint needs a mobile variant.
- **Offline and flaky networks are handled by `Idempotency-Key`** (§7), which exists primarily for this client: a retry over a dropped connection is provably safe, including a retry of something that failed.
- **Push** uses `POST /me/devices` and the `device_tokens` table; the notification subsystem treats push as one more channel behind `PushProvider`.
- **Realtime** uses the same `/rt` namespace with `auth.token` instead of a cookie (§9.1).
- A contract test suite runs the committed spec against a live API in CI (Dredd/Schemathesis over the documented examples), so "the spec says X" and "the server does X" are verified rather than assumed.

---

## 14. Additional permission codes proposed by this document

The canonical list in the project's decision record covers ~110 codes. Five endpoints in §8 have no canonical code that fits. Each is proposed below and **must be added to the seeded permission catalogue** before implementation; none is used anywhere else in this document without appearing here.

| Code | Module | Needed by | Rationale |
|---|---|---|---|
| `vehicles.read_any` | vehicles | `GET /vehicles`, `GET /vehicles/{id}` and every vehicle sub-resource for admin/ops | `vehicles.read` is genuinely held by owners for their own fleet, so it cannot double as the cross-tenant code. Every other resource with both a tenant reader and an admin reader has an `_any` variant (`bookings.read_any`, `trips.read_any`, `expenses.read_any`); vehicles is the gap. |
| `drivers.read_any` | drivers | `GET /drivers` for admin/ops | Same argument: owners hold `drivers.read` for their own drivers. |
| `documents.read_any` | documents | `GET /documents` cross-tenant listing and compliance review queues | `documents.download_any` exists and governs *fetching bytes*, but there is no code for *listing or reading metadata* across tenants — which the document-verification queue needs before any download occurs. |
| `geo.use` | platform | All `/geo/*` routes | The maps proxy has no canonical code at all. A distinct code lets the maps budget be withdrawn from a specific role (e.g. suspended owners) without touching any other capability. |
| `opportunities.dismiss` | demand | `POST /opportunities/{id}/dismiss` | `trip_requests.read` covers viewing opportunities, but dismissing one is a write against `trip_request_invitations` and should not be implied by a read code. |

`platform.jobs.manage` is referenced by `POST /admin/outbox/{id}/retry` and `GET /admin/system/queues`. It is **also proposed**, for the same reason as the above: platform job operations are neither `settings.manage` (they change no configuration) nor `system.health.read` (they are writes).

Two naming notes for the canonical list, not new codes:

- The canonical `spo` module lists `spo.commissions.read`; this document uses it for `GET /spo/commissions`. It does **not** overlap with `commissions.read`, which governs platform commission rules and booking-level commission data.
- `reports.financial.read` is treated as an **additional** requirement on financial report codes, held alongside `reports.read`/`reports.export`, not as a replacement for them.

---

## 15. Open questions affecting this contract

| ID | Item | Effect on the API |
|---|---|---|
| OQ-02 | Bid expiry and bidding window defaults | `biddingClosesAt` default; `BID_EXPIRED` timing |
| OQ-03 | Payment gateway selection | `action` payload shape on `POST /payments`; webhook signature scheme |
| OQ-04 | ZATCA e-invoicing applicability, wave and obligations | **Now shaped into the contract, not deferred** (A-49, [ADR-007](decisions/ADR-007-e-invoicing.md)). §8.19 carries the clearance/reporting split, the e-invoicing DTO block, `409 INVOICE_NOT_CLEARED` on delivery, and four endpoints. This is our *understanding* of the regime used to shape the design so compliance is achievable — **applicability is for UniGate's tax advisor and no compliance is claimed**. If it turns out not to apply, every affected invoice simply resolves `clearanceStatus = NOT_REQUIRED` and the gate never fires; no contract change, no v2 |
| ~~OQ-05~~ | ~~Cancellation fee tiers and refund policy~~ **Answered 2026-09-15** — admin-configured `cancellation_policies` (none / % / fixed, optional notice tiers) plus per-case override and waiver; `POST …/no-show`, `POST …/cancellation/waive-fee` added | `GET /bookings/{id}/cancellation-quote` and `POST /bookings/{id}/cancel` fee computation |
| OQ-06 | Settlement cycle and minimum payout | `POST /settlements` period semantics |
| OQ-10 | SMS provider | `POST /auth/otp/request` adapter; §11.3 cost controls |
| OQ-11 | GPS hardware vendor/protocol | `POST /webhooks/tracking/{provider}` payload contract |
| OQ-14 | Mobile app scope and timeline | §13.4 is designed for, not blocked by, this |
| OQ-18 | Driver-supplied vs owner-supplied vehicles in bids | Whether `driverProfileId` is required on `POST /bids` |
| OQ-23 | Whether an unfilled remainder needs a hard platform deadline | `remainderClosesAt` is nullable and defaults to open-ended; if UniGate wants a ceiling it becomes a `system_settings` default applied at publish, with no contract change |

**Closed since the last revision:**

| ID | Resolution | Where it landed |
|---|---|---|
| OQ-16 | **Resolved by A-45** (partial fulfilment, confirmed 2026-09-14). Per-request `allowPartialFulfilment`; sibling bids are rejected only at full award; `PARTIALLY_AWARDED` is a resting state | §8.11, `POST /bids/{id}/accept`, `POST /trip-requests/{id}/award`, `POST /trip-requests/{id}/close-remainder` |
| OQ-17 | **Resolved by A-46** (corporate invoicing, confirmed 2026-09-14). `billingMode` snapshotted at award; `INVOICED` bookings enter at `CONFIRMED` behind a credit check; invoices are header + lines over a billing period | §8.19, `GET /customers/{id}/credit`, `POST /admin/invoices/generate`, `POST /payments` |

Full list and current status in [assumptions.md](assumptions.md).
