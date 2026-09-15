# ADR-009 — Configuration over constants: every business value is an admin setting, grouped by section

**Status:** Accepted — **client-directed**, 2026-09-15
**Date:** 2026-09-15
**Relates to:** [ADR-002](ADR-002-database.md) (immutable snapshots), the commission (OQ-01), cancellation (OQ-05) and credit (OQ-21) answers of 2026-09-15

## Context

Over two days UniGate answered four business-rule questions the same way: *don't fix the value — let the admin decide.* Commission (charge or not, percentage or amount), cancellation and no-show charges, credit limits, payment terms. On 2026-09-15 they generalised it:

> "UniGate don't want to hard code anything, so anything that requires a value should be handled through settings, in each its own section."

The register still held eleven questions whose only content was a number or a default — bidding window, bid validity, settlement cycle, hold period, minimum payout, remainder deadline, approval SLA, billing cycle, payment term, SPO commission basis. Under this direction those are not questions for UniGate; they are **settings with a seed**, and the question becomes *what is the seed and who may change it*.

## Decision

1. **No business value is a constant in code.** Any number, threshold, window, rate, toggle or default that a reasonable operator might want to change is stored in `system_settings` and edited through the admin portal. Code carries the *behaviour*; settings carry the *value*.

2. **Settings are organised by section, one section per module.** `system_settings` gains a `section` column (`booking`, `bidding`, `dispatch`, `settlement`, `billing`, `finance`, `onboarding`, `documents`, `spo`, `tracking`, `notifications`, `retention`, `platform`). The admin UI renders one page per section; the API filters by it. A key is `section.name` (e.g. `bidding.close_before_pickup_hours`).

3. **Every setting is typed, validated, described and audited.** Each key has a `value_type`, a per-key Zod schema (range, enum, dependency on another key), a human description in English and Arabic, and a `PUBLIC` / `INTERNAL` / `SECRET` scope. Every change is an `audit_logs` entry at `NOTICE` with before/after and the acting user. `GET /settings/{key}/history` exists for exactly the questions auditors ask.

4. **Rule-shaped values are tables, not settings.** Where a value varies by scope (global → category → owner → per trip), it lives in a rules table with the resolution engine already designed — `commission_rules`, `cancellation_policies`, `document_types`, `spo_commission_models`. Settings hold the *defaults and toggles* those engines start from. The catalogue names which is which.

5. **Settings never rewrite history.** A setting is read at the moment it is used and, where the value affects money or a commitment, **snapshotted** onto the record it produced (VAT rate onto the bid, payment window onto the booking, credit terms onto the booking, settlement hold onto the settlement line). Changing a setting changes the future only. This is ADR-002's immutability rule applied to configuration.

6. **Secrets are not settings.** API keys, gateway credentials, signing keys and OTPs live in environment variables from a secret manager and are never written to `system_settings`, returned by any API, or logged. The `SECRET` scope marks *sensitive non-secret* configuration only. (Engagement brief: "Never expose private API secrets to the browser"; "Do NOT hard-code credentials.")

7. **Production seeds are conservative.** Where the client has expressed no preference, the seed is the value that charges nothing, blocks nothing and expires nothing that a human would want to review first — and it is listed on the go-live checklist, because a platform that charges no commission and never closes a bidding window is running on defaults nobody chose.

8. **Provider *choice* is deployment configuration, not a setting.** Which SMS gateway, payment gateway, e-invoicing provider or map service is wired in is decided by environment configuration and adapters (ADR-005, ADR-007), since it carries credentials and needs a deploy. Their *behavioural* parameters (OTP length, TTL, retry counts, payment window) are settings.

## The catalogue

[settings-catalogue.md](../settings-catalogue.md) is the authoritative list: every key, its section, type, seed, validation, scope, whether it is snapshotted, and the open question it absorbs. A setting used in code but absent from the catalogue is a defect.

## Consequences

**Positive.** Seven open questions close as "admin setting, seeded" (OQ-02, 06, 07, 18, 19, 22, 23) and OQ-09 collapses to a configurable model. UniGate's operations team, not a deploy, changes a bidding window. Every business value has an owner, a history and a description in two languages. Test fixtures and production diverge only in seed data.

**Negative.**
- **More surface to validate.** A wrong setting is a production incident with no code review in front of it; per-key schemas and range checks are not optional, and dependent keys (`bidding.bid_validity_hours` must not exceed `bidding.max_window_hours`) need cross-field validation.
- **Snapshot discipline everywhere.** Every place that reads a money- or commitment-affecting setting must snapshot it; the catalogue's *Snapshotted?* column is the checklist, and a code reviewer should refuse a read of such a key that does not persist the value.
- **Go-live depends on someone configuring.** The conservative seeds mean an unconfigured platform earns nothing and enforces nothing. The go-live checklist in the catalogue is the mitigation.
- **Settings are not a substitute for decisions.** UniGate still has to *choose* the values; the design only guarantees the choice is cheap and reversible. The seeds are ours and are labelled as such.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep constants, expose a few as env vars | Needs a deploy to change a business value; invisible to the operations team; no audit trail; contradicts the client's instruction |
| One flat settings page | Thirteen sections and ~50 keys on one page is unusable; the client asked for sections explicitly |
| Everything in rules tables | Most values have no scope dimension; a table per toggle is over-engineering. Rules tables are reserved for values that genuinely vary by scope |
| Feature-flag service | Adds infrastructure for what a table and a Zod schema do; can be introduced later behind the same `settings` module if flag-style rollout is needed |
