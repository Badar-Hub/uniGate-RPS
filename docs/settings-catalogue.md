# UniGate — Settings catalogue

**Governing decision:** [ADR-009 — Configuration over constants](decisions/ADR-009-configuration-over-constants.md), client-directed 2026-09-15: *"UniGate don't want to hard code anything, so anything that requires a value should be handled through settings, in each its own section."*

This is the authoritative list of every business value the platform reads at runtime. **A value used in code but absent here is a defect.** Each row gives the key, type, **production seed**, validation, API scope, whether the value is **snapshotted** onto the record it produces (so a later change never rewrites history — ADR-002), and the open question it absorbs.

Conventions: key = `section.name`; `PUBLIC` keys are served unauthenticated by `GET /settings/public`; `INTERNAL` keys need `settings.read`; changes need `settings.manage` and are audited at `NOTICE` with before/after. **Secrets are never settings** (ADR-009 §6).

> **Seeds are ours, not UniGate's.** Production seeds are deliberately conservative — charge nothing, block nothing, expire nothing without a human — so an unconfigured platform is safe but earns nothing. The go-live checklist at the end lists what must be set before launch.

---

## Rule-shaped values live in tables, not here

Where a value varies by scope (global → category → customer/owner → per case), it is a rules table with the resolution engine already designed. The settings below hold only their defaults and toggles.

| Value | Table | Resolution | Reference |
|---|---|---|---|
| Platform commission (none / % / fixed; scoped; per-trip override) | `commission_rules` + `trip_requests.commission_override_*` | specificity → priority → effective date; override beats rule | [database.md §12.3](database.md), OQ-01 |
| Cancellation and no-show charges (none / % / fixed; notice tiers; per party; per-case override/waiver) | `cancellation_policies` + `booking_cancellations.fee_*` | same | [database.md §10.3](database.md), OQ-05 |
| Mandatory documents per entity, expiry warnings, file limits | `document_types` | per document type | [database.md §6](database.md), OQ-07 |
| SPO commission model (basis, rate, vesting, clawback) | `spo_commission_models` (new, see §9) + `spo_profiles.commission_model_id` | per SPO, falling back to the default model | OQ-09 |
| Vehicle categories, makes/models, expense and maintenance types | reference tables | — | [database.md §6](database.md) |

---

## 1. `booking`

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? | Absorbs |
|---|---|---|---|---|---|---|
| `booking.min_lead_time_hours` | int | `2` | 0–168 | PUBLIC | no — validated at publish | — |
| `booking.max_lead_time_days` | int | `90` | 1–365 | PUBLIC | no | — |
| `booking.payment_window_minutes` | int | `30` | 5–1440 | INTERNAL | **yes** → `bookings.payment_due_by` | existing |
| `booking.turnaround_buffer_minutes` | int | `60` | 0–240 | INTERNAL | **yes** → `vehicle_calendar_entries.period` (both ends) | A-07 |
| `booking.allow_partial_fulfilment_default.passenger` | bool | `false` | — | INTERNAL | yes → `trip_requests.allow_partial_fulfilment` | A-45 |
| `booking.allow_partial_fulfilment_default.goods` | bool | `true` | — | INTERNAL | yes → same | A-45 |
| `booking.remainder_closes_after_days` | int \| null | `null` (open until the customer closes it) | null or 1–90 | INTERNAL | **yes** → `trip_requests.remainder_closes_at` at publish | **OQ-22** |
| `booking.remainder_reminder_after_days` | int \| null | `7` | null or 1–30 | INTERNAL | no — job reads live | **OQ-22** |
| `booking.later_wave_requires_customer_approval` | bool | `true` | — | INTERNAL | no — checked at award; an admin acting for the customer is audited either way | **OQ-23** |
| `booking.customer_cancellation_fee_owner_share_pct` | decimal | `100` | 0–100 | INTERNAL | **yes** → `booking_cancellations.fee_rule_snapshot` | OQ-05 |

## 2. `bidding`

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? | Absorbs |
|---|---|---|---|---|---|---|
| `bidding.close_before_pickup_hours` | decimal | `2` | 0–72 | PUBLIC | **yes** → `trip_requests.bidding_closes_at` | **OQ-02** |
| `bidding.max_window_hours` | decimal | `24` | 1–168 | PUBLIC | yes → same (`min(pickup − close_before, created + max_window)`) | **OQ-02** |
| `bidding.bid_validity_hours` | decimal | `24` | 1–168; ≤ `max_window_hours` | PUBLIC | **yes** → `bids.expires_at` | **OQ-02** |
| `bidding.drivers_may_bid` | bool | `false` | — | INTERNAL | no — authorisation check at submit | **OQ-18** |
| `bidding.bid_requires_driver_nomination` | bool | `false` | — | INTERNAL | no — validation at submit; driver must be assigned before dispatch regardless | **OQ-18** |
| `bidding.max_active_bids_per_owner_per_request` | int | `1` | 1–5 | INTERNAL | no | — |
| `bidding.show_effective_commission_to_owners` | bool | `true` | — | INTERNAL | no | FR-FINANCE-22 |

