# UniGate — Requirements Analysis

**Status:** Phase 0 (Requirements) — complete; 182 FRs, 58 NFRs, 21 open questions outstanding of 23 raised (OQ-16 and OQ-17 answered 2026-09-14)
**Phase:** 0 of 16
**Sources:** `docs/rfp/UniGate_RFP_extracted.md` (RFP, contractual) · UniGate engagement brief, 53 sections (operational)
**Siblings:** [architecture.md](architecture.md) · [database.md](database.md) · [api.md](api.md) · [security.md](security.md) · [assumptions.md](assumptions.md)
**Last updated:** 2026-09-14

---

## 1. Purpose & method

This document is the Phase 0 deliverable: a consolidated, traceable requirements baseline for the UniGate Vehicle Hiring & Management Platform (passenger + goods transport, Kingdom of Saudi Arabia). It exists to be argued with — every requirement carries a source, a priority and a phase, so that scope disputes resolve against evidence rather than recollection.

Requirements are drawn from **two sources of differing authority**:

1. **The RFP (`UniGate_RFP_extracted.md`)** — the contractual document. It is what UniGate has formally asked for and what a dispute would be measured against. It is approximately two pages, eight sections, ~40 bullet points.
2. **The engagement brief** — 53 numbered sections of written client instruction covering technology stack, per-role capability lists, per-subsystem behaviour, security, i18n, phasing and delivery discipline. It is far more detailed and is the practical basis for implementation, but it is an *instruction* rather than a *contract schedule*.

**The single most important Phase 0 finding is the asymmetry between these two sources.** The RFP defines almost no business rules. It names features (bidding, commission tracking, GPS, payments) without defining a single rate, threshold, window, policy or service level. It names deliverables (mobile apps, training) that the brief then defers or ignores. Every commercially significant number in this platform — commission percentage, bid validity period, cancellation fee, settlement cycle, refund policy, SPO remuneration — is absent from the contractual document.

Two consequences follow, and they shape the rest of this document:

- **The open-questions list (§6) is not housekeeping; it is the critical path.** Twenty-three questions have been raised (OQ-01…OQ-23) and **21 remain unanswered**. Several block phase completion outright. They are raised now, at Phase 0, precisely because discovering them at Phase 9 (payments) or Phase 11 (finance) would cost rework rather than an email. The two that *have* been answered — OQ-16 (partial fulfilment) and OQ-17 (corporate invoicing), both closed on 2026-09-14 — demonstrate the point: each answer changed the schema, added requirements, and spawned five further questions that nobody would have thought to ask before the first was answered (§3.8).
- **Where the two sources conflict, the conflict is escalated rather than silently resolved.** The brief cannot amend the RFP. Divergences (notably mobile apps, §3) are recorded as requiring written client confirmation.

**Method.** Each RFP clause was enumerated (RFP-1 … RFP-8, 31 discrete clauses) and each brief section indexed (BRIEF-§1 … BRIEF-§53). Functional requirements were derived from the brief's per-role capability lists (BRIEF-§5) and per-subsystem sections (BRIEF-§6–§35), then cross-checked against the RFP for clauses with no brief coverage. Non-functional requirements had to be **proposed** in full, because the RFP and brief between them set no measurable target of any kind. Every requirement is mapped back to source in §8, and RFP coverage is demonstrated at 100%.

**Conventions used throughout.**

| Convention | Meaning |
|---|---|
| `FR-<MODULE>-<nn>` | Functional requirement, `<MODULE>` is one of the canonical 18 API modules |
| `NFR-<nn>` | Non-functional requirement |
| `OQ-<nn>` | Open question requiring a client decision (fixed IDs, do not renumber) |
| `A-<nn>` | Interim working assumption recorded in [assumptions.md](assumptions.md) |
| MoSCoW | MUST (launch-blocking) · SHOULD (launch-valuable, deferrable) · COULD (opportunistic) |
| Phase | Implementation phase 0–16 per BRIEF-§48 |
| `PROPOSED` | A target invented by the delivery team, **not** a client requirement |

No regulatory compliance is claimed anywhere in this document. References to PDPL, ZATCA, TGA and PCI-DSS describe obligations that **require legal and tax review** by UniGate's advisors; they are raised as open questions, never as satisfied requirements.

---

## 2. Source documents

| Source | Form | Authority | What it covers | What it does **not** cover |
|---|---|---|---|---|
| `docs/rfp/UniGate_RFP_extracted.md` (RFP, Oct 2025) | Extracted `.docx`, ~2 pages, 8 sections, 31 clauses | **Contractual** — the formal ask; governs in any dispute | Objective; scope headings; 3 user roles; 6 deliverables; 5 payment method names; EN/AR; proposal and evaluation process | Any business rule, rate, threshold, policy, volume, SLA, retention period, or acceptance criterion |
| UniGate engagement brief (53 sections) | Written client instruction | **Operational** — directive for implementation; cannot amend the RFP | Mandated stack; monorepo layout; per-role capability lists; entity candidates; lifecycle states; RBAC model; security/privacy expectations; API + pagination conventions; phasing 0–16; delivery discipline | Commission rate, bid window, cancellation policy, settlement cycle, SPO commission model, volumes, SLAs — BRIEF-§51 explicitly acknowledges these are unresolved |
| `docs/database.md` | Delivery artefact (Phase 1) | Derived design | 76 tables across the 18 modules; enums and lifecycles; concurrency design; deviations from BRIEF-§33 with justification | Nothing contractual; consumes this document |
| Canonical decisions register | Delivery artefact | Binding on naming | Module names, permission codes, error codes, envelope, OQ IDs, phases | Business rules |

> **Authority rule applied throughout:** where the brief is silent the RFP governs; where the RFP is silent the brief governs; where they conflict, neither is treated as decided — the conflict is listed in §3 and referred to the client.

---

## 3. Critical gaps between the RFP and the engagement brief

This is the highest-value section of the Phase 0 analysis. Each finding is evidenced against the source text.

### 3.1 The RFP collapses Owner and Driver into one role; the brief separates them

**Evidence.** RFP §4 names exactly three user groups: `Admin`, `Vehicle Owner / Driver` ("Registers vehicles, manages bids, trips, and maintenance"), and `Customer`. The slash is the whole specification. BRIEF-§5 lists **Vehicle Owner** and **Driver** as separate actors with materially different capability sets — an owner registers vehicles, submits bids, views earnings, records maintenance and manages settlements; a driver views an assigned vehicle, starts trips, shares location, updates trip status and reports issues. A driver must never see owner earnings; an owner must be able to operate without ever driving.

**Why it matters.** Modelled as one role, either drivers gain access to the owner's financial data (a privacy and commercial breach against BRIEF-§28) or owners lose the driver-side trip execution screens. Modelled as two disjoint accounts, the owner-operator — a single person who owns one truck and drives it — must maintain two logins, which is the most common small-operator profile in this market and would be an immediate adoption failure.

**Resolution adopted.** Owner and Driver are modelled as **separate profiles that a single user account may hold simultaneously**. `users` carries identity and credentials; `owner_profiles` and `driver_profiles` are independent 1:1 extensions, and both may exist for the same `user_id` ([database.md](database.md) §6.2, deviation V12). Authorization is permission-based, never role-string-based, so the owner-operator simply holds the union of `VEHICLE_OWNER` and `DRIVER` role grants and sees both portals. The portal route groups `/owner` and `/driver` remain separate (BRIEF-§35) with a profile switcher. This satisfies both sources without compromise, and is recorded here rather than assumed silently.

**Residual question.** Whether a driver may exist **without** an owner (an independent driver offering themselves against an owner's vehicle, or supplying their own) is not answered by either source — **OQ-18**. The schema permits `driver_profiles.owner_profile_id` to be NULL; the bidding service currently requires the bid vehicle to belong to the bidding owner.

### 3.2 SPO appears exactly once in the entire RFP — and the brief requires a full portal

**Evidence.** Search the RFP for "SPO": there is one occurrence, a parenthetical inside RFP §4 describing what the *Admin* manages — "Manages all users (vehicle owners, customers, and SPOs – Sales Promotion Officers)". SPO is not a listed user group in RFP §4. There is no SPO deliverable in RFP §5, no SPO feature in RFP §3, no commission rule, no attribution rule, no definition of what an SPO does.

Against that single parenthetical, BRIEF-§5 requires an SPO actor with profile, assigned customers, leads, referrals, bookings attributed to the SPO, commission, commission status and reports; BRIEF-§35 requires a full `/spo/{dashboard,customers,referrals,bookings,commissions}` portal; BRIEF-§25 requires SPO performance reporting; BRIEF-§18/§19 imply SPO commission participates in the financial snapshot of every booking.

**Why it matters — this is the largest single scope and requirement risk in the project.**

- **Scope.** A portal, an attribution chain, a commission engine and a report set are being built on a parenthetical. If UniGate's commercial intent is narrower (e.g. SPOs are internal staff tracked in a spreadsheet), a material portion of Phases 4, 11 and 13 is wasted. If it is broader (SPO hierarchies, overrides, targets, clawbacks), the current model is structurally insufficient.
- **Financial.** SPO commission is a deduction from platform margin on every attributed booking. `booking_financial_snapshots.spo_commission_amount` is written once and never recomputed (D6). Getting the model wrong is not a configuration change — it is a data correction exercise across historical bookings.
- **Legal/HR.** Whether SPO commission is employee remuneration (payroll, GOSI, withholding) or a supplier commission (invoice, VAT) is a question for UniGate's advisors and changes the payout mechanism entirely.

**Position taken.** A **minimal but real** attribution chain is modelled — `spo_profiles`, `spo_customer_assignments` (one active assignment per customer), `spo_leads`, plus `attributed_spo_profile_id` carried on `trip_requests` and `bookings` ([database.md](database.md) §6.2, deviation V13). The commission model itself is a deliberately open `jsonb` column and the calculation is **not implemented**; `spo_commission_amount` is written as zero until **OQ-09** is answered. Everything downstream is therefore correct-but-inert rather than wrong. This is flagged in the risk register as R-02.

### 3.3 The RFP requires Android and iOS apps as a named deliverable; the brief defers mobile

**Evidence.** This is a direct, contractual divergence and the most consequential one.

| Source | Text | Effect |
|---|---|---|
| RFP §2 | "a web platform **and mobile application**" | Mobile is part of the stated objective |
| RFP §3, bullet 1 | "Design and development of a web portal **and mobile applications (Android & iOS)**" | Mobile is in scope of work |
| RFP §5, bullet 2 | "**Mobile applications** for customers and vehicle owners/drivers" | Mobile is a named **deliverable** |
| BRIEF-§37 | "RFP requires Android and iOS apps… **Do NOT build mobile in first implementation phase unless instructed.** Prepare for future `apps/mobile`. Document APIs for the mobile team." | Mobile is out of the first phase |
| BRIEF-§48 | Phases 0–16 contain **no mobile phase** | Mobile has no schedule |

**Why it matters.** A vendor that delivers Phases 0–16 in full has still not delivered RFP §5 bullet 2. The brief is an instruction from the client, but it is not visibly a contract amendment, and "do not build X in the first phase" is not the same statement as "X is removed from the contract". The delivery team cannot resolve this; it is a commercial question with a commercial answer.

**Required action — this must be confirmed in writing (OQ-14).** Specifically: (a) is mobile removed from this engagement's scope, deferred to a named later phase, or still expected within the current commercial envelope; (b) if deferred, what is the agreed date and is it separately priced; (c) is React Native + Expo (BRIEF-§37's recommendation) accepted.

**What is built regardless.** The API is built as a first-class independent product, not as a Next.js backend-for-frontend: versioned REST at `/api/v1`, a stable response envelope, Bearer-token auth for non-browser clients alongside cookie auth for web (canonical auth decisions), device/session tracking with `client_type` of `WEB`/`IOS`/`ANDROID` ([database.md](database.md) §5.2), `device_tokens` with `IOS`/`ANDROID`/`WEB` platforms for push, and OpenAPI documentation. A mobile team can therefore start without backend rework. That mitigates the risk; it does not close the contractual gap.

### 3.4 Two RFP deliverables have no technical specification and are commercial, not code

**Evidence.**

- **RFP §5, bullet 6 — "Deployment support and staff training."** No audience, no headcount, no format (on-site/remote), no duration, no language, no materials list, no acceptance test. Training UniGate's operations staff on the admin portal in Arabic for two days is a different commitment from training a customer-service organisation of fifty.
- **RFP §6, bullet 6 — "Ownership and data policy."** This is an item the *proposal* must address: who owns the source code, the data, the derived analytics; what the licensing position is; what happens to data on termination. It has no implementation.
- **RFP §6, bullet 5 — "Maintenance and support terms"** and **RFP §7, bullet 4 — "Post-launch support and maintenance offerings"** are likewise commercial terms, and they interact with NFRs: a support commitment implies an availability target, which the RFP never states (see §3.5).

**Why it matters.** These are acceptance-bearing deliverables with no definition of done. A dispute over "was training delivered" has no objective resolution. They also sit outside the phase plan — BRIEF-§48's Phase 16 is "Deployment", not "Deployment support and training".

**Treatment.** Recorded as **commercial/contractual items outside the code scope**, traced in §8 to the commercial workstream rather than to an FR. They are not silently dropped, and they are not padded into the engineering estimate. Deployment *automation and runbooks* (a technical artefact) is in Phase 16 and is distinct from *deployment support* (a service commitment).

### 3.5 The RFP specifies **no** non-functional requirements whatsoever

**Evidence.** The RFP contains: no user volume, no vehicle or booking volume, no concurrent-user figure, no peak-load profile, no response-time budget, no uptime or availability target, no RPO/RTO, no backup or disaster-recovery expectation, no data retention period, no browser support matrix, no device or screen-size matrix, no accessibility standard, no security standard or certification, no penetration-test requirement, no data residency requirement, no localisation depth beyond "English & Arabic", and no maintenance-window expectation. The brief adds engineering *practices* (BRIEF-§27 security, BRIEF-§41 observability, BRIEF-§32 pagination) but likewise sets **no measurable target** — BRIEF-§51 effectively concedes this by instructing the team to assume and record rather than guess silently.

**Why it matters.**

- Capacity, hosting cost and topology cannot be sized. The tracking design ([database.md](database.md) §11.4) is dimensioned against an *assumed* 1,000 concurrently-tracked vehicles; at 50 that is over-built, at 50,000 it is wrong.
- "Performant" (BRIEF-§1) is unacceptable as an acceptance criterion. Without a number, performance testing has no pass condition and Phase 15 cannot close objectively.
- Availability targets drive redundancy, which drives cost. Committing to support terms (RFP §6) without an agreed uptime figure is commercially open-ended.
- Retention periods are a legal question in KSA (PDPL applicability **requires legal review** — OQ-12) and a schema question: `audit_logs` and `vehicle_location_points` are partitioned monthly specifically so that retention can be implemented by detaching partitions, but the period is unset (OQ-08).

**Consequence — stated plainly.** **Every non-functional requirement in §5 of this document is a proposed assumption authored by the delivery team, not a client requirement.** Each is labelled `PROPOSED — requires client confirmation (OQ-15)`. They are engineering-defensible defaults for a KSA regional platform at launch scale, they are what the architecture is built against, and they become requirements only when UniGate confirms them in writing. Until then no availability, performance or retention commitment should appear in any contract schedule.

### 3.6 Five payment methods are named; nothing about how money actually moves is specified

**Evidence.** RFP §3 requires "Integration of payment gateways (Mada, Visa, MasterCard, STC Pay, Apple Pay)" and RFP §5 lists "Payment gateway setup and testing" as a deliverable. BRIEF-§17 adds the abstraction requirement, entity set and states, and an explicit instruction not to build fake integrations. Between them, the following are **undefined**:

| Missing | Consequence | OQ |
|---|---|---|
| Which gateway/acquirer (HyperPay, Moyasar, PayTabs, Checkout.com, direct bank) | Determines API surface, webhook contract, settlement file format, onboarding lead time, and whether Apple Pay/STC Pay are actually available | OQ-03 |
| Platform commission rate and model | Every booking's financial snapshot depends on it; it is the platform's entire revenue line | OQ-01 |
| Commission basis — gross or net of VAT | Changes the platform's revenue by the VAT fraction on every transaction | OQ-01 |
| Settlement terms to owners (cycle, cut-off, minimum payout, hold period) | Determines owner cash-flow expectations and platform float; drives Phase 11 | OQ-06 |
| Cancellation policy and refund rules | Determines what the customer is charged when they cancel; unimplementable as stated | OQ-05 |
| Whether the platform is merchant of record or a marketplace facilitator | Changes who issues the tax invoice, who bears chargebacks, and the VAT treatment — **requires tax review** | OQ-04 |
| ~~Corporate credit terms (BRIEF-§7 implies invoicing) vs prepayment~~ | **ANSWERED 2026-09-14 (A-46).** Corporates are invoiced in arrears against an approved credit limit; individuals prepay. `PENDING_PAYMENT → CONFIRMED` without a capture is now a designed path, not a question — an `INVOICED` booking never enters `PENDING_PAYMENT` at all ([database.md](database.md) §10.2). The receivable, the ageing and the working-capital exposure are new and are **OQ-19…OQ-21** | ~~OQ-17~~ closed |

**Why it matters.** Payment method *names* are a UI concern and cost little. Everything above is a business-model concern and is load-bearing for Phases 8, 9 and 11. A commission rate cannot be "figured out later" because BRIEF-§18 and design principle D6 require historical financials to be frozen — a rate introduced late does not retroactively fix bookings already snapshotted.

**Position taken.** `PaymentGateway` is an interface with a `MockGateway` for development; no production adapter is written until OQ-03 is answered. `commission_rules` supports `PERCENTAGE`/`FIXED`, `GROSS`/`NET_OF_VAT` basis, and global/category/owner/owner-category scoping with effective-dating, so answering OQ-01 is a seed change rather than a code change. Cancellation fee rules are snapshotted per cancellation rather than hard-coded. This is deliberate insulation against late answers — it is not a substitute for them.

### 3.7 Additional gaps of lower magnitude

| # | Gap | RFP position | Brief position | Handling |
|---|---|---|---|---|
| a | "Data privacy controls allowing owners to restrict non-business information" (RFP §3) | One sentence, no field list | BRIEF-§28 requires separation of public/business/private/administrative profile data | `owner_profiles.privacy_settings` jsonb + `documents.visibility` enum + DTO-layer field gating; the exact field classification is a client decision |
| b | GPS tracking (RFP §3) | Named, no source | BRIEF-§15 requires provider abstraction and names three possible sources | `TrackingProvider` interface; driver-app GPS only at launch; hardware vendor/protocol is **OQ-11** |
| c | Multilingual interface (RFP §3) | "English & Arabic" | BRIEF-§1/§29 add RTL, no hard-coded strings, extensibility to more languages | Covered; but RFP is silent on whether *content* (owner business names, notes, complaint text) must be bilingual — assumed not |
| d | "Platform analytics and reporting" (RFP §3) | Two words | BRIEF-§24/§25 give a KPI list and eleven report families | Brief governs; no RFP-side acceptance criterion exists for analytics |
| e | Vehicle "availability" (RFP §3) | Listed as a vehicle attribute | BRIEF-§45 requires conflicting-period prevention | Modelled as a time-window calendar with a DB exclusion constraint, **not** a status column (deviation V2/V3) — a deliberate departure from the RFP's implied attribute model |
| f | Multi-vehicle requests | Not mentioned | BRIEF-§11 has `number of vehicles`; BRIEF-§12 says one accepted bid unless multiple vehicles required | **No longer a gap — OQ-16 answered 2026-09-14 (A-45).** Partial fulfilment across dispatch waves is now a confirmed requirement: one booking per accepted bid, the order rests in `PARTIALLY_AWARDED`, siblings are rejected only on full award ([database.md](database.md) §8.4, §8.6). See §3.8 and FR-DEMAND-11…-16 |
| g | Trip request → bid eligibility | Not mentioned | BRIEF-§12 "owners receive eligible trip requests" — eligibility undefined | City + category + approval-status matching at launch; radius matching deferred (A-11) |

### 3.8 Two load-bearing business rules were in neither source and surfaced only when the client was asked directly

**Evidence.** On 2026-09-14 UniGate answered OQ-16 and OQ-17. Both answers describe behaviour that is central to how the platform earns money, and **neither appears anywhere in the RFP or in the 53-section engagement brief** — not as a requirement, not as a hint, not as a deferred item.

