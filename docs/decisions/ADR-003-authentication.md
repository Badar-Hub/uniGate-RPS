# ADR-003 — JWT access tokens with rotating refresh tokens and server-side permission resolution

**Status:** Accepted
**Date:** 2026-09-14

## Context

The API serves a cookie-based web application today and Bearer-based native mobile applications later (RFP §5). It must support email/password, mobile/password, and mobile OTP authentication, session and device management, "log out everywhere", and permission-based RBAC in which roles are data rather than code.

Two questions needed answering: how sessions are represented, and where permissions live.

## Decision

1. **Short-lived JWT access tokens (15 min) + long-lived rotating refresh tokens (30 days) with token-family reuse detection.**
2. **Permission codes are NOT carried in the token.** The token carries a `pv` (permission version); permissions are resolved server-side per request from a Redis cache.
3. **Dual delivery:** `httpOnly` cookies for web, Bearer tokens for mobile, from the same endpoints.
4. **Argon2id** for password hashing, with parameters benchmarked rather than copied.

## Rationale

### Why not carry permissions in the JWT

The obvious design — stamp the user's permissions into the token — fails on two counts:

- **Size.** An admin with 80+ permission codes produces a large token transmitted on every request, including high-frequency tracking pings.
- **Revocation.** Removing a permission would not take effect until the token expired. For a system where an admin may need to suspend a compromised account *now*, a 15-minute window of retained privilege is unacceptable.

Instead: the token carries `sub`, `sid`, `roles`, `pv`. The middleware loads the permission set from `perm:{userId}:{pv}` in Redis (TTL 15 min), falling back to PostgreSQL. Any role or permission change increments `users.permission_version`, which changes the cache key and instantly orphans every cached set **and** every in-flight token's claimed authority.

Result: small tokens, immediate revocation, and one extra Redis read per request — a trade worth making.

### Why rotating refresh tokens with family reuse detection

A long-lived refresh token is a bearer credential; if stolen, it grants 30 days of access. Rotation alone does not fix this — it only shortens the window.

Reuse detection does. Each refresh token belongs to a `family_id`. Using a token marks it `used_at` and issues a successor. If a token that is **already used** is presented again, exactly one of two things is true: the legitimate client is replaying, or an attacker is. Either way the family is compromised.

Response: revoke the entire family and the parent session, write a `SECURITY`-severity audit entry, force re-authentication. The attacker is evicted, and the legitimate user learns something is wrong.

This costs one nullable column and one branch, and it is the highest-value control in the authentication design.

### Why dual-mode delivery

Cookies are the right answer for the browser: `httpOnly` means XSS cannot read the token, which is the dominant browser threat. Bearer tokens are the right answer for native apps, which have no cookie jar and do have platform secure storage.

Cookie mode reintroduces CSRF. Mitigated by three layers: `SameSite=Lax`, a required `X-Requested-With: unigate-web` header on state-changing requests (which a cross-origin HTML form cannot set without triggering a preflight the CORS allow-list refuses), and a strict origin allow-list with `credentials: true` and no wildcard.

### Why Argon2id

Memory-hard, resistant to GPU and ASIC acceleration, and the current OWASP recommendation. Parameters are **benchmarked on the deployment hardware** to a target verify time of roughly 250 ms, not copied from documentation — a cost parameter that is right for one machine is wrong for another.

### OTP design

6-digit codes, 5-minute expiry, 5 attempts, hashed with **HMAC-SHA256 and a server pepper**, constant-time compared.

Argon2 is deliberately *not* used for OTPs. The code space is small (10⁶), so hashing cost contributes negligible protection compared with attempt limits and expiry — while adding real latency to a hot path. Attempt limiting is the control; the hash exists to prevent a database leak from exposing live codes.

Throttling — 3/hour and 10/day per destination, 10/hour per IP — is a **launch requirement, not a hardening item**. An unthrottled OTP endpoint is a free SMS gateway for an attacker and a direct, unbounded cost to UniGate.

## Consequences

**Positive:** immediate revocation; small tokens; stolen refresh tokens are detected rather than merely time-limited; one API serves web and mobile correctly; sessions are visible and individually revocable.

**Negative:** Redis becomes a request-path dependency (mitigated by PostgreSQL fallback); dual-mode delivery adds branching in the auth middleware; reuse detection can log a legitimate user out if a client races two refreshes — mitigated by a single-flight refresh mutex in the client.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Opaque server-side sessions only | Simplest and genuinely defensible, but every mobile request would hit the session store, and the brief explicitly specifies JWT |
| Permissions embedded in the JWT | Token bloat and delayed revocation — see above |
| Non-rotating refresh tokens | A stolen token remains valid for its full lifetime with no detection signal |
| bcrypt | Adequate, but not memory-hard; Argon2id is the current recommendation and the brief prefers it |
| Third-party identity provider (Auth0, Cognito, Firebase) | Adds cost and a data-residency question (OQ-12) for a requirement the platform can meet directly. Reconsider if PDPL review makes self-managed credential storage unattractive |