## 3. `dispatch`

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? | Absorbs |
|---|---|---|---|---|---|---|
| `dispatch.driver_assignment_deadline_hours_before_pickup` | decimal | `1` | 0–48 | INTERNAL | no — reminder/escalation job | — |
| `dispatch.ready_check_required` | bool | `true` | — | INTERNAL | no | — |
| `dispatch.no_show_grace_minutes` | int | `30` | 0–240 | INTERNAL | **yes** → `booking_cancellations.fee_rule_snapshot` on a `NO_SHOW` | OQ-05 |

## 4. `settlement`

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? | Absorbs |
|---|---|---|---|---|---|---|
| `settlement.cycle` | enum `WEEKLY` \| `BIWEEKLY` \| `MONTHLY` | `WEEKLY` | — | INTERNAL | **yes** → `settlements.period_start/end` | **OQ-06** |
| `settlement.cut_off_day` | enum `SUN…SAT` (weekly/biweekly) or int 1–28 (monthly) | `SUN` | depends on `cycle` | INTERNAL | yes → same | **OQ-06** |
| `settlement.hold_days_after_completion` | int | `3` | 0–30 | INTERNAL | **yes** → `settlement_lines.eligible_at` | **OQ-06** |
| `settlement.minimum_payout_amount` | money | `0` | ≥ 0 | INTERNAL | yes → carried-forward line flag | **OQ-06** |
| `settlement.payout_rail` | enum `BANK_TRANSFER` \| `GATEWAY_PAYOUT` | `BANK_TRANSFER` | `GATEWAY_PAYOUT` requires a payout-capable adapter (OQ-03) | INTERNAL | yes → `settlements.payment_reference` prefix | **OQ-06** |
| `settlement.bank_account_cooloff_hours` | int | `72` | 0–336 | INTERNAL | **yes** → `owner_bank_accounts.activation_at` | A-47 |
| `settlement.supplier_invoice_hold_periods_before_suspension` | int | `2` | 1–12 | INTERNAL | no — escalation job | FR-FINANCE-25 |
| `bidding.non_circumvention_months` | int | `12` | 0–36 | PUBLIC (shown in terms) | yes → recorded on the booking at award | FR-BIDDING-15 |
| `settlement.requires_approval` | bool | `true` | — | INTERNAL | no — gates `PENDING_APPROVAL → APPROVED` | — |
| `settlement.auto_approve_below_amount` | money \| null | `null` | null or ≥ 0; ignored when `requires_approval = false` | INTERNAL | no | — |