| Confirmed rule | RFP position | Brief position | What it actually changed |
|---|---|---|---|
| **Partial fulfilment across dispatch waves (A-45).** An order for N vehicles is accepted with whatever capacity exists, dispatched, and the balance filled later. The order rests in `PARTIALLY_AWARDED` indefinitely and is never expired or closed by the system | Silent. Multi-vehicle hire is not mentioned at all | BRIEF-§11 supplies a `number of vehicles` field; BRIEF-§12 says "one accepted bid unless multiple vehicles are required". Neither says what happens when only some arrive | A new stable lifecycle state, a per-request `allow_partial_fulfilment` flag, four fulfilment counters, a wave number on every booking, per-wave pricing and scheduling, the **removal** of the `bidding_closes_at <= pickup_at` constraint, and an expiry job that must now skip partially awarded orders ([database.md](database.md) §8.1, §8.4, §8.6) |
| **Corporate invoicing in arrears (A-46).** Corporates are billed against an approved credit limit; individuals prepay | Silent. RFP §3 names five card and wallet payment methods and nothing else | BRIEF-§7 distinguishes individual from corporate customers and mentions credit terms as a *field*; no billing behaviour, no invoicing model, no credit control | A `billing_mode` snapshot that changes the booking's **entry state**, a header/line invoice covering many bookings, a credit check inside the award transaction, payments that target an invoice rather than a booking, receivables ageing, and a materially larger ZATCA exposure ([database.md](database.md) §10.1–10.2, §12.6) |

**Why this is recorded rather than quietly absorbed.**

- **It is evidence that the gap analysis worked.** Neither rule would have been discovered by reading the two sources more carefully, because neither source contains them. They were found by enumerating what the sources *fail* to decide (§6) and putting the list in front of the client. Two of the eighteen questions came back with answers that added 22 functional requirements and changed five tables. That is the return on §6 existing at all.
- **It is the argument for the remaining 21 questions.** If two questions picked more or less at random from the register turned out to be schema-changing, the presumption must be that the others are too. OQ-20 in particular — whether owner settlement waits for a corporate customer to pay — is a working-capital commitment that follows directly from an answer UniGate has already given, and it was not visible as a question until that answer arrived.
- **It calibrates the estimate.** Both answers arrived during Phase 0/1, when the cost of absorbing them was a schema revision and a document pass. The same two answers arriving at Phase 9 would have meant migrating live bookings and restating financial snapshots that design principle D6 deliberately makes immutable. Late answers are not more expensive by a little.

Each answer also **opened new questions rather than closing the topic**: partial fulfilment raised OQ-22 (how long a remainder stays open) and OQ-23 (who consents to a later wave); corporate invoicing raised OQ-19 (cycle and terms), OQ-20 (settlement timing) and OQ-21 (limit breach and overdue handling). These are tracked in §6 alongside the originals and are not treated as detail.

---

## 4. Functional requirements catalogue

**182 requirements** across all 18 canonical modules — 160 derived from the RFP and the engagement brief, plus **22 added on 2026-09-14** from UniGate's answers to OQ-16 and OQ-17 (§3.8), which are marked `CLIENT 2026-09-14` in the source column. Actor abbreviations: **C** customer · **O** vehicle owner · **D** driver · **S** SPO · **A** admin/ops · **SYS** system/scheduled job. Phase numbers follow BRIEF-§48. Where a requirement is derived rather than stated verbatim, the source column shows the nearest governing clause.

### 4.1 `iam` — identity, authentication, authorization

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-IAM-01 | Register an account with email + password, creating a `PENDING_VERIFICATION` user | C, O, D | RFP §3 / BRIEF-§6 | MUST | 3 | Argon2id; password never stored or logged in plaintext |
| FR-IAM-02 | Register an account with a Saudi mobile number + password | C, O, D | RFP §3 / BRIEF-§6, §30 | MUST | 3 | `phone_e164`, unique where not null |
| FR-IAM-03 | Verify the mobile number by OTP before the account becomes `ACTIVE` | C, O, D | RFP §3 / BRIEF-§6 | MUST | 3 | RFP §3 names OTP for customers; applied to all self-registered actors |
| FR-IAM-04 | Authenticate with email + password | all | BRIEF-§6 | MUST | 3 | Access JWT 15 min plus rotating refresh token |
| FR-IAM-05 | Authenticate with mobile + password | all | BRIEF-§6 | MUST | 3 | Same token contract |
| FR-IAM-06 | Authenticate with mobile + OTP without a password | C | BRIEF-§6 | SHOULD | 3 | Supports OTP-only accounts where `password_hash` is NULL |
| FR-IAM-07 | Request a password reset and complete it with a single-use expiring token | all | BRIEF-§6 | MUST | 3 | Response identical whether or not the identifier exists — no enumeration |
| FR-IAM-08 | Change password while authenticated, revoking all other sessions | all | BRIEF-§6 | MUST | 3 | Sets `password_changed_at`; older sessions become invalid |
| FR-IAM-09 | Exchange a refresh token for a new pair with rotation and family reuse detection | all | BRIEF-§6, §27 | MUST | 3 | Replay revokes the family and session, writes a `SECURITY` audit entry — `AUTH_REFRESH_REUSE_DETECTED` |
| FR-IAM-10 | Log out the current session | all | BRIEF-§6 | MUST | 3 | Revokes session and its refresh family |
| FR-IAM-11 | Log out every session for the account | all | BRIEF-§6 | MUST | 3 | |
| FR-IAM-12 | List active sessions with device, client type, IP and last-seen, and revoke any one | all | BRIEF-§6 | SHOULD | 3 | Device and session tracking |
| FR-IAM-13 | Throttle OTP issuance and verification per destination and per IP with attempt caps and expiry | SYS | BRIEF-§6, §39 | MUST | 3 | Redis fast path, `otp_requests` durable record; `AUTH_OTP_THROTTLED`, `AUTH_OTP_INVALID` |
| FR-IAM-14 | Apply progressive lockout after repeated failed authentications | SYS | BRIEF-§27 | MUST | 3 | Driven by `login_attempts`; `AUTH_INVALID_CREDENTIALS` returned uniformly |
| FR-IAM-15 | Define roles and permissions as data so a new role can be created and granted with no code change | A | RFP §4 / BRIEF-§5 | MUST | 3 | ~110 seeded `resource.action` codes; checks are `requirePermission(...)`, never role-string comparisons |
| FR-IAM-16 | Enforce record-level scope in the repository layer so an actor without a `*_any` permission can only read their own rows | SYS | BRIEF-§27, §49 | MUST | 3 | Two-layer authorization; reads of invisible records return 404, not 403 |

### 4.2 `profiles` — customer, owner, driver and SPO profiles

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-PROFILES-01 | Maintain an individual customer profile with name, locale, timezone, default city and saved locations | C | RFP §3 / BRIEF-§5, §7 | MUST | 4 | |
| FR-PROFILES-02 | Maintain a corporate customer profile with company name, CR number, VAT number, billing address and contact person | C | BRIEF-§7, §30 | MUST | 4 | 1:1 extension; credit terms are enforced at award — see FR-PROFILES-13 and FR-BIDDING-14 |
| FR-PROFILES-03 | Register as a vehicle owner and complete an onboarding profile as individual or company | O | RFP §3, §4 / BRIEF-§5 | MUST | 4 | DRAFT → DOCUMENTS_SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED |
| FR-PROFILES-04 | Submit owner identity and business documents for verification | O | BRIEF-§5, §10 | MUST | 4 | National ID or Iqama, CR, VAT certificate |
| FR-PROFILES-05 | Review, approve, reject with reason, or suspend an owner | A | BRIEF-§5, §26 | MUST | 4 | Workflow and SLA are **OQ-07**; every decision audited |
| FR-PROFILES-06 | Restrict which owner profile fields are visible to customers and counterparties | O | RFP §3 / BRIEF-§28 | MUST | 4 | `privacy_settings` jsonb enforced in the DTO mapper, never client-side |
| FR-PROFILES-07 | Create and manage driver records belonging to an owner | O | BRIEF-§5, §9 | MUST | 4 | Owner to driver is one-to-many |
| FR-PROFILES-08 | Maintain a driver profile with ID type, licence number, licence expiry and licence categories | D, O | BRIEF-§9 | MUST | 4 | ID and licence encrypted at rest with last4 plus blind index for lookup |
| FR-PROFILES-09 | Approve or reject a driver before they may be assigned to a trip | A | BRIEF-§9 | MUST | 4 | Gate applies at dispatch, not at account creation |
| FR-PROFILES-10 | Allow one user account to hold owner and driver profiles simultaneously | O, D | RFP §4 / BRIEF-§5 | MUST | 4 | Resolves the RFP's combined "Vehicle Owner / Driver" role — see §3.1 |
| FR-PROFILES-11 | Maintain an SPO profile with employee code, region and manager | A, S | RFP §4 / BRIEF-§5 | SHOULD | 4 | Commission model held as open `jsonb` — **OQ-09** |
| FR-PROFILES-12 | Assign customers to an SPO and record leads with their conversion outcome | S, A | BRIEF-§5 | SHOULD | 4 | One active assignment per customer; attribution copied onto requests and bookings at creation |
| FR-PROFILES-14 | Capture and validate a corporate customer's **VAT registration number, Commercial Registration number and Saudi National Address** (building number, street, district, city, postal code, additional number) at onboarding; refuse `INVOICED` billing approval until all three are present and valid; mirror the record to the e-invoicing provider as a contact keyed by the customer id | C, A, SYS | `CLIENT 2026-09-15` (OQ-24 discussion); ZATCA XML standard BR-KSA-09, BR-KSA-66…70 | MUST | 4, 11 | These are the mandatory buyer fields of a standard tax invoice; UniGate already supplies them to Wafeq manually today. Validation: VAT 15 digits starting/ending `3`, CR 10 digits, postal code 5 digits, building/additional number 4 digits |
| FR-PROFILES-13 | Apply for, approve, suspend and revise a corporate credit facility — limit, payment terms in days and billing cycle — recording approver and approval time | C, A | `CLIENT 2026-09-14` (A-46) | MUST | 4 | `credit_status` `NONE`/`PENDING_APPROVAL`/`APPROVED`/`SUSPENDED`; only `APPROVED` permits an `INVOICED` booking. Requires `customers.verify`; every decision audited. Default cycle and term are **OQ-19** |

### 4.3 `reference` — admin-editable reference data

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-REFERENCE-01 | Maintain vehicle categories with transport type, capacity bounds and bilingual names | A | RFP §3 / BRIEF-§8 | MUST | 5 | 16 seeded categories spanning passenger and goods |
| FR-REFERENCE-02 | Maintain vehicle makes and models as normalised reference data | A | RFP §3 / BRIEF-§8 | MUST | 5 | Prevents free-text grouping failures in reporting |
| FR-REFERENCE-03 | Maintain regions and cities used for addresses, service areas, matching and reporting | A | BRIEF-§25, §33 | MUST | 5 | 13 KSA administrative regions seeded |
| FR-REFERENCE-04 | Maintain document types, expense categories and maintenance service types | A | BRIEF-§10, §20, §21 | MUST | 5 | Data, not enums — a new mandatory document type needs no release |
| FR-REFERENCE-05 | Maintain system settings such as VAT rate, default bid window, turnaround buffer and retention windows, with scope-based exposure | A | BRIEF-§34, §51 | MUST | 13 | `SECRET`-scoped settings are never returned by any API |

### 4.4 `documents` — reusable document subsystem

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-DOCUMENTS-01 | Upload a document against exactly one owning entity — user, owner, driver, vehicle, corporate customer, expense, maintenance record or trip proof | C, O, D, A | RFP §5 / BRIEF-§10 | MUST | 4 | Typed nullable FKs plus a `CHECK`; no polymorphic keys |
| FR-DOCUMENTS-02 | Validate uploads by MIME type verified against magic bytes, size limit and extension allowlist | SYS | BRIEF-§10, §27 | MUST | 4 | Client-declared content type is never trusted; `DOCUMENT_TYPE_NOT_ALLOWED` |
| FR-DOCUMENTS-03 | Store files in object storage behind a `StorageProvider` abstraction with server-generated opaque keys | SYS | BRIEF-§10, §47 | MUST | 4 | MinIO in dev, S3-compatible in prod; the user filename never becomes a storage key |
| FR-DOCUMENTS-04 | Serve documents only through short-lived signed URLs issued after an authorization check | SYS | BRIEF-§10, §27 | MUST | 4 | Bucket contents are never publicly readable |
| FR-DOCUMENTS-05 | Record issue and expiry dates and mark documents `EXPIRED` automatically | SYS | BRIEF-§10 | MUST | 4 | Drives dispatch eligibility and expiry reminders |
| FR-DOCUMENTS-06 | Verify or reject a document with a reason, recording verifier and timestamp | A | BRIEF-§10, §26 | MUST | 4 | Audited |
| FR-DOCUMENTS-07 | Set document visibility to private, internal, or shared with counterparty | O, A | BRIEF-§28 | SHOULD | 4 | Supports the owner privacy control required by RFP §3 |
| FR-DOCUMENTS-08 | Compute a checksum on upload for integrity and duplicate detection | SYS | BRIEF-§10 | COULD | 4 | `checksum_sha256` |

### 4.5 `fleet` — vehicles, driver assignment, availability

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-FLEET-01 | Register a vehicle with make, model, year, plate in Latin and Arabic form, registration number, VIN, colour and category | O | RFP §3 / BRIEF-§8 | MUST | 5 | Plate and sequence number modelled for KSA formats |
| FR-FLEET-02 | Record passenger capacity for passenger categories and payload or volume for goods categories | O | BRIEF-§8, §11 | MUST | 5 | Conditionally required by the category's transport type |
| FR-FLEET-03 | Record insurance policy and expiry, registration expiry and inspection expiry | O | RFP §3 / BRIEF-§8 | MUST | 5 | Expiry drives dispatch eligibility |
| FR-FLEET-04 | Upload vehicle documents and photographs | O | BRIEF-§8, §47 | MUST | 5 | Through the `documents` subsystem |
| FR-FLEET-05 | Submit a vehicle for approval and track approval status with rejection reason | O | BRIEF-§8 | MUST | 5 | DRAFT → PENDING_APPROVAL → APPROVED/REJECTED |
| FR-FLEET-06 | Approve, reject or suspend a vehicle | A | RFP §4 / BRIEF-§8, §26 | MUST | 5 | Audited; workflow and SLA are **OQ-07** |
| FR-FLEET-07 | Maintain vehicle lifecycle status independently of approval status and of current operation | O, A, SYS | BRIEF-§8 | MUST | 5 | Three orthogonal status columns — [database.md](database.md) deviation V1 |
| FR-FLEET-08 | Reflect the vehicle's current operational state — idle, reserved, on trip, under maintenance, out of service | SYS | RFP §3 / BRIEF-§8 | MUST | 5 | System-driven; never set by hand |
| FR-FLEET-09 | Assign a driver to a vehicle and retain the full assignment history | O | RFP §3 / BRIEF-§9 | MUST | 5 | Historical assignments are never overwritten when trips reference them |
| FR-FLEET-10 | Declare owner-blocked unavailability windows for a vehicle | O | BRIEF-§5, §45 | MUST | 5 | `OWNER_BLOCK` calendar entries |
| FR-FLEET-11 | Guarantee a vehicle can never hold two overlapping occupied windows from any cause | SYS | BRIEF-§45 | MUST | 5 | One `EXCLUDE` constraint covering reservations, maintenance and owner blocks; availability is computed for a window, never stored as a flag |
| FR-FLEET-13 | Model UniGate's **own fleet** as a platform-owned owner profile whose vehicles enter the same registry, calendar and dispatch as subcontracted ones, but generate no commission, no settlement and no supplier invoice — the trip is internal cost, reported as margin against the customer invoice | A, SYS | `CLIENT 2026-09-15` (A-57) | MUST | 5, 11 | Exactly one `is_platform_fleet` owner row; ops may assign its vehicles directly without a bid |
| FR-FLEET-14 | **Vendors are onboarded by UniGate only**: an ADMIN / SUPER_ADMIN creates the vendor account and owner profile; the public registration form offers no vehicle-owner option unless `onboarding.owner_self_registration_enabled` is switched on | A | `CLIENT 2026-09-15` (A-58) | MUST | 4, 11 | `POST /admin/vendors`; `403 OWNER_SELF_REGISTRATION_DISABLED` on the public form |
| FR-FLEET-15 | The vendor activates the account through a one-time link, signs in and uploads the mandatory documents; the profile enters the admin review queue automatically when every mandatory document is uploaded | O, SYS | `CLIENT 2026-09-15` (A-58) | MUST | 4, 11 | `DOCUMENTS_SUBMITTED` set by the document-confirm hook; `owner.documents_submitted` event |
| FR-FLEET-16 | Approval of a vendor requires the admin to have **verified every mandatory document**; vehicles may be registered only once the vendor is approved | A | `CLIENT 2026-09-15` (A-58) | MUST | 4, 5, 11 | `OWNER_DOCUMENTS_INCOMPLETE` on approve; `OWNER_NOT_APPROVED` on vehicle registration |
| FR-FLEET-17 | Every vehicle a vendor registers is submitted for approval automatically once its mandatory documents are uploaded, and is approved only after the admin verified them; only approved vehicles may bid | A, O | `CLIENT 2026-09-15` (A-58) | MUST | 5, 11 | `VEHICLE_DOCUMENTS_INCOMPLETE` on approve; dispatchability already requires APPROVED |
| FR-IAM-16 | An ADMIN / SUPER_ADMIN assigns a vendor's access per module (read / create / update / delete and the module's other actions) on top of the VEHICLE_OWNER role — grants and denies per user, audited, step-up protected, and never beyond what the granting admin holds | A | `CLIENT 2026-09-15` (A-58) | MUST | 3, 11 | `user_permission_overrides`; `GET/PUT /users/{id}/permissions`; effective on the vendor's next request |
| FR-FLEET-12 | Define owner service areas by city so only relevant trip requests are offered | O | BRIEF-§12 | SHOULD | 6 | City-level matching at launch; radius matching deferred (A-11) |

### 4.6 `demand` — trip requests

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-DEMAND-01 | Create a passenger transport request with pickup, destination, pickup date and time, direction and required category | C | RFP §3 / BRIEF-§11 | MUST | 6 | `transport_type = PASSENGER` |
| FR-DEMAND-02 | Create a goods transport request with the same common fields | C | RFP §2, §3 / BRIEF-§11 | MUST | 6 | `transport_type = GOODS` |
| FR-DEMAND-03 | Capture passenger detail — passenger count, luggage, purpose, accessibility, child seats, driver language, female-driver requirement | C | BRIEF-§11 | MUST | 6 | Separate 1:1 detail table, not nullable columns on the request |
| FR-DEMAND-04 | Capture goods detail — cargo type, weight, dimensions, package count, refrigeration and temperature range, tail lift, crane, loading and unloading responsibility, declared value, shipper and consignee contacts | C | BRIEF-§11 | MUST | 6 | Separate 1:1 detail table |
| FR-DEMAND-05 | Request more than one vehicle on a single trip request | C | BRIEF-§11, §12 | MUST | 6 | Raised from SHOULD: partial fulfilment (FR-DEMAND-11) is only meaningful above one vehicle, and UniGate's 2026-09-14 answer describes it as normal trading, not an edge case |
| FR-DEMAND-06 | Save a request as a draft and publish it when ready | C | BRIEF-§11 | SHOULD | 6 | DRAFT → PUBLISHED |
| FR-DEMAND-07 | Resolve addresses through a maps abstraction offering autocomplete, geocoding and reverse geocoding, storing coordinates and a provider place reference | C, SYS | RFP §3 / BRIEF-§16 | MUST | 6 | Provider keys never reach the browser |
| FR-DEMAND-08 | Estimate distance and duration at creation time and store the estimate | SYS | BRIEF-§16 | SHOULD | 6 | Snapshot; not recomputed later |
| FR-DEMAND-09 | Cancel a trip request, with a reason, cancelling any unfilled remainder | C, A | RFP §3 / BRIEF-§11 | MUST | 6 | Cancels the *order*; bookings already awarded from it are cancelled individually under FR-BOOKINGS-09 with their own fee rules |
| FR-DEMAND-10 | Match a published request to eligible owners and record which owners were invited, when and why | SYS | BRIEF-§12 | MUST | 6 | `trip_request_invitations` makes matching auditable and drives the Opportunities screen |
| FR-DEMAND-11 | Accept an order for N vehicles when fewer than N are available, awarding what exists rather than refusing the order | C, SYS | `CLIENT 2026-09-14` (A-45) | MUST | 6 | The confirmed trading model: take the order, dispatch the capacity that exists, fill the balance later. Each accepted bid is its own booking |
| FR-DEMAND-12 | Rest a partially awarded order in `PARTIALLY_AWARDED` indefinitely, keeping it visible to owners and continuing to accept bids for the balance | SYS | `CLIENT 2026-09-14` (A-45) | MUST | 6 | A stable resting state, not a transition. The expiry job skips any request with `vehicles_awarded > 0`; only an order that attracted nothing expires |
| FR-DEMAND-13 | Reopen the remainder automatically when an awarded booking is cancelled, returning the order to owners without a manual re-publish | SYS | `CLIENT 2026-09-14` (A-45) | MUST | 8 | Decrements `vehicles_awarded`; `FULLY_AWARDED → PARTIALLY_AWARDED`. `vehicles_cancelled` is cumulative and never decremented — it is the fulfilment-reliability signal |
| FR-DEMAND-14 | Close an unfilled remainder only on the customer's instruction, or an admin acting for them with an audit entry | C, A | `CLIENT 2026-09-14` (A-45) | MUST | 6 | `PARTIALLY_AWARDED → CLOSED_PARTIAL`. The system never abandons a balance on its own. How long a remainder may stay open is **OQ-22** |
| FR-DEMAND-15 | Set `allow_partial_fulfilment` per request, defaulting true for goods and false for passenger, and expose it to the customer as a plain question rather than a technical toggle | C | `CLIENT 2026-09-14` (A-45) | MUST | 6 | Five buses at 07:00 for a shuttle is failed, not partially served, by a wave — hence the passenger default. Customer may override either default |
| FR-DEMAND-16 | Track and expose order fulfilment counters — required, awarded, dispatched, completed, cancelled — and group an order's bookings by dispatch wave | C, A, SYS | `CLIENT 2026-09-14` (A-45) | MUST | 6 | Counters are constrained (`awarded <= required`, `dispatched`/`completed <= awarded`); the customer's order view groups by `bookings.fulfilment_sequence` rather than inferring waves from timestamps |

### 4.7 `bidding` — quotations

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-BIDDING-01 | View eligible trip opportunities matched to the owner's fleet and service areas | O | RFP §3 / BRIEF-§5, §12 | MUST | 7 | |
| FR-BIDDING-02 | Submit a bid naming a specific vehicle, optional driver, base price, extras breakdown and validity period | O | RFP §3 / BRIEF-§12 | MUST | 7 | The same vehicle cannot be offered twice on one request while a bid is live |
| FR-BIDDING-03 | Compute VAT and bid total on the server from a snapshotted VAT rate | SYS | BRIEF-§12, §18 | MUST | 7 | A client-supplied total is ignored, never merely validated |
| FR-BIDDING-04 | Revise a submitted bid, incrementing its version and retaining prior values in the audit trail | O | BRIEF-§12 | MUST | 7 | Status remains `SUBMITTED` — `UPDATED` is not a lifecycle state (deviation V4) |
| FR-BIDDING-05 | Withdraw a bid before it is decided | O | BRIEF-§12 | MUST | 7 | `BID_ALREADY_DECIDED` once a decision exists |
| FR-BIDDING-06 | Expire bids at `valid_until` and close bidding at the request's current deadline, which is `remainder_closes_at` once a remainder is open | SYS | BRIEF-§12; `CLIENT 2026-09-14` | MUST | 7 | Default window is **OQ-02** / A-35; `BID_EXPIRED`. `bidding_closes_at` is the deadline for the *current* round only and is extended while a remainder is open |
| FR-BIDDING-07 | Compare received bids by price, vehicle, category, vehicle rating, owner rating and estimated arrival | C | RFP §3 / BRIEF-§12 | MUST | 7 | |
| FR-BIDDING-08 | Accept a bid inside one database transaction that creates the booking, reserves the vehicle and freezes the financial snapshot | C | BRIEF-§12, §45 | MUST | 7 | Locks taken in a fixed order; a reservation conflict returns 409 `BID_VEHICLE_UNAVAILABLE` |
| FR-BIDDING-09 | Reject the remaining bids only once the request is fully awarded, keeping them live and competing while a remainder is open | SYS | BRIEF-§12; `CLIENT 2026-09-14` (A-45) | MUST | 7 | Confirmed behaviour, no longer provisional. A bid that loses wave 1 can win wave 2 without being resubmitted |
| FR-BIDDING-10 | Award a further wave against an open remainder, creating an additional booking with its own schedule, price and wave number | C, SYS | `CLIENT 2026-09-14` (A-45) | MUST | 7 | The award transaction is identical to the first wave's; only the resulting request status differs. Whether the customer accepts each wave or UniGate may dispatch against the remainder is **OQ-23** |
| FR-BIDDING-11 | Award an `allow_partial_fulfilment = false` request as one atomic group covering the whole remainder — all bookings created, or none | C, SYS | `CLIENT 2026-09-14` (A-45) | MUST | 7 | Bids accumulate until enough live bids exist to cover `vehicles_required`; the group award then runs in a single transaction. Any one vehicle becoming unavailable rolls the whole group back |
| FR-BIDDING-12 | Reject a single-bid award on an all-or-nothing request | SYS | `CLIENT 2026-09-14` (A-45) | MUST | 7 | 422 `RULE_PARTIAL_AWARD_NOT_ALLOWED`; the bid stays `SUBMITTED`. Backed by `ck_trip_requests_partial`, so the state is unreachable even by direct SQL |
| FR-BIDDING-13 | Accept bids on a remainder after the original pickup time has passed, bounded by `remainder_closes_at` rather than by the first wave's schedule | O, SYS | `CLIENT 2026-09-14` (A-45) | MUST | 7 | A later wave is by definition bid and awarded after wave 1 departs. The `bidding_closes_at <= pickup_at` constraint was removed for exactly this reason ([database.md](database.md) §8.1) |
| FR-BIDDING-15 | Keep the customer and the bidding company from identifying each other before award — masked contact, business name only, no free-text fields that could carry a phone number or email in a bid or request — and bind both sides to a non-circumvention undertaking for a configurable period after any introduced booking, with platform-only payment as a term of use | SYS, C, O | `CLIENT 2026-09-15` (ADR-008 addendum 2) | MUST | 6, 7 | Structural defence is FR-FINANCE-25 / one-model invoicing; this is the second line. Detection: a customer–company pair that transacts once and then both go quiet is flagged to ops |
| FR-BIDDING-14 | Check the corporate credit limit inside the award transaction, with the customer row locked, before an `INVOICED` booking is created | SYS | `CLIENT 2026-09-14` (A-46); `CLIENT 2026-09-15` (OQ-21) | MUST | 7 | **Exposure** = unpaid issued invoices **+ live bookings not yet invoiced**; exposure plus this booking must stay within `credit_limit_amount`; both terms read live, never from a cached column. 422 `RULE_CREDIT_LIMIT_EXCEEDED` or `RULE_CREDIT_NOT_APPROVED`. **OQ-21 answered: the limit is the only gate** — unpaid or overdue invoices never block on their own while headroom remains; no automatic suspension on overdue |

### 4.8 `bookings` — the commercial agreement

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-BOOKINGS-01 | Create a booking automatically on bid acceptance | SYS | RFP §3 / BRIEF-§13 | MUST | 8 | Never created by hand; one booking per accepted bid, and therefore one per vehicle per dispatch wave — a five-vehicle order filled in two waves produces five bookings |
| FR-BOOKINGS-02 | Snapshot all commercial and vehicle details onto the booking at creation | SYS | BRIEF-§13 | MUST | 8 | Plate, vehicle description, category code, owner name, addresses, agreed amounts, VAT rate — immutable thereafter |
| FR-BOOKINGS-03 | Hold a `PREPAID` booking in `PENDING_PAYMENT` until payment is captured | SYS | BRIEF-§13, §17 | MUST | 8 | Applies to individual customers only. The `INVOICED` path is FR-BOOKINGS-11 |
| FR-BOOKINGS-04 | Confirm a booking on successful payment capture | SYS | BRIEF-§13, §17 | MUST | 9 | Confirmation is driven by the gateway webhook, never by the frontend |
| FR-BOOKINGS-05 | Cancel a `PENDING_PAYMENT` booking automatically when `payment_due_by` elapses, releasing the vehicle reservation | SYS | BRIEF-§13, §45 | MUST | 8 | Prevents indefinite vehicle holds. The job scans `payment_due_by` and therefore never touches an `INVOICED` booking, which has no payment to wait for |
| FR-BOOKINGS-06 | Assign a driver to a confirmed booking, validating driver approval, licence validity and availability | O | RFP §3 / BRIEF-§13, §14 | MUST | 8 | `bookings.assign_driver` |
| FR-BOOKINGS-07 | Enforce the booking lifecycle against an explicit transition map and reject illegal transitions | SYS | BRIEF-§13 | MUST | 8 | `BOOKING_INVALID_TRANSITION` |
| FR-BOOKINGS-08 | Record every booking status transition with actor, actor type, reason and timestamp in append-only history | SYS | BRIEF-§13, §26 | MUST | 8 | `booking_status_history` |
| FR-BOOKINGS-09 | Cancel a booking with a reason code, recording hours before pickup and the fee policy applied as a snapshot | C, O, A | RFP §3 / BRIEF-§13; `CLIENT 2026-09-15` | MUST | 8 | **OQ-05 answered:** the charge comes from admin-configured `cancellation_policies`; production seeds none |
| FR-BOOKINGS-14 | Configure cancellation and no-show charging as none, percentage or fixed amount — optionally tiered by hours of notice — per cancelling party (customer / owner), scoped globally, by vehicle category, customer or owner | A | `CLIENT 2026-09-15` (OQ-05) | MUST | 8 | Same engine shape as commission rules; resolution by specificity, priority and effective date |
| FR-BOOKINGS-15 | Record a customer or owner no-show as a `NO_SHOW` cancellation with the applicable charge; an owner no-show refunds the customer in full and deducts any owner charge at settlement | A, D | `CLIENT 2026-09-15` (OQ-05); BRIEF-§14 | MUST | 8, 10 | `POST /bookings/{id}/no-show`; ties to FR-TRIPS-07 |
| FR-BOOKINGS-16 | Allow a global-scope admin to override the computed cancellation/no-show fee at the time of cancelling, or to waive it afterwards with a mandatory reason, until the refund is processed or the settlement line approved | A | `CLIENT 2026-09-15` (OQ-05) | MUST | 8 | `fee_source`, `fee_override_snapshot`, `fee_waived_*`; audited `NOTICE` |
| FR-BOOKINGS-10 | View booking history with filters and pagination, scoped to the actor's own records unless they hold `bookings.read_any` | C, O, D, A | RFP §3 / BRIEF-§5, §32 | MUST | 8 | |
| FR-BOOKINGS-11 | Enter an `INVOICED` booking directly at `CONFIRMED`, bypassing `PENDING_PAYMENT` and the payment gate entirely | SYS | `CLIENT 2026-09-14` (A-46) | MUST | 8 | There is no capture to wait for, so a payment gate would only delay dispatch. The money is collected later on a consolidated invoice (FR-FINANCE-15) |
| FR-BOOKINGS-12 | Snapshot `billing_mode` — and, for `INVOICED` bookings, the agreed `credit_terms_days` — on the booking at award, and key the legal transition map on `billing_mode` | SYS | `CLIENT 2026-09-14` (A-46); `CLIENT 2026-09-15` (OQ-19) | MUST | 8 | Same pattern as the trip transition map keyed on `transport_type`. A later change to the customer's billing arrangement or terms cannot retroactively alter a booking's lifecycle or its agreed term |
| FR-BOOKINGS-13 | Take a booking's schedule from its accepted bid rather than from the order's original pickup time, and record which dispatch wave it belongs to | SYS | `CLIENT 2026-09-14` (A-45) | MUST | 8 | `bookings.scheduled_start_at` is authoritative for what happens; `trip_requests.pickup_at` is the customer's requested start for wave 1 and a matching constraint. `fulfilment_sequence` is 1-based and assigned at award |

### 4.9 `trips` — operational execution

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-TRIPS-01 | Create a trip when a booking reaches driver assignment, snapshotting vehicle and driver | SYS | BRIEF-§14 | MUST | 10 | Driver on the trip is never rewritten afterwards |
| FR-TRIPS-02 | View assigned trips with pickup details, customer contact and instructions | D | BRIEF-§5, §14 | MUST | 10 | Customer contact exposure is limited to the active trip window |
| FR-TRIPS-03 | Progress a passenger trip through en route, arrived at pickup, started, in progress, arrived at destination and completed | D | RFP §3 / BRIEF-§14 | MUST | 10 | Transition map keyed by transport type |
| FR-TRIPS-04 | Progress a goods trip through the additional loading, loaded, in transit, unloading and delivered states | D | BRIEF-§14 | MUST | 10 | A passenger trip has no loading states available at all |
| FR-TRIPS-05 | Record actual start and end timestamps, start and end odometer and actual distance | D | BRIEF-§14 | MUST | 10 | Feeds vehicle utilisation reporting |
| FR-TRIPS-06 | Capture the location at which each status change occurred | SYS | BRIEF-§14, §15 | MUST | 10 | What makes a delivery dispute resolvable |
| FR-TRIPS-07 | Report a trip issue or exception such as breakdown, accident or customer no-show | D | BRIEF-§5, §14 | MUST | 10 | `EXCEPTION` resolves back to the active flow or to cancellation |
| FR-TRIPS-08 | Capture proof of pickup and delivery — recipient name, signature, photographs and location | D | BRIEF-§14 | COULD | 10 | Schema and API architected now, UI deferred |

### 4.10 `tracking` — live position

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-TRACKING-01 | Accept position pings from the driver application while a trip is active | D | RFP §3 / BRIEF-§15 | MUST | 10 | Behind a `TrackingProvider` abstraction, not tied to one source |
| FR-TRACKING-02 | Maintain exactly one current-location row per vehicle, updated on every ping | SYS | BRIEF-§15 | MUST | 10 | Bounded table plus a Redis mirror for socket fan-out |
| FR-TRACKING-03 | Persist location history only when sampling thresholds of elapsed time, distance or heading change are met | SYS | BRIEF-§15 | MUST | 10 | Avoids writing every coordinate to a transactional table |
| FR-TRACKING-04 | Open a tracking session at trip start and close it at completion, recording point count and distance | SYS | BRIEF-§15 | MUST | 10 | |
| FR-TRACKING-05 | Stream live vehicle position, driver identity, trip status, last-updated time and ETA to the customer over websockets | C | RFP §3 / BRIEF-§15, §16 | MUST | 10 | |
| FR-TRACKING-06 | Authorize tracking server-side so a customer can only track vehicles on their own active bookings | SYS | BRIEF-§15, §27 | MUST | 10 | Requests for unrelated vehicles return 404, not 403 |

### 4.11 `payments` — customer payment capture

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-PAYMENTS-01 | Initiate payment for a booking or for an invoice through a `PaymentGateway` abstraction | C | RFP §3 / BRIEF-§17; `CLIENT 2026-09-14` | MUST | 9 | `MockGateway` in development; no production adapter until **OQ-03**. An individual pays a booking; a corporate pays an invoice covering many |
| FR-PAYMENTS-02 | Present Mada, Visa, MasterCard, STC Pay and Apple Pay as selectable methods where the chosen gateway supports them | C | RFP §3 / BRIEF-§17, §30 | MUST | 9 | Availability depends entirely on the gateway selected under OQ-03 |
| FR-PAYMENTS-03 | Track payment state through pending, authorized, paid, failed, cancelled, refunded and partially refunded | SYS | BRIEF-§17 | MUST | 9 | |
| FR-PAYMENTS-04 | Record every gateway interaction as a transaction row with redacted request and response payloads | SYS | BRIEF-§17, §27 | MUST | 9 | No PAN, CVV, token or provider secret is ever written, even for debugging |
| FR-PAYMENTS-05 | Receive gateway webhooks, verify the signature, persist first and process asynchronously | SYS | BRIEF-§17 | MUST | 9 | Invalid-signature events are stored and alerted on, never processed |
| FR-PAYMENTS-06 | Make webhook handling idempotent by database constraint on provider event id | SYS | BRIEF-§17 | MUST | 9 | Duplicate delivery returns 200 immediately |
| FR-PAYMENTS-07 | Determine booking confirmation from gateway state only, never from a client-reported success | SYS | BRIEF-§17, §49 | MUST | 9 | |
| FR-PAYMENTS-08 | Accept an idempotency key on every money-moving or state-moving non-GET request | SYS | BRIEF-§45 | MUST | 9 | `IDEMPOTENCY_KEY_REUSED` on a mismatched replay |
| FR-PAYMENTS-09 | Request, approve and process a refund, never exceeding the captured amount | C, A | BRIEF-§17 | MUST | 9 | `REFUND_EXCEEDS_CAPTURED`; enforced in-transaction with a row lock |
| FR-PAYMENTS-10 | Store gateway card tokens only, with brand and last four digits, never card data | SYS | BRIEF-§17, §27 | SHOULD | 9 | Keeps cardholder data out of UniGate systems entirely; scope position **requires review** by a QSA |
| FR-PAYMENTS-11 | Direct every payment at exactly one target — a booking or an invoice, never both — and apply an invoice payment across all of that invoice's lines | SYS | `CLIENT 2026-09-14` (A-46) | MUST | 9 | Enforced structurally by `ck_payments_single_target` (`num_nonnulls(booking_id, invoice_id) = 1`), not by service-layer discipline. An invoice payment updates `paid_amount` and `outstanding_amount` and moves the invoice to `PARTIALLY_PAID` or `PAID` |