## 5. `billing` (corporate credit)

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? | Absorbs |
|---|---|---|---|---|---|---|
| `billing.default_cycle` | enum `PER_BOOKING` \| `WEEKLY` \| `MONTHLY` | `MONTHLY` | — | INTERNAL | yes → `corporate_customer_profiles.billing_cycle` at approval; changeable per customer | **OQ-19** |
| `billing.default_credit_terms_days` | int | `30` | 0–120 | INTERNAL | **yes** → `bookings.credit_terms_days_snapshot` at confirmation (via the customer's terms) | **OQ-19** |
| `billing.invoice_issue_day` | int | `1` | 1–28 (monthly cycles) | INTERNAL | no | — |
| `billing.overdue_reminder_days` | int[] | `[7, 14, 30]` | ascending, each 1–180 | INTERNAL | no — reminder job | OQ-21 |
| `billing.auto_suspend_on_overdue_days` | int \| null | `null` (never — UniGate: the limit is the only gate) | null or 1–180 | INTERNAL | no | OQ-21 |
| `billing.count_uninvoiced_bookings_in_exposure` | bool — **code-managed, immutable `true`** | `true` | `409 SETTINGS_KEY_IMMUTABLE` | INTERNAL | — | OQ-19/21 — listed so the rule is visible, not so it can be turned off |

## 6. `finance`

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? | Absorbs |
|---|---|---|---|---|---|---|
| `finance.vat_rate_pct` | decimal | `15` | 0–100 | PUBLIC | **yes** → `bids.vat_rate`, `booking_financial_snapshots.vat_rate`, invoices | existing |
| `finance.currency` | ISO-4217 | `SAR` | code-managed at MVP (single currency) | PUBLIC | yes everywhere | — |
| `finance.payment_methods_enabled` | enum[] | all but `CASH` | non-empty; intersected with the active gateway's supported methods | PUBLIC | no — `GET /payments/config` reads live | ADR-005 |
| `finance.invoice_line_granularity` | enum `ORDER` \| `BOOKING` | `ORDER` | — | INTERNAL | **yes** → `invoices.line_granularity_snapshot`; overridable per corporate customer | A-58 |
| `finance.commission_basis_default` | enum `GROSS` \| `NET_OF_VAT` | `NET_OF_VAT` | — | INTERNAL | yes — via the rule snapshot | OQ-01 |
| `finance.rounding_mode` | enum | `HALF_UP` | code-managed | INTERNAL | — | — |
| `finance.bad_debt_writeoff_requires_approval` | bool | `true` | — | INTERNAL | no | A-48 |

## 7. `onboarding` (owners, drivers, vehicles, customers)

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? | Absorbs |
|---|---|---|---|---|---|---|
| `onboarding.approval_sla_hours` | int \| null | `null` (no SLA) | null or 1–720 | INTERNAL | no — drives the overdue-approval queue and dashboard KPI | **OQ-07** |
| `onboarding.reapprove_on_document_renewal` | bool | `false` (renewal re-verifies the document, not the profile) | — | INTERNAL | no | **OQ-07** |
| `onboarding.vehicle_max_age_years` | int \| null | `null` | null or 1–40 | INTERNAL | no — validated at vehicle submission | — |
| `onboarding.owner_vat_status_recheck_days` | int | `90` | 1–365 | INTERNAL | no — verification job | OQ-24/25 |
| `onboarding.individual_owner_max_vehicles` | int \| null | `null` | null or ≥ 1 | INTERNAL | no | OQ-29 (TGA cap, if confirmed) |

## 8. `documents`

Mandatory documents, expiry and file limits are per type in `document_types`. Section-level:

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? |
|---|---|---|---|---|---|
| `documents.expiry_warning_days_default` | int[] | `[30, 7, 1]` | descending | INTERNAL | no |
| `documents.expired_document_blocks_dispatch` | bool | `true` | — | INTERNAL | no — checked at `READY` |
| `documents.max_upload_mb_default` | int | `10` | 1–50 | INTERNAL | no |

## 9. `spo`

`spo_commission_models` (new): `id`, `name`, `basis` (`NONE` \| `FIRST_BOOKING` \| `ALL_BOOKINGS` \| `WINDOW_DAYS`), `window_days` NULL, `calculation_type` (`NONE` \| `PERCENTAGE` \| `FIXED`), `value`, `vesting_days_after_completion`, `clawback_on_refund` bool, `is_default`, `is_active`. Each SPO references one; the default applies otherwise; the model applied is snapshotted into `booking_financial_snapshots.spo_rule_snapshot`.

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? | Absorbs |
|---|---|---|---|---|---|---|
| `spo.default_commission_model_id` | uuid | → seeded model `NONE` | must reference an active model | INTERNAL | yes via `spo_rule_snapshot` | **OQ-09** |
| `spo.attribution_window_days` | int | `30` | 1–365 | INTERNAL | yes → `bookings.spo_attribution_snapshot` | **OQ-09** |
| `spo.lead_expiry_days` | int | `30` | 1–365 | INTERNAL | no | — |

## 10. `tracking`

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? | Absorbs |
|---|---|---|---|---|---|---|
| `tracking.location_ping_interval_seconds` | int | `15` | 5–120 | PUBLIC (driver app reads it) | no | — |
| `tracking.location_retention_days` | int | `365` | 30–3650 | INTERNAL | no — retention job; **legal review OQ-08** | OQ-08 |
| `tracking.share_link_ttl_hours` | int | `24` | 1–168 | INTERNAL | yes → share token expiry | — |
| `tracking.geofence_radius_m` | int | `200` | 50–2000 | INTERNAL | no | — |

## 11. `notifications`

Provider *choice* and credentials are environment configuration (ADR-009 §8). Behaviour:

| Key | Type | Seed (prod) | Validation | Scope | Snapshotted? |
|---|---|---|---|---|---|
| `notifications.otp_length` | int | `6` | 4–8 | INTERNAL | no |
| `notifications.otp_ttl_seconds` | int | `300` | 60–900 | INTERNAL | yes → `otp_requests.expires_at` |
| `notifications.otp_max_attempts` | int | `5` | 3–10 | INTERNAL | no |
| `notifications.otp_resend_cooldown_seconds` | int | `60` | 30–600 | INTERNAL | no |
| `notifications.sms_sender_id` | string | `""` (unset — **CITC registration, OQ-10**) | ≤ 11 chars | INTERNAL | no |
| `notifications.default_locale` | enum `ar` \| `en` | `ar` | — | PUBLIC | no |
| `notifications.quiet_hours` | `{ from, to }` \| null | `null` | HH:mm | INTERNAL | no — non-urgent only |

## 12. `retention`

Every value here is **pending legal review (OQ-08)**; the seeds are the interim positions in A-41 and are labelled as such in the admin UI.

| Key | Type | Seed (prod) | Validation | Scope |
|---|---|---|---|---|
| `retention.audit_log_months` | int | `24` | ≥ 12 | INTERNAL |
| `retention.financial_records_years` | int — **floor 6, code-enforced** (VAT Implementing Regulations Art 66) | `10` | ≥ 6 | INTERNAL |
| `retention.documents_after_closure_months` | int | `12` | 1–120 | INTERNAL |
| `retention.login_attempts_days` | int | `90` | 30–365 | INTERNAL |
| `retention.otp_requests_days` | int | `30` | 7–90 | INTERNAL |

## 13. `platform`

| Key | Type | Seed (prod) | Validation | Scope |
|---|---|---|---|---|
| `platform.maintenance_mode` | bool | `false` | — | PUBLIC |
| `platform.supported_locales` | string[] | `["ar", "en"]` | code-managed at MVP | PUBLIC |
| `platform.timezone` | IANA | `Asia/Riyadh` | code-managed | PUBLIC |
| `platform.support_phone` | string | `""` | ≤ 20 chars | PUBLIC |
| `platform.support_email` | string | `""` | email or empty | PUBLIC |
| `platform.terms_version` | string | `""` | semver | PUBLIC — bumping it forces re-acceptance |
| `platform.max_sessions_per_user` | int | `10` | 1–50 | INTERNAL — sessions per user; the oldest is revoked on overflow (security.md §3.5) |
| `platform.verticals_enabled` | enum[] `PASSENGER` \| `GOODS` | `["PASSENGER"]` | non-empty; `GOODS` refused until the goods module ships (Phase 11b) | PUBLIC — drives the customer entry choice and portal sections ([ADR-010](decisions/ADR-010-vertical-modules-over-a-shared-core.md)) |

---

## Cross-field validation

Enforced by the per-key Zod schema at `PUT /settings/{key}`:

- `bidding.bid_validity_hours ≤ bidding.max_window_hours`
- `bidding.close_before_pickup_hours < booking.min_lead_time_hours` — otherwise every request closes before it opens
- `settlement.cut_off_day` shape follows `settlement.cycle`
- `settlement.payout_rail = GATEWAY_PAYOUT` refused unless a payout-capable gateway adapter is configured
- `billing.auto_suspend_on_overdue_days`, when set, must exceed the largest `billing.overdue_reminder_days`
- `retention.financial_records_years ≥ 6` — hard floor, not editable below it

## Go-live checklist — values an admin must set, because the seeds are deliberately empty

| Setting / table | Why the seed is unsafe to launch with |
|---|---|
| `commission_rules` (global) | Seeded `NONE` — **the platform earns nothing** until a rule is set (OQ-01) |
| `cancellation_policies` (all four pairs) | Seeded `NONE` — free cancellation and no-show for everyone (OQ-05) |
| `spo.default_commission_model_id` | Seeded `NONE` — SPOs earn nothing (OQ-09) |
| `notifications.sms_sender_id` | Empty — OTP delivery fails without a registered sender (OQ-10) |
| `platform.support_phone` / `support_email` / `terms_version` | Empty |
| `retention.*` | Interim values pending legal review (OQ-08) |
| `settlement.*`, `billing.*`, `bidding.*` | Seeds are ours (A-39, A-46, A-05); UniGate should confirm or change them — takes minutes, needs no deploy |

## API

`GET /settings?section=bidding` · `GET /settings/sections` (list with key counts and last-changed) · `PUT /settings/{key}` (validated, audited) · `GET /settings/{key}/history` · `GET /settings/public`. Bulk edit is a sequence of `PUT`s under one idempotency key per key; there is deliberately no "replace all" endpoint.