### 4.12 `finance` — commission, ledger, settlement, invoicing, expenses

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-FINANCE-01 | Configure commission rules as **none, percentage or fixed amount**, scoped globally or by vehicle category, owner, or owner and category | A | RFP §3 / BRIEF-§18; `CLIENT 2026-09-15` | MUST | 11 | **OQ-01 answered:** the admin decides whether to charge and how much; production seeds a `NONE` global rule |
| FR-FINANCE-20 | Allow an admin holding `commissions.override` to decide, per trip request or at award, whether commission is charged and as what percentage or amount, with a mandatory reason | A | `CLIENT 2026-09-15` (OQ-01) | MUST | 11 | Beats every rule; applies to all later awards from that request; frozen into the snapshot as `commission_source = OVERRIDE` |
| FR-FINANCE-21 | Refuse an override that would raise commission above the resolved rule once any bid has been submitted on the request; always permit lowering or waiving | SYS | `CLIENT 2026-09-15` (OQ-01) | MUST | 11 | Owners price bids against the commission shown to them; `422 COMMISSION_OVERRIDE_AFTER_BIDS` |
| FR-FINANCE-22 | Show invited owners the effective commission (rule or override) on a request before they bid, and report waived commission separately in the finance dashboard | O, A | `CLIENT 2026-09-15` (OQ-01) | SHOULD | 7, 11 | Transparency is what makes FR-FINANCE-21 fair |
| FR-FINANCE-02 | Effective-date commission rules and resolve the applicable rule by priority and specificity at booking confirmation | SYS | BRIEF-§18 | MUST | 11 | Exactly one active global rule is required at all times |
| FR-FINANCE-03 | Write a once-only financial snapshot per booking holding gross, VAT, commission basis, rate, amount, commission VAT, payment fee, owner gross and owner net | SYS | BRIEF-§18 | MUST | 11 | Never updated; a later rule change cannot alter history |
| FR-FINANCE-04 | Freeze the whole applied commission rule as a JSON snapshot alongside the computed amounts | SYS | BRIEF-§18 | MUST | 11 | Makes any historical figure explainable without reconstructing configuration |
| FR-FINANCE-05 | Assert that owner net, commission, commission VAT and payment fee sum exactly to gross before persisting a snapshot | SYS | BRIEF-§18 | MUST | 11 | A failed assertion aborts the transaction rather than storing an unbalanced row |
| FR-FINANCE-06 | Post double-entry ledger lines for every financial event — capture, commission, refund, settlement | SYS | BRIEF-§19 | MUST | 11 | Append-only; corrections are reversing entries |
| FR-FINANCE-07 | Derive owner balances from the ledger rather than by summing snapshots across tables | SYS | BRIEF-§19 | MUST | 11 | One query, cannot drift |
| FR-FINANCE-08 | Show owners gross revenue, commission, net earnings, pending and paid settlement, expenses and vehicle-level profitability | O | RFP §3 / BRIEF-§5, §19 | MUST | 11 | |
| FR-FINANCE-09 | Generate settlements for an owner over a period, itemised by booking, with approval and payment steps | A | BRIEF-§19 | MUST | 11 | Cycle, cut-off and minimum payout are **OQ-06**. Whether a line for an `INVOICED` booking is payable before the customer has paid is **OQ-20** — until answered, settlement does not inspect the customer's payment status, so UniGate carries the receivable |
| FR-FINANCE-10 | Prevent a booking from ever being settled twice | SYS | BRIEF-§19, §45 | MUST | 11 | Partial unique index on booking earning lines; `SETTLEMENT_BOOKING_ALREADY_SETTLED` |
| FR-FINANCE-11 | Maintain owner bank accounts with encrypted IBAN, requiring OTP re-authentication and an audit entry to change the payout account | O | BRIEF-§19, §27 | MUST | 11 | Payout redirection is the highest-value fraud vector on the platform |
| FR-FINANCE-23 | Describe every tax-invoice line as a **journey** — route (origin → destination), service date, vehicle class *with driver*, passenger or goods — and never as a vehicle-day, rental period or "hire of vehicle"; keep the marketing name "Vehicle Hiring" off tax documents and contract terms | SYS | `CLIENT 2026-09-15` (A-54, OQ-26) | MUST | 11 | UniGate hires for a trip and offers no leasing; this wording is what keeps corporate customers outside VAT Implementing Regulations Art 50(1)(c) (restricted-motor-vehicle lease) and able to reclaim VAT. Template lives in `invoice_lines.description` generation, bilingual |
| FR-FINANCE-25 | Hold a VAT-registered supplier's settlement line for a booking until a valid tax invoice to UniGate is on file for it (supplier-issued and QR-verified, or self-billed and accepted); release automatically on filing; escalate to suspension after a configurable number of held periods, and to blacklist on repeated breach | SYS, A | `CLIENT 2026-09-15` (ADR-008 addendum 2) | MUST | 11 | The invoice obligation is enforced by the payout, not by legal action. Unregistered suppliers have no invoice to file and are never held on this rule |
| FR-FINANCE-24 | Issue the customer's tax invoice **for the service, not per vehicle**: one `ORDER` line per trip request by default (route, date, "transport service", qty 1, amount, VAT), with per-vehicle detail as a service-statement annex; granularity switchable per platform setting and per corporate customer; every covered booking recorded against the line so no booking is ever on two live invoices | SYS, A | `CLIENT 2026-09-15` (A-58); VAT IR Art 53(5)(f) | MUST | 11 | UniGate: "we don't even have to mention how many vehicles … just that they took this service from us for X and VAT is Y" |
| FR-FINANCE-12 | Issue sequential gapless tax invoices with seller and buyer VAT numbers and a downloadable PDF — one line per booking for a prepaid customer, consolidated for an invoiced one | C, A | RFP §3 / BRIEF-§5, §30; `CLIENT 2026-09-14` | MUST | 11 | One code path, two triggers: a `PREPAID` booking gets a single-line invoice at payment, a corporate gets a period invoice. ZATCA fields are reserved placeholders; applicability **requires tax review** and is now more likely to bite — **OQ-04** |
| FR-FINANCE-13 | Record owner expenses by category with amount, VAT, date, vehicle, driver, vendor, odometer and receipt attachment | O | RFP §3 / BRIEF-§20 | MUST | 11 | Nine seeded categories including fuel, repair, toll and fine |
| FR-FINANCE-14 | Compute and store an SPO commission amount on attributed bookings | SYS | BRIEF-§5, §18 | COULD | 11 | Written as zero until **OQ-09** is answered; the column and snapshot exist now |
| FR-FINANCE-15 | Generate a consolidated invoice for a corporate customer at the end of each billing cycle, covering every eligible booking in the period | SYS, A | `CLIENT 2026-09-14` (A-46) | MUST | 11 | Cycle is `PER_BOOKING`, `WEEKLY` or `MONTHLY` per customer; the default and the payment term are **OQ-19**. Billing period and due date are stored on the invoice header |
| FR-FINANCE-16 | Structure an invoice as a header plus typed lines — booking, adjustment, penalty or discount — each carrying its own net, VAT rate, VAT amount and total | SYS | `CLIENT 2026-09-14` (A-46) | MUST | 11 | A corporate invoice covering twenty bookings is one header and twenty-plus lines; header totals are the sum of the lines and are asserted before the invoice is issued |
| FR-FINANCE-17 | Guarantee that a booking can never appear on two live invoices | SYS | `CLIENT 2026-09-14` (A-46) | MUST | 11 | Partial unique index on `(booking_id)` for `BOOKING` lines on non-void invoices — the same structural protection against double-billing a customer that `settlement_lines` gives against double-paying an owner (FR-FINANCE-10) |
| FR-FINANCE-18 | Correct an issued invoice forward by credit or debit note; void only where nothing has been filed | A | `CLIENT 2026-09-14` (A-46, A-50) | MUST | 11 | `CREDIT_NOTE` reduces and `DEBIT_NOTE` increases, both linked by `corrects_invoice_id` and drawing their own sequential numbers. Invoices are never deleted or edited. **Void is limited to `DRAFT`, `CLEARANCE_FAILED`, or `clearance_status = NOT_REQUIRED`** — once cleared *or reported* the document exists in the authority's records and `INVOICE_ALREADY_CLEARED` is returned. Voiding releases booking lines for reinvoicing |
| FR-FINANCE-19 | Report the accounts-receivable position and ageing per corporate customer, derived from the ledger | A | `CLIENT 2026-09-14` (A-46) | MUST | 11 | Same discipline as owner balances (FR-FINANCE-07): outstanding is read from `CUSTOMER_RECEIVABLE` entries, never from a denormalised column that would quietly drift and extend unapproved credit. Whether settlement waits on collection is **OQ-20** |

### 4.13 `maintenance`

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-MAINTENANCE-01 | Record scheduled and unscheduled maintenance with service type, odometer, dates, cost, workshop, parts and notes | O | RFP §3 / BRIEF-§21 | MUST | 12 | |
| FR-MAINTENANCE-02 | Make a vehicle unbookable for the duration of planned or in-progress maintenance | SYS | BRIEF-§21, §45 | MUST | 12 | Creates a `MAINTENANCE` calendar entry in the same transaction — structural, not a remembered rule |
| FR-MAINTENANCE-03 | Reject a maintenance window that collides with an existing reservation, naming the blocking booking | SYS | BRIEF-§21, §45 | MUST | 12 | |
| FR-MAINTENANCE-04 | Define maintenance schedules by distance or time interval and compute the next due date and odometer | O | BRIEF-§21 | SHOULD | 12 | Drives the reminder job |
| FR-MAINTENANCE-05 | Attach workshop invoices and receipts to a maintenance record | O | BRIEF-§21, §47 | SHOULD | 12 | Through the `documents` subsystem |

### 4.14 `engagement` — ratings and complaints

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-ENGAGEMENT-01 | Rate the driver, vehicle, owner and overall trip after completion | C | BRIEF-§5, §22 | MUST | 13 | Score 1–5 with optional comment |
| FR-ENGAGEMENT-02 | Permit a rating only from a party to a completed booking, once per subject, within the rating window | SYS | BRIEF-§22 | MUST | 13 | Window default 14 days (A-10); ineligible requests return 404, not 403 |
| FR-ENGAGEMENT-03 | Maintain rating aggregates on vehicles, drivers and owners, recomputed by job rather than trigger | SYS | BRIEF-§22 | MUST | 13 | Avoids lock contention on hot rows |
| FR-ENGAGEMENT-04 | Moderate, hide or publish a rating | A | BRIEF-§22 | SHOULD | 13 | |
| FR-ENGAGEMENT-05 | Raise a complaint against a driver, owner, customer, vehicle or the platform, with category and severity | C, O, D | RFP §3 / BRIEF-§5, §25 | MUST | 13 | |
| FR-ENGAGEMENT-06 | Assign, annotate, resolve and close complaints, keeping internal notes out of counterparty-facing views | A | BRIEF-§25 | MUST | 13 | |

### 4.15 `notifications`

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-NOTIFICATIONS-01 | Deliver notifications over in-app, email, SMS and push channels behind provider abstractions | SYS | BRIEF-§23 | MUST | 13 | `SmsProvider`, `EmailProvider`, `PushProvider`; SMS vendor is **OQ-10** |
| FR-NOTIFICATIONS-02 | Render every notification from a versioned template stored per code, channel and locale | SYS | BRIEF-§23 | MUST | 13 | Notification text is never written inline in business logic |
| FR-NOTIFICATIONS-03 | Emit notifications for OTP, new trip opportunity, bid received, bid accepted, booking confirmed, payment successful, driver assigned, driver arrived, trip started, trip completed, document expiring and maintenance due | SYS | BRIEF-§23 | MUST | 13 | |
| FR-NOTIFICATIONS-04 | Guarantee that a notification triggered by a committed business event is never lost | SYS | BRIEF-§23 | MUST | 13 | Outbox row written inside the business transaction, relayed by a worker |
| FR-NOTIFICATIONS-05 | Suppress duplicate sends on job retry | SYS | BRIEF-§23 | MUST | 13 | Unique dedupe key |
| FR-NOTIFICATIONS-06 | Let users set channel preferences per category, while refusing to suppress transactional categories such as OTP, payment and trip status | C, O, D | BRIEF-§23 | SHOULD | 13 | |

### 4.16 `reporting`

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-REPORTING-01 | Produce booking, trip and cancellation reports with date and status filters | A, O | RFP §3 / BRIEF-§25 | MUST | 13 | |
| FR-REPORTING-02 | Produce revenue, commission and owner-earning reports | A | RFP §3 / BRIEF-§25 | MUST | 13 | Sourced from snapshots and the ledger, never recomputed from current settings |
| FR-REPORTING-03 | Produce vehicle utilisation and vehicle maintenance reports | A, O | BRIEF-§25 | MUST | 13 | |
| FR-REPORTING-04 | Produce expense, payment and refund reports | A, O | BRIEF-§25 | MUST | 13 | |
| FR-REPORTING-05 | Produce customer activity and SPO performance reports | A, S | BRIEF-§25 | SHOULD | 13 | SPO metrics are inert until OQ-09 |
| FR-REPORTING-06 | Export any report to CSV, Excel or PDF asynchronously, returning a short-lived signed URL | A, O | BRIEF-§25 | MUST | 13 | Never an inline unbounded response |
| FR-REPORTING-07 | Apply the same permission and scope rules to reports and exports as to the underlying records | SYS | BRIEF-§25, §27 | MUST | 13 | Financial reports require `reports.financial.read` |
| FR-REPORTING-08 | Produce an order fulfilment report — fill rate against vehicles requested, time to fill each wave, and unfilled remainders by age, city and category | A, C | `CLIENT 2026-09-14` (A-45) | MUST | 13 | The operational measure of whether taking partially-filled orders is working. Revenue is reported per **booking**; the order is a grouping, because each wave is separately priced and an order's total is not known until it closes |

### 4.17 `admin`

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-ADMIN-01 | Present a dashboard of platform KPIs with date filters — users by type, vehicles, active vehicles, requests, bids, bookings, active and completed trips, cancellations, gross booking value, commission, pending settlements | A | RFP §3 / BRIEF-§24 | MUST | 13 | |
| FR-ADMIN-02 | List, search, filter and paginate users across all types | A | RFP §3, §4 / BRIEF-§5, §32 | MUST | 13 | |
| FR-ADMIN-03 | Create, update, suspend and reactivate any user account | A | RFP §4 / BRIEF-§5 | MUST | 13 | Suspension is audited with reason |
| FR-ADMIN-04 | Grant and revoke roles, and create new roles with permission sets, without a deployment | A | BRIEF-§5 | MUST | 13 | Bumps the user's permission version, invalidating the cached permission set |
| FR-ADMIN-05 | Administer vehicles, trip requests, bids, bookings, trips and payments across all tenants | A | RFP §4 / BRIEF-§5 | MUST | 13 | Via `*_any` permissions plus the scoping layer |
| FR-ADMIN-06 | Administer commission rules, settlements and payment configuration | A | RFP §4 / BRIEF-§5 | MUST | 13 | |
| FR-ADMIN-07 | Browse the audit log filtered by actor, action, entity type and date | A | BRIEF-§26 | MUST | 13 | Read-only; no delete path exists |
| FR-ADMIN-08 | Perform safe bulk operations on admin lists with explicit confirmation | A | BRIEF-§36 | COULD | 13 | Destructive bulk actions require a typed confirmation |

### 4.18 `platform` — cross-cutting

| ID | Requirement | Actor(s) | Source | Priority | Phase | Notes |
|---|---|---|---|---|---|---|
| FR-PLATFORM-01 | Record an audit entry for user creation and update, suspension, vehicle approval and rejection, document verification, bid acceptance, booking cancellation, payment change, refund, commission configuration and permission change | SYS | BRIEF-§26 | MUST | 3+ | Actor, action, entity, before and after values, changed fields, IP, user agent, request id, severity |
| FR-PLATFORM-02 | Make the audit log append-only at the database role level | SYS | BRIEF-§26 | MUST | 14 | The application role holds no UPDATE or DELETE grant on that table |
| FR-PLATFORM-03 | Exclude passwords, tokens, encrypted values and raw payloads from audit entries and logs by a shared redaction allowlist | SYS | BRIEF-§26, §27 | MUST | 14 | One `redact()` used by the audit writer, the payment repository and the logger |
| FR-PLATFORM-04 | Serve the entire API under a versioned base path with a consistent success and error envelope | SYS | BRIEF-§31 | MUST | 2 | `/api/v1`; money serialised as a string with a sibling currency field |
| FR-PLATFORM-05 | Paginate every listing endpoint with page, page size, search, sort field, sort direction and filters, enforcing a maximum page size | SYS | BRIEF-§32 | MUST | 2 | Cursor pagination only for audit logs, notifications and location points |
| FR-PLATFORM-06 | Return machine-readable error codes with details, never user-facing English prose as the display string | SYS | BRIEF-§29, §44 | MUST | 2 | The client renders the translated message from the code |
| FR-PLATFORM-07 | Serve the entire interface in English and Arabic with correct direction switching, and no hard-coded strings | all | RFP §3 / BRIEF-§1, §29 | MUST | 2 | Logical CSS properties only; physical direction utilities blocked by lint |
| FR-PLATFORM-08 | Expose health and readiness endpoints and emit structured logs carrying a correlation id | SYS | BRIEF-§41 | MUST | 2 | Prepared for Sentry and OpenTelemetry |

---

## 5. Non-functional requirements

> **Read §3.5 before using this section.** The RFP states no volume, no concurrency figure, no service level, no uptime target, no performance budget, no retention period, no accessibility standard and no support matrix. The engagement brief adds engineering practices but sets no measurable target either. **Every target below was authored by the delivery team.** Each is marked `PROPOSED — requires client confirmation (OQ-15)`. They are the numbers the architecture is built against and the numbers Phase 15 will test against; they are not client requirements and must not appear as commitments in any contract schedule until UniGate confirms them in writing. Where a target is a genuine client instruction (only two are), it is marked `CLIENT` with its source.

### 5.1 Performance

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-01 | API read latency for single-record and paginated list endpoints | p95 ≤ 300 ms, p99 ≤ 800 ms, server-side, excluding network | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-02 | API write latency for transactional endpoints (bid acceptance, booking, payment initiation) | p95 ≤ 800 ms, p99 ≤ 2 s | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-03 | Web first-contentful paint on the customer portal over a 4G profile | ≤ 1.8 s; Largest Contentful Paint ≤ 2.5 s; Interaction to Next Paint ≤ 200 ms | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-04 | Live tracking end-to-end latency from device ping to customer map update | ≤ 3 s at p95 | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-05 | Report export completion for a 12-month data set | ≤ 60 s asynchronously; exports never block a request thread | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-06 | No listing endpoint may return an unbounded result set | Maximum page size 100; default 20 | `CLIENT` — BRIEF-§32 (size values proposed) |

### 5.2 Scalability

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-07 | Launch-year data volume the design must absorb without re-architecture | 50,000 users, 10,000 vehicles, 20,000 bookings/month, 5,000 concurrent web sessions | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-08 | Concurrently tracked vehicles | 1,000, at a 10 s ping interval — approximately 100 writes/s bounded plus 33 appends/s sampled | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-09 | The API must be horizontally scalable with no in-process session or socket affinity | Stateless API nodes; Redis-backed socket adapter; any node can serve any request | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-10 | High-growth tables must be partitioned from day one rather than retrofitted | `audit_logs` and `vehicle_location_points` range-partitioned monthly | `PROPOSED — requires client confirmation (OQ-15)` |

### 5.3 Availability and continuity

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-11 | Monthly availability of the customer-facing and API surface | 99.5% excluding announced maintenance — approximately 3.6 h/month | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-12 | Recovery point objective | ≤ 15 minutes, via continuous WAL archiving | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-13 | Recovery time objective | ≤ 4 hours for full service restoration | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-14 | Backup regime and restore verification | Nightly full plus continuous WAL; restore rehearsed at least quarterly against a scratch environment | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-15 | Planned maintenance window | Announced 72 h ahead, outside 06:00–23:00 Asia/Riyadh | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-16 | A gateway, SMS or maps provider outage must degrade rather than fail the platform | Bidding, bookings and trips remain operable; the dependent action queues or reports a typed error | `PROPOSED — requires client confirmation (OQ-15)` |

### 5.4 Security

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-17 | Password storage | Argon2id with tuned memory and time cost; no plaintext or reversible storage anywhere | `CLIENT` — BRIEF-§3, §6 (parameters proposed) |
| NFR-18 | Access token lifetime and refresh rotation | Access 15 min; refresh 30 days, rotating, with family reuse detection and forced re-authentication on replay | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-19 | Transport security | TLS 1.2 minimum, 1.3 preferred; HSTS enabled; no plaintext transport on any path | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-20 | Sensitive identifiers at rest — national ID, Iqama, licence number, IBAN | AES-256-GCM with a KMS-managed key, plus last-four display values and HMAC blind indexes for lookup | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-21 | Rate limiting | Per-IP and per-account limits on authentication, OTP, bidding and payment endpoints; `RATE_LIMITED` returned with a retry hint | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-22 | Dependency and vulnerability posture | No known critical or high advisories in production dependencies at release; automated scanning in CI | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-23 | Independent security assessment before production launch | One external penetration test, with critical and high findings closed before go-live | `PROPOSED — requires client confirmation (OQ-15)` — no such requirement exists in either source |
| NFR-24 | Cardholder data | No PAN, CVV or full token is ever received, stored, logged or transmitted by UniGate systems; gateway tokens only. The resulting PCI-DSS scope position **requires review** by a qualified assessor | `PROPOSED — requires client confirmation (OQ-15)` |

### 5.5 Privacy

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-25 | Profile data must be separable into public, business, private and administrative classes, with owners able to restrict non-business information | Enforced in DTO mappers and the documents visibility enum, never client-side | `CLIENT` — RFP §3, BRIEF-§28 (field classification pending) |
| NFR-26 | No API response may expose another user's personal data, password hash, token, provider secret or private document | Entities are never returned directly; every response passes through an explicit DTO | `CLIENT` — BRIEF-§27, §28 |
| NFR-27 | Data retention periods for audit logs, location history, OTP records, login attempts and soft-deleted accounts | Proposed 24 months audit, 12 months location, 90 days login attempts, 30 days OTP. **Applicability of Saudi PDPL requires legal review** | `PROPOSED — requires client confirmation (OQ-08, OQ-15)` |
| NFR-28 | Hosting region and data residency | Proposed KSA or nearest available region. **Residency obligations require legal review** — no compliance is claimed | `PROPOSED — requires client confirmation (OQ-12)` |
| NFR-29 | Subject-access and erasure handling | A documented manual operational procedure at launch, not an automated endpoint | `PROPOSED — requires client confirmation (OQ-12, OQ-15)` |

### 5.6 Internationalisation and localisation

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-30 | English and Arabic across the entire interface including forms, tables, navigation, modals, notifications, dates and currency | Full parity; no string is hard-coded; message catalogues per locale | `CLIENT` — RFP §3, BRIEF-§1, §29 |
| NFR-31 | Right-to-left layout correctness | Direction switching at the document level; logical CSS properties only, with physical direction utilities blocked by a lint rule | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-32 | Money and number formatting | Stored as decimal, transported as a string with an explicit currency, formatted per locale on the client; SAR default | `CLIENT` — BRIEF-§3, §29 |
| NFR-33 | Date and time handling | Stored UTC, displayed in the user's timezone, Asia/Riyadh default; Hijri display capability architected for later | `CLIENT` — BRIEF-§46, §30 |
| NFR-34 | Adding a third language must not require a code change | Catalogue file plus locale registration only | `PROPOSED — requires client confirmation (OQ-15)` |

### 5.7 Accessibility

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-35 | Conformance level | **WCAG 2.2 Level AA** for all customer-facing and owner-facing screens | `PROPOSED — requires client confirmation (OQ-15)` — neither source names a standard |
| NFR-36 | Keyboard operability and visible focus across all interactive components | No pointer-only interaction; focus indicators meet the AA contrast requirement | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-37 | Colour contrast and non-colour status encoding | 4.5:1 for body text, 3:1 for large text and UI components; status conveyed by label and icon as well as colour | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-38 | Automated and manual accessibility verification in CI and before release | Zero automated critical violations; manual screen-reader pass on the golden path in both locales | `PROPOSED — requires client confirmation (OQ-15)` |

### 5.8 Compatibility

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-39 | Browser support matrix | Latest two stable versions of Chrome, Edge, Firefox and Safari, desktop and mobile. No Internet Explorer | `PROPOSED — requires client confirmation (OQ-15)` — no matrix exists in either source |
| NFR-40 | Responsive breakpoints | Usable from 360 px to 1920 px; admin data tables scroll horizontally within their container rather than breaking the page | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-41 | Progressive web app readiness | Installable manifest and offline shell for the customer portal | `CLIENT` — BRIEF-§1 (depth proposed) |
| NFR-42 | The API contract must be consumable unchanged by a future native mobile client | Bearer auth path, versioned envelope, published OpenAPI document | `CLIENT` — BRIEF-§37 |

### 5.9 Observability

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-43 | Structured JSON logs carrying a correlation id propagated from the edge through jobs | 100% of requests and background jobs | `CLIENT` — BRIEF-§41 (coverage proposed) |
| NFR-44 | Health and readiness endpoints distinguishing process liveness from dependency readiness | `GET /health`, `GET /ready` | `CLIENT` — BRIEF-§41 |
| NFR-45 | Error tracking and alerting on unhandled exceptions, failed webhook signature verification, outbox backlog and settlement failures | Alert within 5 minutes of threshold breach | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-46 | Log retention and searchability | 30 days hot, 12 months cold | `PROPOSED — requires client confirmation (OQ-08, OQ-15)` |

### 5.10 Maintainability

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-47 | Automated test coverage on domain services and financial calculations | ≥ 80% line coverage on services; 100% of money and state-transition paths covered by explicit cases | `PROPOSED — requires client confirmation (OQ-15)` |
| NFR-48 | The critical end-to-end workflow must be covered by an automated test | The §9 golden path plus the concurrency scenario, run in CI | `CLIENT` — BRIEF-§38 |
| NFR-49 | Strict TypeScript with no suppressed errors and no undocumented `any` | Build fails on type error; suppressions require an inline justification | `CLIENT` — BRIEF-§43, §49 |
| NFR-50 | Business logic exists in exactly one place, on the server | No duplicated rule between web and API; the client never performs an authorization decision | `CLIENT` — BRIEF-§49 |
| NFR-51 | Every schema change ships as a reviewed, reversible migration | No manual production schema edits; migrations run in CI against a clean database | `PROPOSED — requires client confirmation (OQ-15)` |

### 5.11 Portability

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-52 | Every external dependency sits behind an interface with at least a mock implementation | Payment gateway, OTP, SMS, email, push, storage, maps, tracking | `CLIENT` — BRIEF-§15, §16, §17 |
| NFR-53 | A developer can bring the full stack up locally with one command and no cloud account | Docker Compose with PostgreSQL, Redis and MinIO; validated environment schema | `CLIENT` — BRIEF-§39, §40 |
| NFR-54 | No provider-specific feature may be used where it prevents substitution | Standard PostgreSQL and S3-compatible APIs only | `PROPOSED — requires client confirmation (OQ-15)` |

### 5.12 Compliance-related (no compliance claimed)

| ID | Requirement | Proposed target | Status |
|---|---|---|---|
| NFR-55 | VAT-ready financial model with explicit rate, VAT amount and net-of-VAT values snapshotted per booking | Rate is configuration, never a constant; commission VAT tracked separately as the platform's own supply | `CLIENT` — BRIEF-§30 (rate pending tax review) |
| NFR-56 | Tax invoice structure with sequential gapless numbering, seller and buyer VAT numbers and reserved e-invoicing fields | Fields reserved and unpopulated. **ZATCA applicability requires tax review — no compliance is claimed** | `PROPOSED — requires client confirmation (OQ-04)` |
| NFR-57 | Transport licensing obligations for the platform and for participating owners and drivers | Not implemented. **TGA obligations require legal review** — no verification of operator licensing is performed | `PROPOSED — requires client confirmation (OQ-13)` |
| NFR-58 | Personal data handling posture | Encryption at rest for sensitive identifiers, least-privilege access, audit trail. **PDPL applicability requires legal review** — no compliance is claimed | `PROPOSED — requires client confirmation (OQ-12)` |

---

## 6. Ambiguous and missing business rules

Twenty-three questions neither source answers; **21 remain open**. IDs are fixed and must not be renumbered — they are referenced from [database.md](database.md), [architecture.md](architecture.md), [api.md](api.md) and [assumptions.md](assumptions.md). Each open question has an interim assumption so that work is not blocked, and each interim assumption is implemented as **configuration or a snapshot**, never as a hard-coded constant, so that the real answer arrives as data rather than as a refactor.

Answered questions stay in the table, struck through, with their answer and the date. They are not deleted — the register is also the record of what was asked and when, and an answer that changed the schema (both of these did) needs to remain traceable from the requirement it produced. **OQ-19…OQ-23 were created by those two answers**; see §3.8.

| OQ | Question | Why it matters | Interim assumption | Blocks | Who must answer |
|---|---|---|---|---|---|
| ~~OQ-01~~ | ~~What is the platform commission — percentage or fixed, what rate, and is it charged on gross or net of VAT?~~ **ANSWERED 2026-09-15 — not a number, a control.** Admin sets standing rules (none / percentage / fixed) and may override per trip at booking time; production starts at *no commission* until configured. Basis (gross vs net-of-VAT) is a per-rule admin field defaulting to `NET_OF_VAT`. FR-FINANCE-01, -20…-22 | This is the platform's entire revenue line. It is snapshotted per booking and never recomputed (D6), so bookings confirmed before the answer arrives keep whatever rate was in force — they cannot be retroactively corrected without a data migration and a restated set of owner settlements. The gross-versus-net choice alone moves platform revenue by the VAT fraction on every transaction. It also determines what owners are told they will earn, which is a contractual statement to them | **A-02**: 10% percentage, `GLOBAL` scope, basis `NET_OF_VAT`, seeded as the single mandatory active global rule. Deliberately distinct from the 15% VAT rate so the two are never confused in worked examples or test fixtures | 11 (and financial correctness of 8, 9) | UniGate commercial lead |
| ~~OQ-02~~ | ~~How long is a bid valid, and how long does the bidding window stay open relative to pickup time?~~ **ANSWERED 2026-09-15 by [ADR-009](decisions/ADR-009-configuration-over-constants.md): an admin setting with a seed, not a business constant — see the [settings catalogue](settings-catalogue.md).** | Too long and vehicles sit informally reserved against stale prices while customers wait; too short and owners in a different timezone or off-shift never see the opportunity, starving requests of bids. It also governs when the expiry job fires and therefore when `BID_EXPIRED` starts appearing to users | **A-35**: bid `valid_until` defaults to 24 h from submission; `bidding_closes_at` defaults to the earlier of pickup minus a lead time or creation plus 24 h; both are system settings | 7 | UniGate operations lead |
| OQ-03 | Which payment gateway or acquirer, and is a merchant account already held? | Determines which of the five RFP-named methods are actually available (STC Pay and Apple Pay are not universally offered), the webhook contract, the refund API shape, the settlement file format, and the onboarding lead time — which is typically weeks and is on the critical path for Phase 9. No production adapter can be written until this is fixed | **A-36**: `MockGateway` only; interface shaped against HyperPay, Moyasar, PayTabs and Checkout.com so any of the four can be adapted | 9 | UniGate finance lead |
| OQ-04 | Does ZATCA e-invoicing (Fatoora) apply to this platform, in which phase, and is UniGate the merchant of record or a marketplace facilitator? | Determines who issues the tax invoice to the customer, who bears the VAT liability, and whether cryptographic stamping and clearance are required. Retrofitting clearance onto issued invoices is not possible — invoices already sent to customers would have to be credited and reissued. **Requires tax review; no compliance is claimed** | **A-37**: `zatca_*` columns exist as reserved unpopulated placeholders; invoices issue with sequential gapless numbering and VAT fields, no stamping | 11 | UniGate tax advisor |
| ~~OQ-05~~ | ~~What are the cancellation fee tiers, who bears them, and what are the refund rules by cancellation reason and actor?~~ **ANSWERED 2026-09-15 — admin decides whether to charge for cancellation and no-show, and how much.** Designed as `cancellation_policies` (none / % / fixed, optional notice tiers, per cancelling party) plus per-case override and waiver; production charges nothing until configured. FR-BOOKINGS-09, -14…-16 | Directly determines money taken from or returned to a customer. Getting it wrong is a chargeback and a complaint, not a bug report. It differs by who cancelled — customer remorse, owner default and platform cancellation cannot attract the same fee — and by how long before pickup. Owner-initiated cancellation additionally raises whether the owner is penalised, which is a marketplace-behaviour decision | **A-38**: no fee applied; full refund on any cancellation before trip start. The applied rule is snapshotted per cancellation so real tiers apply cleanly from the day they are set | 8 | UniGate commercial lead |
| ~~OQ-06~~ | ~~What is the owner settlement cycle, cut-off, hold period and minimum payout?~~ **ANSWERED 2026-09-15 by [ADR-009](decisions/ADR-009-configuration-over-constants.md): an admin setting with a seed, not a business constant — see the [settings catalogue](settings-catalogue.md).** | Owner cash flow is the primary reason small operators leave a platform. It also determines platform float, the settlement job schedule, and whether a completed booking is payable immediately or held against dispute. Combined with OQ-05 it determines whether a refund after settlement becomes a clawback line | **A-39**: weekly cycle, period Sunday to Saturday, generated Sunday, no minimum payout, no hold period | 11 | UniGate finance lead |
| ~~OQ-07~~ | ~~What is the owner, driver and vehicle approval workflow, who approves, what evidence is mandatory, and what is the turnaround SLA?~~ **ANSWERED 2026-09-15 by [ADR-009](decisions/ADR-009-configuration-over-constants.md): an admin setting with a seed, not a business constant — see the [settings catalogue](settings-catalogue.md).** | Onboarding friction is the difference between supply arriving and supply giving up. A multi-step review with no stated SLA produces an unbounded queue and no way to tell whether operations are failing. It also determines which documents are hard gates on dispatch versus advisory | **A-40**: single-step admin approval; mandatory documents driven by `document_types.is_mandatory`; target turnaround two business days, measured but not enforced | 4, 5 | UniGate operations lead |
| OQ-08 | What retention periods apply to audit logs, GPS location history, OTP records, login attempts, documents and soft-deleted accounts? | Retention is simultaneously a cost question (location history is the fastest-growing table), an evidential question (a dispute six months later needs the trail) and a legal question. **PDPL applicability requires legal review.** Partitioning is already in place so the answer is an operational schedule rather than a migration — provided it arrives before the first partition would have been dropped | **A-41**: 24 months audit, 12 months location points (A-12), 90 days login attempts, 30 days OTP, indefinite for financial records | 14 | UniGate legal advisor |
| ~~OQ-09~~ | ~~What is the SPO commission model — per converted customer, per attributed booking, percentage or fixed, recurring or one-off, with or without clawback?~~ **ANSWERED 2026-09-15 by [ADR-009](decisions/ADR-009-configuration-over-constants.md): an admin setting with a seed, not a business constant — see the [settings catalogue](settings-catalogue.md).** | See §3.2. This is the largest scope risk in the project. The amount is snapshotted per booking and never recomputed, so every booking confirmed before the answer is fixed at zero. It is also an employment-versus-supplier question with payroll and VAT consequences that the delivery team cannot decide | **A-30**: `spo_profiles.commission_model` is an open `jsonb`; attribution is captured on requests and bookings; `spo_commission_amount` is written as zero and no payout path is built | 11 (partially 4, 13) | UniGate commercial lead |
| ~~OQ-10~~ | ~~Which SMS provider will be used for OTP and transactional messages, and is a sender ID registered?~~ **ANSWERED 2026-09-15: none exists.** Procurement action for UniGate (blocker B-9); provider choice is deployment configuration. | OTP is the gate on every self-registration, so an unavailable provider blocks the entire signup funnel. KSA sender-ID registration has lead time, and delivery rates to Saudi networks vary materially by provider. Cost per message at OTP volumes is a real operating expense | **A-42**: `ConsoleOtpProvider` in development; interface shaped for Unifonic, Twilio and Firebase; no production adapter written | 3 (production readiness), 16 | UniGate operations lead |
| ~~OQ-11~~ | ~~Will dedicated GPS hardware be used, from which vendor, and over what protocol and ingestion model?~~ **ANSWERED 2026-09-15: no trackers fitted; driver-app GPS at launch.** | Determines whether tracking data arrives by device push, vendor API poll or a third-party fleet platform — three different ingestion designs. It also determines whether tracking works when the driver's phone is off, which is the difference between a tracking feature and a tracking promise | **A-15**: driver-application GPS only at launch; `gps_devices` table and `TrackingProvider` interface exist so a hardware source can be added without schema change | 10 (hardware path only) | UniGate operations lead |
| OQ-12 | Where must the platform and its data be hosted, and does Saudi PDPL impose residency or transfer restrictions? | Hosting region is not reversible cheaply once production data exists. It also affects latency to KSA users and the availability of managed services. **Requires legal review; no compliance is claimed** | **A-43**: hosting in a KSA or nearest-available region; all data in one region; no cross-border replication configured | 16 | UniGate legal advisor |
| OQ-13 | What transport licensing obligations apply to the platform, and must owner or driver operating licences be verified and recorded? | If the platform is obliged to verify operator licensing, that is a mandatory document type, an approval gate and a recurring expiry check — not a feature request. Operating without it where it is required is a regulatory exposure for UniGate, not for the vendor. **Requires legal review** | **A-44**: no licence verification is performed; document types are data so a licence type can be added and made mandatory without a release | 4, 5 | UniGate legal advisor |
| OQ-14 | Are the Android and iOS applications in scope for this engagement, deferred to a named phase, or removed from scope? | See §3.3. This is a **contractual divergence**: RFP §5 names mobile apps as a deliverable and the brief instructs that they not be built in the first phase. A delivery that completes Phases 0–16 has not delivered RFP §5 bullet 2. Until this is confirmed in writing, acceptance of the engagement is ambiguous and the commercial envelope is unclear | **A-28**: web-first; no `apps/mobile` built; the API is built as an independent product with Bearer auth, device tokens and published OpenAPI so a mobile team can start with no backend rework | Scope of the whole engagement | UniGate project sponsor — **in writing** |
| ~~OQ-15~~ | ~~What are the expected volumes, concurrency, availability target, performance budget and support hours?~~ **ANSWERED 2026-09-15 — UniGate is starting from zero; the proposed NFR targets stand as the agreed year-one estimates (`ESTIMATE`), to be revisited after the first quarter of live data.** | See §3.5. Without these, capacity and cost cannot be sized, "performant" has no pass condition so Phase 15 cannot close objectively, and any support or maintenance term agreed under RFP §6 is open-ended. This is the question that converts §5 from proposals into requirements | **A-23**: the full §5 target set, adopted as working targets and labelled `PROPOSED` throughout | 14, 15, 16 | UniGate project sponsor |
| ~~OQ-16~~ | ~~When a request asks for N vehicles, how is it awarded — N separate bookings, one booking with N vehicles, must all be awarded together, and when are losing bids rejected?~~ | **ANSWERED 2026-09-14 — A-45.** Partial fulfilment is supported and the order stays open: take an order for N with whatever capacity exists, create one booking per accepted bid with its own schedule and wave number, rest in `PARTIALLY_AWARDED` indefinitely while still attracting bids for the balance, reopen the remainder when an awarded booking is cancelled, and let only the customer close an unfilled balance. Per-request `allow_partial_fulfilment` defaults on for goods, off for passenger | Confirmed requirement — FR-DEMAND-11…-16, FR-BIDDING-10…-13, FR-BOOKINGS-13; [database.md](database.md) §8.4, §8.6 | — | ✅ Closed — raised **OQ-22**, **OQ-23** |
| ~~OQ-17~~ | ~~Do corporate customers get credit terms and consolidated invoicing, or must every booking be prepaid?~~ | **ANSWERED 2026-09-14 — A-46.** Corporate customers are invoiced in arrears against an approved credit limit; individuals prepay. `billing_mode` is snapshotted on the booking and decides the entry state — an `INVOICED` booking skips `PENDING_PAYMENT` and confirms immediately. Invoices are header plus lines covering many bookings per period; a payment settles an invoice **or** a booking, never both | Confirmed requirement — FR-PROFILES-13, FR-BIDDING-14, FR-BOOKINGS-11, -12, FR-PAYMENTS-11, FR-FINANCE-15…-19; [database.md](database.md) §10.2, §12.6 | — | ✅ Closed — raised **OQ-19**, **OQ-20**, **OQ-21** |
| ~~OQ-18~~ | ~~May a driver supply their own vehicle, or exist independently of an owner?~~ **ANSWERED 2026-09-15 by [ADR-009](decisions/ADR-009-configuration-over-constants.md): an admin setting with a seed, not a business constant — see the [settings catalogue](settings-catalogue.md).** | Changes who the commercial counterparty is on a booking, who gets settled, who is rated, and who bears liability. It also changes the bidding model — currently only owners bid, with a vehicle they own. Opening this up is a marketplace design change, not a permission change | **A-29**: a bid must reference a vehicle belonging to the bidding owner; `driver_profiles.owner_profile_id` is nullable in schema but an independent driver has no bidding path | 7 | UniGate commercial lead |
| ~~OQ-19~~ | **ANSWERED 2026-09-15 (defaults are settings under ADR-009 — `billing.default_cycle`, `billing.default_credit_terms_days`):** the credit limit is **approved by an admin** — no scoring, no external evidence process; and the payment term is **agreed at trip confirmation** (snapshotted per booking, counted against the limit from that moment — FR-BOOKINGS-12, FR-BIDDING-14). **Still open:** the default billing cycle (monthly?) and the default term length (net-30?). ~~Who approves a credit limit, against what evidence, and how is it reviewed?~~ | The invoice period is what a corporate finance department reconciles against; getting it wrong means every corporate customer disputes their first invoice. Terms also set the size of the receivable UniGate carries: at 500 bookings a month, net-30 versus net-7 is a three-week difference in cash the platform has paid owners but not collected. Credit approval is a commercial risk decision with no technical answer — the schema supports `PER_BOOKING`, `WEEKLY` and `MONTHLY` equally well and cannot choose between them | **A-46**: monthly in arrears, net-30, `credit_limit_amount` set by an admin holding `customers.verify`, no automated scoring and no periodic review | 9, 11 | UniGate finance lead |
| OQ-20 | **Does owner settlement wait for the corporate customer to pay?** — the highest-impact question opened by the invoicing answer | Owners are settled weekly (**A-39**) while corporates pay in arrears (**A-46**). Those two answers do not compose: on every corporate booking, **UniGate pays the owner roughly three weeks before it collects from the customer, out of its own working capital.** At the §5 assumed volumes that is a continuously rolling six-figure SAR exposure that grows with corporate share, plus the full bad-debt loss if a corporate fails. The alternative — hold the owner's money until the customer pays — makes corporate work materially worse for owners than retail work, so owners will price it higher or decline it, and the supply side of the marketplace is the harder side to fix. Neither answer is wrong; the choice must be deliberate, made by whoever owns UniGate's cash position, and made before settlement is built rather than discovered on the first corporate invoice | **A-39 + A-46 as they stand**: owners are settled on the normal weekly cycle regardless of customer payment status, so UniGate carries the receivable and the default risk. This is the *consequence* of two separate assumptions, not a decision anyone has taken | **11** | UniGate finance lead / project sponsor — **treasury decision** |
| ~~OQ-21~~ | ~~What happens when a corporate exceeds its credit limit or goes overdue?~~ **ANSWERED 2026-09-15 — the credit limit is the only gate.** Over the limit → cannot book. Unpaid or overdue invoices with headroom remaining → can book. No automatic suspension; manual `SUSPENDED` retained. Exposure now defined to include live un-invoiced bookings (FR-BIDDING-14) | Decides whether a credit failure is a hard stop at award time or a soft warning. A hard stop protects UniGate's cash but rejects the customer at the worst possible moment — mid-booking, in front of an owner who has already quoted. A soft stop preserves the relationship and grows the exposure. It also determines whether an overdue account's *existing* confirmed bookings still run, which is a contractual question about work already committed | **A-46**: award blocked with `RULE_CREDIT_LIMIT_EXCEEDED`; `credit_status` may be moved to `SUSPENDED` by an admin; no interest, no dunning, no automatic suspension, existing bookings unaffected | 9 | UniGate finance lead |
| ~~OQ-22~~ | ~~How long may an unfilled remainder stay open, who chases it, and is there a default deadline?~~ **ANSWERED 2026-09-15 by [ADR-009](decisions/ADR-009-configuration-over-constants.md): an admin setting with a seed, not a business constant — see the [settings catalogue](settings-catalogue.md).** | An order that sits at three of five vehicles forever is an open commercial commitment on both sides — the customer believes two more are coming, and it clutters every owner's opportunity list with work nobody intends to fill. `remainder_closes_at` exists and is nullable precisely because this is undecided; leaving it null forever converts a marketplace into a backlog | **A-45**: `remainder_closes_at` is `NULL`, so the remainder stays open until the customer closes it (FR-DEMAND-14), with a nightly reminder to the customer after 7 days | 7 | UniGate operations lead |
| ~~OQ-23~~ | ~~For a later dispatch wave, does the customer accept each new bid, or may UniGate dispatch against the open remainder without returning to the customer?~~ **ANSWERED 2026-09-15 by [ADR-009](decisions/ADR-009-configuration-over-constants.md): an admin setting with a seed, not a business constant — see the [settings catalogue](settings-catalogue.md).** | UniGate's phrasing — "we should be able to take this order and dispatch" — suggests operations may fill the balance directly. That is a different consent model from customer-accepts-each-bid and changes **who is contractually committing** to the extra vehicles and to a price the customer has not seen. Wave 2 may legitimately cost more than wave 1 (§3.8), so dispatching without acceptance means charging a customer a price they never agreed. It also determines whether the Opportunities screen is a bidding surface or an allocation surface | **A-45**: the customer accepts each wave exactly as they accepted the first; an admin may act on the customer's behalf, which writes an audit entry naming the admin | 7 | UniGate operations lead / commercial lead |

**Blocking summary.** OQ-14 and OQ-15 are engagement-level and should be answered first — they affect scope and acceptance rather than a single phase. OQ-01, OQ-03, OQ-05, OQ-06, OQ-19 and OQ-21 must be answered before Phase 9 completes, because financial snapshots and issued invoices written under interim assumptions cannot be corrected by later configuration. **OQ-20 is the single highest-impact question now open** — it commits UniGate's working capital, it follows from answers already given rather than from anything still undecided in the sources, and it must be settled before settlement is built in Phase 11. OQ-22 and OQ-23 block Phase 7 and are cheap to answer; they are operational policy, not analysis. OQ-04, OQ-12 and OQ-13 require external professional advice and therefore have the longest lead time; they should be initiated now even though they do not block until Phases 11 and 16 — and OQ-04 has become more urgent, because consolidated tax invoices to VAT-registered corporates are exactly where Saudi e-invoicing obligations are most likely to apply.

> **Assumption numbering.** [assumptions.md](assumptions.md) is the authoritative register for `A-nn` identifiers; the IDs cited above resolve there. This table states the interim position for each open question; assumptions.md states the full rationale, the configuration surface and the impact if the assumption proves wrong. Where the two ever disagree, assumptions.md wins and this table is corrected. Identifiers are never reused.

---

## 7. Out of scope for the initial build

Explicitly excluded from Phases 0–16. Each entry states what is excluded, why, and **what is built instead** — the exclusions are insulated by abstractions and migration paths, not simply omitted.

| # | Excluded | Rationale | What is built instead |
|---|---|---|---|
| 1 | **Native Android and iOS applications** | BRIEF-§37 instructs that mobile not be built in the first phase and BRIEF-§48 contains no mobile phase. This contradicts RFP §5 and **must be confirmed in writing — OQ-14** | The API is a first-class independent product: versioned REST, Bearer-token auth alongside web cookie auth, `client_type` of `WEB`/`IOS`/`ANDROID` on sessions, `device_tokens` with `IOS`/`ANDROID`/`WEB` platforms for push, and a published OpenAPI document. A `apps/mobile` workspace slot is reserved. A mobile team can begin with zero backend rework |
| 2 | **ZATCA e-invoicing *integration*** — the flow is designed and exercised against a mock ([ADR-007](decisions/ADR-007-e-invoicing.md)); what is out of scope is the production adapter and onboarding | Issuer position was confirmed on 2026-09-14 (A-49), which made the *shape* of the flow decidable — clearance blocks B2B delivery and cannot be retrofitted. Applicability and wave remain unconfirmed and **require tax review** (OQ-04), so no production adapter is written | `invoices` with sequential gapless numbering, seller and buyer VAT numbers, supply date and full VAT breakdown, plus reserved unpopulated `zatca_uuid`, `zatca_hash`, `zatca_qr_payload`, `zatca_status` and `zatca_cleared_at` columns. Adding clearance is an integration, not a schema migration. **No compliance is claimed** |
| 3 | **Production payment gateway integration and certification** | No gateway is selected and no merchant account is confirmed — OQ-03. BRIEF-§17 explicitly forbids fake integrations | `PaymentGateway` interface with `createPayment`, `getPaymentStatus`, `refundPayment` and `processWebhook`, a `MockGateway` exercising every state including failure and partial refund, plus the full persistence model — payments, transactions, webhook events with signature verification and idempotency, refunds. Adding a real adapter touches one file |
| 4 | **GPS hardware procurement, provisioning and device integration** | Vendor and protocol unknown — OQ-11. Hardware also carries procurement lead time and cost that sit outside a software engagement | `TrackingProvider` interface, a `gps_devices` table with a nullable link from `vehicles`, and a `source` discriminator of `DRIVER_APP`/`GPS_DEVICE`/`EXTERNAL_API` on every location record. Driver-application GPS is fully implemented; a hardware ingestion path is an adapter plus a route |
| 5 | **PostGIS geospatial radius matching** | City and category matching is sufficient for launch and far simpler to reason about and debug. Radius matching adds an extension, a spatial index, tuning parameters and a class of silent correctness bugs, for a benefit that is unmeasurable before there is supply data | City-level matching against `owner_service_areas`, with `latitude`/`longitude` already stored on cities, trip requests and bookings. Migration path documented as **A-11**: add PostGIS, backfill a `geography` column, add a GiST index, swap the matching predicate |
| 6 | **Multi-currency** | Every source describes a single-market KSA platform. Multi-currency means FX rates, rate snapshots per transaction, revaluation and multi-currency settlement — a large amount of machinery for a speculative need | Every money column is paired with an explicit `currency CHAR(3)` rather than an implied currency, and money is transported as a string with a sibling currency field. The schema is already multi-currency-shaped; only conversion logic is absent |
| 7 | **Multi-country operation** | Single market. Country-specific tax rules, document types, phone formats, plate formats and licensing would each need to become dimensional | Regions and cities are reference data rather than constants; document types, vehicle categories, expense categories and VAT rate are all data; phone handling is E.164. A country dimension would be an additive migration |
| 8 | **Multi-stop and multi-leg routing** | The RFP describes point-to-point hire. Normalising pickup and dropoff into a `stops` table complicates every query, DTO, form and report for a requirement neither source asks for | Pickup and dropoff are embedded columns on `trip_requests` and snapshotted onto `bookings`. `Trip` is deliberately separate from `Booking` so multiple legs per booking remain possible. Migration path documented as **A-14** |
| 9 | **A driver marketplace outside owner fleets** — independent drivers bidding, or drivers supplying their own vehicles | Changes the commercial counterparty, the settlement recipient and the liability position. This is a marketplace design decision, not a feature — **OQ-18** | `driver_profiles.owner_profile_id` is nullable in schema, and `vehicle_driver_assignments` keeps full history, so an independent driver can be represented. No bidding path exists for one, and bids must reference a vehicle owned by the bidding owner |
| 10 | **Insurance products** — in-platform cargo or passenger cover, quoting, or claims | Regulated activity requiring an insurance partner, product terms and almost certainly a licence. Nothing in either source asks for it; BRIEF-§11 asks only that a customer can *declare* cargo value and *indicate* that insurance is required | `goods_trip_details.declared_value_amount` and `requires_insurance` capture the customer's declaration and pass it to bidding owners as a commercial input. Vehicle insurance policy number and expiry are recorded for compliance gating. No cover is offered, quoted, priced or claimed |
| 11 | **Automated subject-access and erasure endpoints** | PDPL applicability is unconfirmed — OQ-12. A self-service erasure endpoint against financial records that must be retained is actively dangerous | Selective soft deletion with an explicit retention classification per table, PII encrypted at rest with blind-index lookup, and a documented manual operational procedure |
| 12 | **Dynamic or algorithmic pricing, surge, and price recommendation** | Not requested in either source. The platform's model is owner-quoted bidding, which is the opposite of platform-set pricing | Owners set their own prices. Bid comparison surfaces price alongside rating and arrival estimate so the customer chooses. Historical bid and booking data accumulates, which is the prerequisite for any future pricing model |
| 13 | **Chat or messaging between customer, owner and driver** | Not requested. In-platform messaging carries moderation, retention, abuse-reporting and notification obligations disproportionate to launch | Counterparty contact details are exposed on active bookings under the privacy rules, and complaints provide a moderated escalation channel |
| 14 | **Deployment support and staff training as a service**, and the ownership and data policy | RFP §5 bullet 6 and RFP §6 bullet 6 are commercial commitments with no technical specification — see §3.4 | Phase 16 delivers deployment *automation*: containerised images, environment schema validation, migration and seed procedures, runbooks and health checks. The service commitment and the policy document are contractual workstream items |

---

## 8. Requirement traceability matrix

### 8.1 RFP clause coverage

Every clause of RFP §1–§8 is enumerated and traced. "Design artefact" names the document section that realises the clause.

| Clause | RFP text (abbreviated) | FR / NFR | Module | Phase | Design artefact |
|---|---|---|---|---|---|
| RFP-1 | Introduction — comprehensive vehicle hiring and management platform, passenger and goods | FR-DEMAND-01, FR-DEMAND-02, entire catalogue | all | 0–16 | [architecture.md](architecture.md) §1–2 |
| RFP-2 | Objective — web platform and mobile application connecting owners, drivers and customers | FR-PROFILES-01, -03, -07, -10; NFR-42 | profiles | 4 | [architecture.md](architecture.md) §3; mobile **deferred — OQ-14** |
| RFP-3.1 | Web portal and mobile applications (Android & iOS) | FR-PLATFORM-04, -07; NFR-41, NFR-42 | platform | 2 | [architecture.md](architecture.md) §4 portals. **Web covered; mobile deferred — OQ-14** |
| RFP-3.2 | Vehicle management — make, model, drivers, maintenance, availability, booking status, trip history, GPS | FR-FLEET-01…-12, FR-MAINTENANCE-01…-05, FR-TRACKING-01…-06 | fleet, maintenance, tracking | 5, 10, 12 | [database.md](database.md) §7, §13.1; `/vehicles`, `/maintenance` |
| RFP-3.3 | Bidding mechanism for trip requests with owner quotations | FR-BIDDING-01…-14 | bidding | 7 | [database.md](database.md) §9; `/trip-requests`, `/bids`. FR-BIDDING-10…-14 are client clarification, not RFP — see §8.4 |
| RFP-3.4 | Customer module — account creation and OTP verification, request trips, compare bids, book, track | FR-IAM-01…-03, FR-DEMAND-01…-16, FR-BIDDING-07, -08, FR-BOOKINGS-01…-13, FR-TRACKING-05 | iam, demand, bidding, bookings, tracking | 3, 6, 7, 8, 10 | [database.md](database.md) §5, §8, §10; `/auth`, `/trip-requests`, `/bids`, `/bookings`. FR-DEMAND-11…-16 and FR-BOOKINGS-11…-13 are client clarification — see §8.4 |
| RFP-3.5 | Finance management — vehicle income, expenses, commission tracking | FR-FINANCE-01…-19 | finance | 11 | [database.md](database.md) §12; `/finance`, `/expenses`. FR-FINANCE-15…-19 are client clarification — see §8.4 |
| RFP-3.6 | Admin dashboard — user management, platform analytics, reporting | FR-ADMIN-01…-08, FR-REPORTING-01…-08 | admin, reporting | 13 | [database.md](database.md) §13.4; `/admin`, `/reports` |
| RFP-3.7 | Payment gateway integration — Mada, Visa, MasterCard, STC Pay, Apple Pay | FR-PAYMENTS-01…-11; NFR-24 | payments | 9 | [database.md](database.md) §12.1–12.2; `/payments`. **Gateway unselected — OQ-03.** The RFP names only card and wallet methods; corporate invoicing (FR-PAYMENTS-11) is client clarification — see §8.4 |
| RFP-3.8 | Multilingual interface — English and Arabic | FR-PLATFORM-06, -07; NFR-30…-34 | platform | 2 | [architecture.md](architecture.md) i18n; `messages/en.json`, `messages/ar.json` |
| RFP-3.9 | Data privacy controls allowing owners to restrict non-business information | FR-PROFILES-06, FR-DOCUMENTS-07; NFR-25, NFR-26 | profiles, documents | 4 | [security.md](security.md) privacy; `owner_profiles.privacy_settings`, `documents.visibility` |
| RFP-4.1 | Admin — manages all users including SPOs, vehicles, bookings, payments, system data | FR-IAM-15, FR-ADMIN-02…-07, FR-PROFILES-11, -12 | iam, admin, profiles | 3, 4, 13 | [database.md](database.md) §5.4, §6.2. **SPO rules absent — OQ-09, see §3.2** |
| RFP-4.2 | Vehicle Owner / Driver — registers vehicles, manages bids, trips, maintenance | FR-PROFILES-03…-10, FR-FLEET-*, FR-BIDDING-*, FR-TRIPS-*, FR-MAINTENANCE-* | profiles, fleet, bidding, trips, maintenance | 4–12 | [database.md](database.md) §6.2 deviation V12. **Split into two profiles — see §3.1** |
| RFP-4.3 | Customer — requests and books trips, compares bids, tracks vehicles in real time | FR-DEMAND-*, FR-BIDDING-07, -08, FR-BOOKINGS-*, FR-TRACKING-05, -06 | demand, bidding, bookings, tracking | 6–10 | [database.md](database.md) §8, §10, §11.4 |
| RFP-5.1 | Deliverable — web-based admin and management portal | FR-ADMIN-01…-08, FR-PLATFORM-07 | admin, platform | 13 | [architecture.md](architecture.md) §4; `/admin` route group |
| RFP-5.2 | Deliverable — mobile applications for customers and owners/drivers | NFR-42 | — | — | **Deferred with agreement required — OQ-14, see §3.3** |
| RFP-5.3 | Deliverable — backend database and API integration | FR-PLATFORM-04, -05, -06 | platform | 2 | [database.md](database.md) all; [api.md](api.md) all |
| RFP-5.4 | Deliverable — payment gateway setup and testing | FR-PAYMENTS-01, -05, -06, -07 | payments | 9 | [api.md](api.md) `/payments`; `MockGateway` test suite. **Real setup blocked — OQ-03** |
| RFP-5.5 | Deliverable — source code and technical documentation | NFR-49, NFR-51 | — | 0–16 | `docs/` set per BRIEF-§42 plus `docs/decisions/` ADRs and OpenAPI |
| RFP-5.6 | Deliverable — deployment support and staff training | — | — | 16 | **Commercial workstream — no technical spec, see §3.4** |
| RFP-6.1 | Proposal — company profile and relevant experience | — | — | — | Commercial proposal document |
| RFP-6.2 | Proposal — proposed technology stack | — | — | 1 | [architecture.md](architecture.md) §2 stack; mandated by BRIEF-§1–§4 |
| RFP-6.3 | Proposal — detailed project plan and timeline | — | — | 0 | Phase plan 0–16, BRIEF-§48; `docs/IMPLEMENTATION_STATUS.md` |
| RFP-6.4 | Proposal — cost breakdown by module and milestone | — | — | — | Commercial proposal; the canonical 18 modules give the breakdown structure |
| RFP-6.5 | Proposal — maintenance and support terms | NFR-11, NFR-15, NFR-45 | — | — | **Commercial workstream; depends on OQ-15** |
| RFP-6.6 | Proposal — ownership and data policy | NFR-27, NFR-28 | — | — | **Commercial and legal workstream — see §3.4** |
| RFP-7.1 | Evaluation — technical expertise and portfolio | — | — | — | Commercial proposal |
| RFP-7.2 | Evaluation — methodology and technology stack | — | — | 1 | [architecture.md](architecture.md); `docs/decisions/` ADRs |
| RFP-7.3 | Evaluation — cost and timeline feasibility | — | — | 0 | Phase plan; this document's risk register (§10) |
| RFP-7.4 | Evaluation — post-launch support and maintenance | NFR-11, NFR-43…-46 | — | — | **Commercial workstream; depends on OQ-15** |
| RFP-8 | Submission details and contact | — | — | — | Commercial process |

### 8.2 RFP coverage summary

| Category | Clauses | Notes |
|---|---|---|
| Total RFP clauses enumerated (§1–§8) | **31** | |
| Covered by the Phase 0–16 build | **17** | RFP-1, -2, -3.2…-3.9, -4.1…-4.3, -5.1, -5.3, -5.4, -5.5 |
| Partially covered, remainder deferred with client agreement required | **2** | RFP-3.1 (web built, mobile deferred), RFP-5.2 (mobile) — both gated on **OQ-14** |
| Commercial, contractual or proposal-process clauses with no code deliverable | **12** | RFP-5.6, -6.1…-6.6, -7.1…-7.4, -8 |
| **Traced** | **31 / 31 = 100%** | No RFP clause is unaccounted for |
| Covered but blocked on an open question before it can be completed | 4 | RFP-3.5 (OQ-01, OQ-06, OQ-19, OQ-20), RFP-3.7 (OQ-03), RFP-4.1 (OQ-09), RFP-5.4 (OQ-03) |

> **RFP coverage is unchanged at 31/31 = 100%.** The 22 requirements added on 2026-09-14 do **not** come from the RFP and are not counted against it — no new RFP clause was discovered, because the RFP contains neither partial fulfilment nor corporate invoicing. They originate from UniGate's answers to OQ-16 and OQ-17 and are traced separately in §8.4. Of the 182 functional requirements, **160 trace to the RFP or the engagement brief and 22 trace to client clarification dated 2026-09-14** — which is the measurable form of the finding in §3.8.

### 8.3 Engagement brief section coverage

Grouped where sections map to one module. Sections §39–§53 are delivery-process instructions rather than requirements and are traced to process artefacts.

| Brief sections | Subject | FR / NFR | Module | Phase | Design artefact |
|---|---|---|---|---|---|
| §1, §36 | Frontend stack, UI/UX, component set | NFR-03, NFR-31, NFR-35…-41 | platform | 2 | [architecture.md](architecture.md) frontend; `packages/ui` |
| §2, §31, §32, §43, §44 | Backend stack, API design, pagination, error handling | FR-PLATFORM-04, -05, -06 | platform | 2 | [api.md](api.md) conventions; `/api/v1` envelope |
| §3, §33, §34 | Database, entity model, migrations and seeding | — (realised by all FRs) | all | 2 | [database.md](database.md) §1–§3, §14.3 |
| §4 | Monorepo architecture | NFR-53 | — | 2 | [architecture.md](architecture.md) repo layout |
| §5 | System users and per-role capabilities | FR-IAM-15, -16; FR-PROFILES-01…-12; FR-ADMIN-02…-06 | iam, profiles, admin | 3, 4, 13 | [database.md](database.md) §5.4, §6.2; RBAC in [security.md](security.md) |
| §6 | Authentication | FR-IAM-01…-14; NFR-17, NFR-18 | iam | 3 | [database.md](database.md) §5.1–5.5; [security.md](security.md) auth |
| §7, §30 | Customer types, KSA considerations | FR-PROFILES-01, -02, -13; NFR-32, NFR-33, NFR-55 | profiles | 4 | [database.md](database.md) §6.2, §12.6. Brief §7 names credit terms as a field only; the credit facility behaviour is client clarification — §8.4 |
| §8, §9 | Vehicle and driver management | FR-FLEET-01…-11; FR-PROFILES-07…-09 | fleet, profiles | 5 | [database.md](database.md) §7.1, §7.2 |
| §10, §47 | Document subsystem and file storage | FR-DOCUMENTS-01…-08 | documents | 4 | [database.md](database.md) §6.1 |
| §11 | Trip request domain object | FR-DEMAND-01…-09, -11…-16 | demand | 6 | [database.md](database.md) §8.1–8.4, §8.6. Brief §11 supplies `number of vehicles`; the fulfilment behaviour is client clarification — §8.4 |
| §12 | Bidding and quotation | FR-BIDDING-01…-14; FR-DEMAND-10 | bidding, demand | 7 | [database.md](database.md) §9.1–9.2 |
| §13 | Booking system and snapshots | FR-BOOKINGS-01…-13 | bookings | 8 | [database.md](database.md) §10.1–10.3 |
| §14 | Trip execution lifecycle and proof of delivery | FR-TRIPS-01…-08 | trips | 10 | [database.md](database.md) §11.1–11.3 |
| §15, §16 | GPS tracking and maps abstraction | FR-TRACKING-01…-06; FR-DEMAND-07, -08; NFR-04 | tracking, demand | 6, 10 | [database.md](database.md) §11.4; [architecture.md](architecture.md) realtime |
| §17 | Payments | FR-PAYMENTS-01…-11; NFR-24 | payments | 9 | [database.md](database.md) §12.1–12.2 |
| §18, §19 | Commission, owner finance, ledger | FR-FINANCE-01…-12, -14…-19 | finance | 11 | [database.md](database.md) §12.3–12.6 |
| §20 | Expense management | FR-FINANCE-13 | finance | 11 | [database.md](database.md) §12.5 |
| §21 | Maintenance | FR-MAINTENANCE-01…-05 | maintenance | 12 | [database.md](database.md) §13.1 |
| §22 | Ratings | FR-ENGAGEMENT-01…-04 | engagement | 13 | [database.md](database.md) §13.2 |
| §23 | Notifications | FR-NOTIFICATIONS-01…-06 | notifications | 13 | [database.md](database.md) §13.3 |
| §24 | Admin dashboard KPIs | FR-ADMIN-01 | admin | 13 | [api.md](api.md) `/admin/dashboard` |
| §25 | Reporting and export | FR-REPORTING-01…-08; FR-ENGAGEMENT-05, -06 | reporting, engagement | 13 | [database.md](database.md) `export_jobs`; [api.md](api.md) `/reports` |
| §26 | Audit logging | FR-PLATFORM-01…-03 | platform | 3+ | [database.md](database.md) §13.4; [security.md](security.md) audit |
| §27, §28 | Security and privacy | FR-IAM-16, FR-PROFILES-06, FR-DOCUMENTS-04; NFR-17…-29 | all | 14 | [security.md](security.md) all |
| §29 | Internationalisation | FR-PLATFORM-06, -07; NFR-30…-34 | platform | 2 | [architecture.md](architecture.md) i18n |
| §35 | Frontend route groups and portal separation | FR-PLATFORM-07 | platform | 2 | [architecture.md](architecture.md) route structure |
| §37 | Mobile strategy | NFR-42 | — | — | **Deferred — OQ-14, §3.3** |
| §38 | Testing strategy and the critical workflow | NFR-47, NFR-48 | — | 15 | §9 of this document; Playwright E2E suite |
| §39, §40 | Development environment and configuration | NFR-53 | — | 2 | `docker-compose.yml`, `.env.example`, env schema |
| §41 | Observability | FR-PLATFORM-08; NFR-43…-46 | platform | 2 | [architecture.md](architecture.md) observability |
| §42 | Documentation set | NFR-49 | — | 1 | `docs/` and `docs/decisions/` |
| §45 | Concurrency and transactions | FR-BIDDING-08, FR-FLEET-11, FR-BOOKINGS-05, FR-PAYMENTS-08, FR-FINANCE-10 | bidding, fleet, bookings, payments, finance | 7–11 | [database.md](database.md) §7.3, §9.2 |
| §46 | Date and time handling | NFR-33 | — | 2 | [database.md](database.md) D4 |
| §48 | Phase plan | — | — | 0–16 | Phase column throughout this document |
| §49, §50, §43 | Development behaviour, git strategy, coding standards | NFR-49, NFR-50, NFR-51 | — | 0–16 | Contribution guide; CI gates |
| §51 | Do not guess business rules | §6 of this document | — | 0 | [assumptions.md](assumptions.md) |
| §52 | Progress tracking | — | — | 0–16 | `docs/IMPLEMENTATION_STATUS.md`, `docs/TODO.md` |
| §53 | First task — Phase 0 and Phase 1 only | — | — | 0–1 | This document plus the Phase 1 set |

### 8.4 Client clarification coverage — answers dated 2026-09-14

These 22 requirements have **no RFP clause and no brief section**. Their source is UniGate's written answers to OQ-16 and OQ-17, recorded as **A-45** and **A-46** in [assumptions.md](assumptions.md) §2.5. They are traced separately so that a future reader can tell at a glance which parts of the build were asked for in the contract, which were instructed in the brief, and which were established by asking. See §3.8 for why that distinction is worth keeping.

| Confirmed answer | FR | Module | Phase | Design artefact | Residual open question |
|---|---|---|---|---|---|
| **A-45** — accept an order with less than full capacity | FR-DEMAND-11, FR-DEMAND-15 | demand | 6 | [database.md](database.md) §8.1 `allow_partial_fulfilment`, §8.6 | — |
| **A-45** — the order rests open and does not expire | FR-DEMAND-12 | demand | 6 | [database.md](database.md) §8.4 `PARTIALLY_AWARDED` | **OQ-22** how long |
| **A-45** — a cancelled booking reopens the remainder | FR-DEMAND-13 | demand, bookings | 8 | [database.md](database.md) §8.1 counters, §8.4 | — |
| **A-45** — only the customer closes an unfilled balance | FR-DEMAND-14 | demand | 6 | [database.md](database.md) §8.4 `CLOSED_PARTIAL` | **OQ-22** |
| **A-45** — fulfilment counters and wave grouping | FR-DEMAND-16, FR-REPORTING-08 | demand, reporting | 6, 13 | [database.md](database.md) §8.1, §10.1 `fulfilment_sequence` | — |
| **A-45** — later waves keep losing bids live and awardable | FR-BIDDING-09 *(modified)*, FR-BIDDING-10 | bidding | 7 | [database.md](database.md) §9.2 step 8 | **OQ-23** who consents |
| **A-45** — all-or-nothing group award and its refusal path | FR-BIDDING-11, FR-BIDDING-12 | bidding | 7 | [database.md](database.md) §8.6, §9.2; `ck_trip_requests_partial` | — |
| **A-45** — bidding on a remainder outlives the first pickup | FR-BIDDING-06 *(modified)*, FR-BIDDING-13 | bidding | 7 | [database.md](database.md) §8.1 `remainder_closes_at`; removed bidding-window constraint | **OQ-22** |
| **A-45** — per-wave schedule and price | FR-BOOKINGS-13 | bookings | 8 | [database.md](database.md) §8.6, §10.1 | **OQ-23** price consent |
| **A-46** — corporate credit facility and its approval | FR-PROFILES-13 | profiles | 4 | [database.md](database.md) §12.6 `credit_*` | **OQ-19** cycle and term |
| **A-46** — credit check inside the award transaction | FR-BIDDING-14 | bidding | 7 | [database.md](database.md) §12.6 | **OQ-21** breach handling |
| **A-46** — `INVOICED` bookings bypass the payment gate | FR-BOOKINGS-03 *(modified)*, -05 *(modified)*, -11, -12 | bookings | 8 | [database.md](database.md) §10.1 `billing_mode`, §10.2 | — |
| **A-46** — consolidated invoicing, lines, and one live invoice per booking | FR-FINANCE-12 *(modified)*, -15, -16, -17 | finance | 11 | [database.md](database.md) §12.6 `invoices`, `invoice_lines` | **OQ-04** ZATCA, **OQ-19** |
| **A-46** — paying an invoice rather than a booking | FR-PAYMENTS-01 *(modified)*, FR-PAYMENTS-11 | payments | 9 | [database.md](database.md) §12.6 `ck_payments_single_target` | — |
| **A-46** — credit notes, voiding, receivables ageing | FR-FINANCE-18, FR-FINANCE-19, FR-FINANCE-09 *(modified)* | finance | 11 | [database.md](database.md) §12.6 `invoice_status` | **OQ-20** settlement timing |

**Summary.** 22 new functional requirements, 11 existing requirements amended, 5 new open questions, 2 questions closed. Every row above is implemented in the Phase 1 schema; none is speculative. The two questions these answers closed were among eighteen raised at Phase 0 — the remaining twenty-one are not expected to be cheaper.

---

## 9. Acceptance criteria — the golden path

BRIEF-§38 names one workflow that **must** be covered by automation: customer creates request → owner bids → customer accepts → booking created → payment → driver assignment → trip started → tracking → trip completed → financial calculation. The scenarios below are the acceptance definition for that workflow and are implemented as the Playwright end-to-end suite plus API integration tests in Phase 15. They are written against interim assumptions where a rule is unanswered; the assumption is named inline so the test changes with the answer rather than being rewritten.

§9.10 and §9.11 sit **outside** BRIEF-§38's named workflow. They cover the two rules UniGate confirmed on 2026-09-14 — partial fulfilment and corporate invoicing (§3.8) — and they are included at the same level of rigour because each breaks an assumption the golden path quietly relies on: that an order is awarded once, and that a booking is paid before it is confirmed.

### 9.1 Preconditions

```gherkin
Background:
  Given a seeded platform with reference data, roles and permissions
  And an active global commission rule of 10 percent on a net-of-VAT basis   # A-02 test fixture; production seeds NONE (OQ-01 answered 2026-09-15)
  And a system VAT rate of 15 percent
  And a verified customer "Layla" with an ACTIVE account and a CUSTOMER role
  And an APPROVED vehicle owner "Al-Masar Transport" with a VEHICLE_OWNER role
  And an APPROVED driver "Omar" employed by "Al-Masar Transport" with a valid licence
  And an APPROVED, ACTIVE vehicle "Toyota Hiace 2022" of category VAN owned by "Al-Masar Transport"
  And the vehicle has no calendar entries overlapping 2026-10-01T08:00Z to 2026-10-01T14:00Z
```

### 9.2 Scenario 1 — Customer creates and publishes a trip request

```gherkin
Scenario: Customer publishes a passenger trip request
  Given Layla is authenticated
  When she creates a PASSENGER trip request
    | pickup            | Riyadh, King Khalid International Airport |
    | dropoff           | Riyadh, Olaya District                    |
    | pickup_at         | 2026-10-01T08:00Z                         |
    | trip_direction    | ONE_WAY                                   |
    | vehicle_category  | VAN                                       |
    | vehicles_required | 1                                         |
    | passenger_count   | 9                                         |
  Then the response is 201 with the standard success envelope
  And the trip request has status DRAFT and a request number matching TR-YYYY-NNNNNN
  And a passenger_trip_details row exists and no goods_trip_details row exists
  When she publishes the trip request
  Then the status is PUBLISHED
  And bidding_closes_at is set and is not later than pickup_at
  And an estimated distance and duration are stored from the maps provider
```

```gherkin
Scenario: Matching invites eligible owners and records the invitation
  Given the trip request is PUBLISHED
  When the matching job runs
  Then "Al-Masar Transport" receives a trip_request_invitation for the VAN
  And the invitation records notified_at and the channels used
  And a NEW_TRIP_OPPORTUNITY notification is queued for the owner
  And an owner whose service area excludes Riyadh receives no invitation
```

### 9.3 Scenario 2 — Owner submits a bid

```gherkin
Scenario: Owner bids on an eligible request
  Given "Al-Masar Transport" is authenticated and holds bids.create
  When the owner submits a bid on the request
    | vehicle    | Toyota Hiace 2022 |
    | driver     | Omar              |
    | base_amount| 1000.00           |
    | extras     | [{Airport access fee, 50.00}] |
    | valid_until| 2026-09-30T08:00Z |
  Then the response is 201
  And the stored bid has base_amount "1000.00", extras_amount "50.00", vat_rate "0.1500",
      vat_amount "157.50" and total_amount "1207.50", all as strings with currency "SAR"
  And the bid status is SUBMITTED with version 1
  And a BID_RECEIVED notification is queued for Layla

Scenario: A client-supplied total is ignored, not trusted
  When the owner submits a bid with base_amount "1000.00" and total_amount "10.00"
  Then the stored total_amount is "1207.50"
  And no error is raised about the mismatch

Scenario: The same vehicle cannot be bid twice on one request
  Given a SUBMITTED bid exists for the Hiace on this request
  When the owner submits another bid for the same vehicle on the same request
  Then the response is 409 with error code CONFLICT_DUPLICATE_BID

Scenario: An expired bid cannot be accepted
  Given the bid's valid_until has passed and the expiry job has run
  Then the bid status is EXPIRED
  And accepting it returns 422 with error code BID_EXPIRED
```

### 9.4 Scenario 3 — Customer accepts the bid; booking and financial snapshot are created atomically

```gherkin
Scenario: Bid acceptance creates booking, reservation and snapshot in one transaction
  Given Layla is authenticated and the bid is SUBMITTED and unexpired
  When she accepts the bid with a fresh idempotency key
  Then the response is 200
  And a booking exists with a number matching BK-YYYY-NNNNNN and status PENDING_PAYMENT
  And the booking carries immutable snapshots of the plate, vehicle description,
      category code and owner name taken at this moment
  And the booking total_amount is "1207.50" with currency "SAR"
  And a vehicle_calendar_entry of type RESERVATION exists for the Hiace with status HELD
  And the reserved period extends 60 minutes beyond the booked window at both ends   # A-07
  And a booking_financial_snapshot exists where
      gross "1207.50", vat_amount "157.50", net_of_vat "1050.00",
      commission_rate "0.1500", commission_amount "157.50",
      commission_vat_amount "23.63", owner_net_amount "1026.37"
  And owner_net + commission + commission_vat + payment_fee equals gross exactly
  And the bid status is ACCEPTED and the trip request status is AWARDED
  And an outbox event BID_ACCEPTED was written inside the same transaction

Scenario: Replaying the acceptance with the same idempotency key is safe
  When Layla repeats the acceptance request with the same idempotency key
  Then the response is the stored original response
  And exactly one booking exists for this bid

Scenario: The transaction is all-or-nothing
  Given the financial snapshot write is forced to fail
  When Layla accepts the bid
  Then no booking exists
  And no vehicle_calendar_entry exists
  And the bid status is still SUBMITTED
```

### 9.5 Scenario 4 — Concurrency: two customers, one vehicle, overlapping window

This is the scenario BRIEF-§12 and BRIEF-§45 single out. It is the correctness property the whole reservation design exists to guarantee.

```gherkin
Scenario: Exactly one of two simultaneous acceptances succeeds
  Given a second customer "Faisal" has a PUBLISHED trip request whose window
        2026-10-01T10:00Z to 2026-10-01T16:00Z overlaps Layla's window
  And "Al-Masar Transport" has submitted a SUBMITTED bid to Faisal using the same Hiace
  And both bids are valid and undecided
  When Layla and Faisal accept their respective bids simultaneously
  Then exactly one acceptance returns 200 and creates a booking
  And the other returns 409 with error code BID_VEHICLE_UNAVAILABLE
  And exactly one vehicle_calendar_entry of type RESERVATION exists for the Hiace
  And the losing bid remains SUBMITTED and is not silently rejected
  And the losing customer's trip request remains PUBLISHED and re-biddable
  And no orphan booking, financial snapshot or ledger entry exists for the losing attempt
  And no deadlock is reported, because locks are taken in the order
      trip_request then bid then vehicle in both transactions

Scenario Outline: The guarantee holds regardless of which cause occupies the vehicle
  Given the Hiace already has a <entry_type> entry covering the requested window
  When a customer accepts a bid offering that vehicle for that window
  Then the response is 409 with error code BID_VEHICLE_UNAVAILABLE
  Examples:
    | entry_type  |
    | RESERVATION |
    | MAINTENANCE |
    | OWNER_BLOCK |

Scenario: The guarantee is enforced by the database, not by a prior check
  Given the application-level availability pre-check is disabled
  When two acceptances for the same vehicle and overlapping window run concurrently
  Then exactly one still succeeds
  And the failure surfaces as a constraint violation translated to 409 BID_VEHICLE_UNAVAILABLE
```

### 9.6 Scenario 5 — Payment

```gherkin
Scenario: Payment capture confirms the booking
  Given a booking in PENDING_PAYMENT
  When Layla initiates payment and the gateway returns a redirect or checkout reference
  Then a payment row exists with status PENDING and purpose BOOKING_PAYMENT
  When the gateway posts a signed payment.captured webhook
  Then the webhook event is persisted before it is processed
  And the payment status becomes PAID
  And the booking status becomes CONFIRMED and payment_status becomes PAID
  And the reservation calendar entry moves from HELD to CONFIRMED
  And ledger entries are posted whose debits equal their credits within the transaction group
  And a BOOKING_CONFIRMED notification is queued for Layla and the owner

Scenario: A frontend claim of success does not confirm anything
  Given the gateway has not sent a webhook
  When the client reports a successful payment
  Then the booking remains PENDING_PAYMENT

Scenario: Duplicate webhook delivery is inert
  When the same provider event id is delivered a second time
  Then the response is 200
  And the payment and booking are unchanged
  And exactly one set of ledger entries exists

Scenario: A forged webhook is stored as evidence and never processed
  When a webhook arrives with an invalid signature
  Then the event is persisted with signature_valid false
  And a SECURITY audit entry is written
  And the payment and booking are unchanged

Scenario: An unpaid booking releases its vehicle
  Given the payment window elapses with no capture
  Then the booking becomes CANCELLED
  And the reservation calendar entry becomes RELEASED
  And the vehicle is bookable for that window again
```

### 9.7 Scenario 6 — Driver assignment and dispatch readiness

```gherkin
Scenario: Owner assigns an eligible driver
  Given a CONFIRMED booking
  When the owner assigns driver "Omar"
  Then the booking status becomes DRIVER_ASSIGNED
  And a trip is created with status DRIVER_ASSIGNED, snapshotting vehicle and driver
  And a DRIVER_ASSIGNED notification is queued for Layla and for Omar
  And Layla can see the driver name, rating and vehicle plate but not the driver's national ID

Scenario Outline: Ineligible drivers are refused
  When the owner assigns a driver who is <condition>
  Then the response is 422 with a typed business rule error
  And the booking status is unchanged
  Examples:
    | condition                                  |
    | not approved                               |
    | holding an expired licence                 |
    | employed by a different owner              |
    | already assigned to an overlapping trip    |

Scenario: A vehicle with an expired mandatory document cannot be dispatched
  Given the vehicle's insurance document has expired since the bid was accepted
  When the owner attempts to mark the booking READY
  Then the response is 422 with a typed business rule error naming the expired document
```

### 9.8 Scenario 7 — Trip execution and tracking

```gherkin
Scenario: Passenger trip runs to completion
  Given a booking in READY and a trip in DRIVER_ASSIGNED
  When Omar sets the trip to DRIVER_EN_ROUTE, then ARRIVED_AT_PICKUP, then TRIP_STARTED
  Then the booking status becomes IN_PROGRESS at trip start
  And the trip records actual_start_at and start_odometer_km
  And each transition writes trip_status_history including the latitude and longitude at which it occurred
  And a tracking session is opened with status ACTIVE

Scenario: An illegal transition is refused
  When Omar attempts to move the trip directly from DRIVER_ASSIGNED to COMPLETED
  Then the response is 422 with error code TRIP_INVALID_TRANSITION

Scenario: A passenger trip has no loading states
  When Omar attempts to set a PASSENGER trip to LOADING
  Then the response is 422 with error code TRIP_INVALID_TRANSITION

Scenario: A goods trip cannot skip loading
  Given a GOODS trip at ARRIVED_AT_PICKUP
  When the driver attempts to move directly to IN_TRANSIT
  Then the response is 422 with error code TRIP_INVALID_TRANSITION
  And the transition succeeds only via LOADING then LOADED

Scenario: The customer tracks the vehicle live
  Given the trip is IN_PROGRESS and pings arrive every 10 seconds
  Then current_vehicle_locations holds exactly one row for the Hiace, updated on every ping
  And vehicle_location_points receives a row only when 30 seconds elapsed,
      or 50 metres were travelled, or heading changed by more than 30 degrees
  And Layla receives position updates over the websocket within 3 seconds of each ping
  And Layla sees vehicle position, driver, trip status, last-updated time and ETA

Scenario: Tracking is authorized server-side
  When a customer with no active booking on the Hiace requests its location
  Then the response is 404, not 403
  And no position data is returned in any form
```

### 9.9 Scenario 8 — Completion and financial settlement

```gherkin
Scenario: Trip completion closes the booking and finalises finance
  Given the trip is at ARRIVED_AT_DESTINATION
  When Omar completes the trip with an end odometer reading
  Then the trip status is COMPLETED with actual_end_at and actual_distance_km recorded
  And the tracking session status is ENDED with a point count and total distance
  And the booking status is COMPLETED with completed_at set
  And the vehicle operational status returns to IDLE
  And the booking_financial_snapshot is unchanged from the values frozen at acceptance
  And ledger entries settle the customer receivable and credit OWNER_PAYABLE with "1026.37"
  And PLATFORM_COMMISSION_REVENUE is credited "157.50" and VAT_PAYABLE credited "23.63"
  And a sequential gapless tax invoice is issued to Layla for "1207.50"
  And a TRIP_COMPLETED notification is queued for Layla and the owner

Scenario: Historical financials survive a commission change
  Given the global commission rule is changed to 20 percent after completion
  Then the booking's snapshot still shows commission_rate "0.1500" and commission_amount "157.50"
  And the owner earnings report for that booking is unchanged
  And the next booking created uses 20 percent

Scenario: The owner is settled exactly once
  When the settlement job runs for the period containing this booking
  Then a settlement line of type BOOKING_EARNING exists for the booking with "1026.37"
  And running the job again creates no second line
  And a direct attempt to settle the booking again returns 409 SETTLEMENT_BOOKING_ALREADY_SETTLED

Scenario: The customer rates the completed trip
  When Layla submits ratings for the driver, the vehicle and the owner
  Then each rating is stored with status PUBLISHED
  And a second rating for the same subject on the same booking returns 409
  And a rating attempt from a user not party to the booking returns 404, not 403
  And the driver, vehicle and owner rating aggregates are recomputed by the job
```

### 9.10 Scenario 9 — Partial fulfilment across dispatch waves

Confirmed 2026-09-14 (**A-45**). Not part of BRIEF-§38's named golden path, but it is now normal trading rather than an edge case, and it is the only place where an order and a booking stop being the same thing.

```gherkin
Background:
  Given a corporate customer "Najd Foods" with an ACTIVE account
  And four APPROVED goods vehicles exist across three owners in Riyadh
```

```gherkin
Scenario: An order for five vehicles is accepted when only two can be filled
  Given Najd Foods publishes a GOODS trip request
    | vehicles_required        | 5     |
    | allow_partial_fulfilment | true  |   # default for GOODS — A-45
  And five bids are invited but only two are submitted before the wave deadline
  When Najd Foods accepts both bids
  Then two bookings exist, each with its own booking number and its own schedule
  And each booking has fulfilment_sequence 1
  And the trip request status is PARTIALLY_AWARDED with vehicles_awarded 2 of 5
  And the trip request is still returned by the owner Opportunities listing
  And no bid on this request has been auto-rejected
  And the expiry job runs and leaves the request PARTIALLY_AWARDED
  And the request is not EXPIRED, CLOSED_PARTIAL or CANCELLED

Scenario: The remainder keeps attracting bids after the original pickup time
  Given the request is PARTIALLY_AWARDED and pickup_at has passed
  And remainder_closes_at is NULL                                  # A-45, pending OQ-22
  When an owner submits a bid for one vehicle on the remainder
  Then the response is 201 and the bid status is SUBMITTED
  And no error about the bidding window is raised
```

```gherkin
Scenario: A later wave fills the balance and the order becomes FULLY_AWARDED
  Given the request is PARTIALLY_AWARDED with vehicles_awarded 2 of 5
  And three further bids are SUBMITTED and unexpired
  When Najd Foods accepts all three                                 # consent model pending OQ-23
  Then three more bookings exist, each with fulfilment_sequence 2
  And each new booking's scheduled_start_at comes from its accepted bid,
      not from the request's original pickup_at
  And the trip request status is FULLY_AWARDED with vehicles_awarded 5 of 5
  And every remaining SUBMITTED bid on the request is now REJECTED
  And the request no longer appears in the owner Opportunities listing
  And the order total equals the sum of its five bookings, which the second
      wave may have priced differently from the first
```

```gherkin
Scenario: Cancelling one awarded booking reopens the remainder
  Given the trip request is FULLY_AWARDED with five bookings
  When one owner cancels their booking with reason OWNER_UNAVAILABLE
  Then that booking status is CANCELLED
  And the trip request status returns to PARTIALLY_AWARDED with vehicles_awarded 4 of 5
  And vehicles_cancelled is 1 and is never decremented thereafter
  And the request reappears in the owner Opportunities listing with no manual re-publish
  And the four surviving bookings are unaffected in status, schedule and finance

Scenario: Only the customer closes an unfilled balance
  Given the request is PARTIALLY_AWARDED with vehicles_awarded 4 of 5
  When the expiry job runs
  Then the request is still PARTIALLY_AWARDED
  When Najd Foods closes the remainder
  Then the request status is CLOSED_PARTIAL
  And the four awarded bookings continue to completion
  And an admin closing the remainder instead writes an audit entry naming the admin
```

```gherkin
Scenario: A single-bid award is refused on an all-or-nothing request
  Given a PASSENGER trip request for a 5-bus staff shuttle
    | vehicles_required        | 5     |
    | allow_partial_fulfilment | false |   # default for PASSENGER — A-45
  And only two bids are SUBMITTED
  When the customer attempts to accept one bid
  Then the response is 422 with error code RULE_PARTIAL_AWARD_NOT_ALLOWED
  And no booking is created and no vehicle is reserved
  And the accepted bid remains SUBMITTED
  And the trip request status is still PUBLISHED

Scenario: The all-or-nothing request is awarded as one atomic group
  Given five bids are SUBMITTED and unexpired on that request
  When the customer accepts all five as a group with one idempotency key
  Then five bookings are created inside a single transaction
  And the trip request status is FULLY_AWARDED
  When the group award is retried with one vehicle made unavailable
  Then the response is 409 BID_VEHICLE_UNAVAILABLE
  And no booking from that group exists
  And the request status is unchanged
```

### 9.11 Scenario 10 — Corporate invoiced booking and credit control

Confirmed 2026-09-14 (**A-46**). This is the path where a booking confirms with no money having moved, so it is asserted explicitly rather than left to the prepaid scenarios.

```gherkin
Background:
  Given a corporate customer "Najd Foods" with credit_status APPROVED
  And a credit_limit_amount of "50000.00" SAR and credit_terms_days 30   # A-46, pending OQ-19
  And an individual customer "Layla" with no credit facility
```

```gherkin
Scenario: An INVOICED corporate booking confirms without payment
  Given a SUBMITTED bid to Najd Foods with total_amount "1207.50"
  When Najd Foods accepts the bid
  Then the booking billing_mode is INVOICED, snapshotted at award
  And the booking status is CONFIRMED, not PENDING_PAYMENT
  And payment_due_by is NULL and payment_status is UNPAID
  And a vehicle_calendar_entry of type RESERVATION exists with status CONFIRMED
  And no payment row exists for the booking
  And the booking_financial_snapshot is written exactly as for a prepaid booking
  When the unpaid-booking expiry job runs
  Then the booking is still CONFIRMED and the reservation is not released

Scenario: An individual customer is unaffected
  When Layla accepts a bid
  Then the booking billing_mode is PREPAID and the status is PENDING_PAYMENT
  And payment_due_by is set from system_settings.booking.payment_window_minutes

Scenario: An award is refused when it would exceed the credit limit
  Given Najd Foods has "49500.00" outstanding on CUSTOMER_RECEIVABLE
  When Najd Foods accepts a bid with total_amount "1207.50"
  Then the response is 422 with error code RULE_CREDIT_LIMIT_EXCEEDED
  And no booking, reservation, financial snapshot or ledger entry is created
  And the bid remains SUBMITTED
  And the outstanding figure was read from the ledger, not from a cached column

Scenario: Two concurrent awards cannot both fit under one limit
  Given remaining credit headroom of "1500.00"
  And two SUBMITTED bids of "1207.50" each
  When both are accepted simultaneously
  Then exactly one returns 200 and creates a booking
  And the other returns 422 RULE_CREDIT_LIMIT_EXCEEDED
  Because the corporate profile row is locked FOR UPDATE inside the award transaction

Scenario: An unapproved or suspended facility blocks the invoiced path
  Given credit_status is PENDING_APPROVAL
  When the customer accepts a bid
  Then the response is 422 with error code RULE_CREDIT_NOT_APPROVED
```

```gherkin
Scenario: The billing cycle produces one consolidated invoice
  Given Najd Foods has eleven COMPLETED INVOICED bookings in the billing period
  And billing_cycle is MONTHLY                                      # A-46, pending OQ-19
  When the invoicing job runs at period end
  Then exactly one invoice is issued to Najd Foods for that period
  And it carries eleven invoice_lines of line_type BOOKING
  And the header subtotal, vat_amount and total_amount equal the sum of the lines
  And the invoice number is sequential and gapless against all prior invoices
  And billing_period_start, billing_period_end and due_date are set
  And clearance_status is NOT_REQUIRED under the mock provider, with no compliance claimed

Scenario: A booking can never reach two live invoices
  When a second invoice is generated that would include an already-invoiced booking
  Then the insert violates uq_invoice_lines_booking and the invoice is not issued
  And voiding the first invoice releases that booking for reinvoicing

Scenario: One payment settles an invoice covering many bookings
  When Najd Foods pays the invoice in full
  Then the payment row carries invoice_id and a NULL booking_id
  And a payment carrying both an invoice_id and a booking_id is rejected by
      ck_payments_single_target
  And the invoice status becomes PAID with outstanding_amount "0.00"
  And every booking on the invoice has payment_status PAID
  And the owner settlement for those bookings is unaffected by when this payment
      arrived, because settlement does not inspect customer payment status   # OQ-20
```

### 9.12 Cross-cutting acceptance conditions

These apply to every scenario above and are asserted by shared test helpers rather than repeated.

| # | Condition |
|---|---|
| G1 | Every response conforms to the standard envelope; errors always carry a machine-readable code and a request id |
| G2 | Every monetary value is transported as a string with a sibling currency field, never as a JSON number |
| G3 | No response exposes a password hash, token, encrypted value, provider secret, or a counterparty's national ID, Iqama, licence number or IBAN |
| G4 | Every state-changing action in the path writes an audit entry with actor, before and after values, and redacted sensitive fields |
| G5 | The entire path is exercised in both `en` and `ar` locales, with the Arabic run asserting correct direction and no untranslated string |
| G6 | Every notification emitted in the path resolves from a template in the recipient's locale; no message text appears in service code |
| G7 | Every list endpoint touched returns paginated results with the standard meta block and refuses a page size above 100 |
| G8 | Authorization is asserted negatively at every step: a driver cannot read owner earnings, an owner cannot read another owner's bids, a customer cannot read another customer's bookings, and each such attempt returns 404 |

---

## 10. Risk register — requirements and scope

Requirements, scope and commercial risk only. Technical risks are held in [architecture.md](architecture.md) and security risks in [security.md](security.md). Likelihood and impact are High / Medium / Low.

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R-01 | ~~Mobile applications are a contractual deliverable (RFP §5.2) that the phase plan does not deliver~~ **Resolved 2026-09-15 — UniGate confirmed web first, mobile in a later phase (OQ-14).** Residual: the SOW must say so, since RFP §5.2 is unchanged | Low | Medium | Obtain written confirmation of scope, schedule and pricing before Phase 2 closes — OQ-14. Build the API as an independent product with Bearer auth, device tokens and published OpenAPI so deferral costs no rework. Record the divergence in the status report every cycle until answered | Project sponsor |
| R-02 | **SPO scope is built on a single parenthetical.** A full portal, attribution chain, commission engine and report set are specified by the brief against one RFP mention with no rules | Medium | High | Keep the commission model as open `jsonb` and write `spo_commission_amount` as zero; build attribution and portal only to the brief's stated capability list; do not build payout. Force a scoping conversation at Phase 4 — OQ-09. Treat any expansion as a change request | Commercial lead |
| R-03 | **Settlement terms arrive after bookings are live.** ~~Commission rate~~ — resolved 2026-09-15: commission is admin-configured and per-trip overridable, so there is no placeholder rate to be stuck with; the residual risk is an admin *forgetting* to configure it (production seeds `NONE`, i.e. zero revenue until someone acts — surfaced as a setup-checklist item). Snapshots remain immutable, so settlement terms (OQ-06) still cannot be corrected by configuration | Medium | Medium | Escalate OQ-01 and OQ-06 as pre-Phase-9 blockers. Seed the interim rule explicitly and visibly. Document that a late answer requires a data migration plus restated settlements, and price that as a change | Finance lead |
| R-04 | **No non-functional requirement exists, so there is no objective definition of done.** Phase 15 cannot pass or fail on performance, and any support term signed under RFP §6 is open-ended | High | Medium | §5 proposes a complete target set, every entry labelled `PROPOSED`. Require written confirmation via OQ-15 before Phase 14. Do not sign an availability or response commitment until confirmed | Project sponsor |
| R-05 | **Payment gateway selection has external lead time — and UniGate has deferred the choice to the payment phase (OQ-03, 2026-09-15).** Merchant onboarding and sandbox access typically take weeks and sit on the Phase 9 critical path; deferring the decision to the start of Phase 9 converts that lead time into schedule slip | High | High | Start gateway selection and merchant onboarding now, in parallel with Phases 2–8 — OQ-03. `MockGateway` allows all of Phases 8–11 to be built and tested without it; only certification is blocked | Finance lead |
| R-06 | **ZATCA applicability is unresolved and requires tax advice.** If Phase 2 clearance applies, invoices already issued to customers would need crediting and reissue | Medium | High | Engage UniGate's tax advisor now — OQ-04. Reserve the e-invoicing fields and keep invoice numbering sequential and gapless so a clearance integration is additive. Claim no compliance in any artefact | Tax advisor |
| R-07 | **Cancellation and no-show policy is an admin control (OQ-05 answered 2026-09-15) and production starts with no charges.** Free cancellation is commercially generous and hard to withdraw once customers have experienced it — the risk moved from "undefined" to "unconfigured at go-live" | Medium | Medium | Snapshot the applied rule per cancellation so real tiers apply cleanly from the day they are set — OQ-05. Flag to the client that the interim policy is live behaviour, not a placeholder, and sets expectations | Commercial lead |
| R-08 | **Requirement drift from the brief's per-role capability lists.** Bullet-point capabilities ("view earnings", "manage bookings") expand materially during implementation | High | Medium | This catalogue is the baseline. Anything absent from it is a change request assessed against phase and cost. Review the FR set at each phase gate rather than at the end | Business analyst |
| R-09 | **Partial fulfilment leaves orders open indefinitely.** OQ-16 is answered (A-45) and the behaviour is now deliberate, but an order that rests at three of five vehicles forever is an open commitment on both sides and clutters every owner's opportunity list. The residual risk moved from "undecided" to "unbounded" | Medium | Medium | Answer **OQ-22** before Phase 7 closes and set `remainder_closes_at` policy; ship the 7-day customer reminder with the first release. Report fill rate and remainder age from day one (FR-REPORTING-08) so the problem is visible rather than inferred. Answer **OQ-23** in the same conversation — dispatching a later wave without customer acceptance is a contractual exposure, not a UX preference | Operations lead |
| R-10 | **Training and deployment support (RFP §5.6) have no definition of done**, so acceptance cannot be objectively evidenced | Medium | Medium | Define audience, format, duration, language and materials in the commercial schedule before Phase 16. Keep it separate from the engineering estimate; deliver deployment automation and runbooks as the technical artefact | Project sponsor |
| R-11 | **Owner privacy classification is unspecified** (RFP §3.9 is one sentence). Publishing a field the owner considers private is a trust failure that is not recoverable by a later fix | Medium | Medium | Default to closed: nothing is exposed to counterparties unless explicitly classified as business information. Obtain a signed-off field classification during Phase 4 | Business analyst |
| R-12 | **Bilingual content obligations may be broader than bilingual UI.** If owner business names, notes and complaint text must also be bilingual, the data model and every input form change | Low | Medium | Confirm early that bilingual applies to interface chrome and reference data, not to user-entered content. Reference tables already carry `name_en` and `name_ar`; user content does not | Business analyst |
| R-13 | **Two sources of requirements with different authority invites selective citation** in a dispute — each party quoting the document that favours them | Medium | Medium | This document is the single reconciled baseline with explicit authority rules (§2) and 100% RFP traceability (§8). Circulate it for written client sign-off at the close of Phase 0 | Business analyst |
| R-14 | **Legal and tax advice (OQ-04, OQ-12, OQ-13) is outside the delivery team's control and has the longest lead time** of any open question | Medium | Medium | Initiate all three now even though they do not block until Phases 11 and 16. Track them as external dependencies with named owners, not as engineering tasks | Project sponsor |
| R-15 | **Interim assumptions harden into product behaviour.** A default that ships becomes the de facto policy and is then expensive to change | High | Low | Every assumption is configuration or a snapshot, never a constant. Maintain [assumptions.md](assumptions.md) as a live register and review it at every phase gate rather than at the end | Business analyst |
| R-16 | **UniGate finances the gap between paying owners weekly and collecting from corporates in arrears.** Two separately reasonable answers — A-39 (weekly settlement) and A-46 (net-30 invoicing) — combine into a rolling working-capital commitment nobody has explicitly agreed to, plus the full bad-debt loss if a corporate fails. It grows with corporate share of volume, so it is smallest exactly when it is easiest to ignore | High | High | **OQ-20**, and it is a treasury decision, not an engineering one. Force it before settlement is built in Phase 11: either UniGate carries the receivable knowingly and sizes the float, or settlement waits on collection and owners are told so before they onboard. Meanwhile enforce the credit limit inside the award transaction (FR-BIDDING-14) and report receivables ageing from the ledger (FR-FINANCE-19) so the exposure is measured rather than assumed | Finance lead / project sponsor |
| R-17 | **Consolidated tax invoices to VAT-registered corporates raise the ZATCA stakes.** A corporate buyer expects an invoice they can reclaim VAT against, which is precisely the case where Saudi e-invoicing obligations are most likely to apply. **Requires tax review; no compliance is claimed** | Medium | High | OQ-04 moves from important to urgent now that A-46 is confirmed. Keep `zatca_*` reserved and unpopulated, keep numbering sequential and gapless across both invoice shapes, and do not represent any invoice as cleared. Engage the tax advisor before the first corporate invoice is issued, not before Phase 11 closes | Tax advisor |

---

**End of Phase 0 deliverable.** Sign-off on this document — in particular §3, §6 and §8.2 — is the precondition for treating the Phase 1 architecture set as a stable baseline.
