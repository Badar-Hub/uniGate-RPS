# ADR-007 — E-invoicing designed into the issue path, behind a provider abstraction

**Status:** Accepted
**Date:** 2026-09-14

> **No compliance is claimed.** This record describes how the system is *shaped* so that compliance is achievable. Whether the regime applies to UniGate, and from when, is a determination for UniGate's tax advisor (**OQ-04**).

## Context

UniGate confirmed on 2026-09-14 that it is the invoice issuer and will provide VAT-reclaim invoices to customers (**A-49**). That makes generating tax invoices a routine operation of the platform rather than an edge case.

Our understanding of the Saudi e-invoicing regime is that this is precisely the activity it governs, and that it splits into two flows with very different timing:

- **Standard tax invoices (B2B)** must be **cleared** by the authority *before* they are given to the buyer.
- **Simplified tax invoices (B2C)** are issued immediately and **reported** afterwards, within a short window.

The original design reserved `zatca_*` columns and deferred everything else. After the A-49 answer that is no longer sufficient, because clearance is not a downstream step — for B2B it sits *inside* the issue path.

## Decision

1. **Model the full clearance/reporting flow now**, including invoice hashing and chaining, cryptographic stamping, QR payload, UBL XML artefacts and clearance state. Field-level design in [database.md §12.7](../database.md).
2. **Put it behind an `EInvoicingProvider` interface** — `buildXml`, `stamp`, `clear`, `report`, `status` — with a `MockClearanceProvider` for development that implements rejection and timeout paths.
3. **Do not write a production adapter** until applicability and the provider are confirmed.
4. **Make a standard invoice undeliverable until cleared.** `GET /invoices/{id}/pdf-url` returns `409 INVOICE_NOT_CLEARED` while clearance is pending; the customer's document is rendered from the **authority-returned** artefact, not our own copy.
5. **Invoices become immutable past `DRAFT`.** Corrections are credit or debit notes referencing the original.

## Rationale

### Why not stay with reserved columns

Because the shape of the flow, not just its fields, is what changes. A natural implementation — generate PDF, email it, submit to the authority on a nightly job — is *structurally* wrong for B2B: the buyer already holds a document that was never cleared, and it cannot be retroactively made valid. Discovering that after invoices have been issued means reissuing real customer documents and explaining why the originals were not what they appeared to be.

Designing the gate now costs a state and a blocking call. Retrofitting it costs an incident.

### Why "on request" was rejected

UniGate's initial framing was that VAT-reclaim invoices would be produced **on customer request**. That cannot work: a tax invoice minted months after the supply was never cleared at the time, and the buyer's entitlement to reclaim input VAT depends on holding a valid invoice issued then. The system therefore decides invoice type **at issue time** from the buyer's VAT registration, and "on request" is served by re-delivering an invoice that already exists. UniGate accepted this reasoning on 2026-09-14.

### Why the chain matters more than it looks

`icv` (a strictly sequential counter) and `previous_invoice_hash` link each invoice to its predecessor. The practical consequence is that **an invoice cannot silently disappear**: a failed invoice must remain as `CLEARANCE_FAILED` rather than be deleted and the number reused, because deleting it breaks the chain in a way that is externally detectable. This rules out the ordinary "clean up the bad row" instinct and has to be understood by whoever maintains the billing code.

### Arabic is a compliance surface

Our understanding is that Arabic is mandatory on the tax invoice, with bilingual permitted. The Arabic rendering path therefore stops being a localisation nicety and becomes something that must be correct before the first invoice is issued — which is a different quality bar, and a different review, from the rest of the UI.

## Consequences

**Positive:** compliance is achievable without rework; the blocking-clearance flow and its failure paths are exercised in tests from day one; the correction model (credit/debit notes) is right from the start rather than retrofitted over edited invoices.

**Negative:**
- **A third party becomes a revenue dependency.** If clearance is unavailable, B2B invoices cannot be issued. Mitigated by queueing in `PENDING_CLEARANCE` with retry and alerting rather than failing the billing run — but the underlying exposure is real and is recorded as risk **AR-9**.
- Invoice immutability removes ordinary remediation options; errors are corrected forward, never edited.
- Additional integration surface, and onboarding credentials to manage as secrets.
- The design may prove stricter than UniGate's actual obligation. That asymmetry is deliberate: being over-prepared costs engineering time, being under-prepared costs reissued customer documents.

## Addendum, 2026-09-14 — wave, deadline and VAT treatment

UniGate confirmed VAT-taxable revenue above SAR 510,000, placing it in Phase 2, and asked that the VAT-treatment question be checked against the rules. Public sources were reviewed. **This is research, not tax advice, and no compliance is claimed.**

### The integration deadline may already have passed

| Wave | Criteria | Integration deadline |
|---|---|---|
| **24** | VAT-taxable revenue above **SAR 375,000** in 2022, 2023 **or** 2024 | **30 June 2026 — past** |
| **25** | VAT-taxable revenue above **SAR 187,500** in 2022, 2023, 2024 **or** 2025 | **1 February 2027** |

At SAR 510,000 UniGate exceeds both thresholds, so the wave depends entirely on **which year** the revenue arose. ZATCA notifies affected taxpayers directly with at least six months' notice, so UniGate should hold a letter naming its binding date — **that letter, not this analysis, is authoritative.** Recorded as risk **AR-11**; it is a live regulatory exposure independent of this project, and it is the reason this ADR's design work was worth doing before the answer arrived rather than after.

### VAT treatment varies per owner

Article 47 governs electronic marketplaces, and an expansion under Article 47(3) effective **1 January 2026** makes a platform the **deemed supplier** where it facilitates supplies by **resident suppliers who are not VAT-registered** — treated as buying and resupplying in its own name, with the invoice showing the platform as supplier.

The carve-outs do not fit UniGate. A platform escapes deemed-supplier status only where its role is limited to payment processing, or listing without setting terms or demanding payment, and where it does not control pricing, contractual terms, customer interaction, complaints handling or discounts. UniGate does all of these, and the guidance treats **degree of control as decisive**.

**This overturns the prior assumption.** A-31 assumed UniGate was uniformly the principal. The position is instead **per owner**: `DEEMED_SUPPLIER` for unregistered owners, `OWNER_IS_SUPPLIER` for registered ones, resolved at confirmation and snapshotted so later registration never rewrites history. Design in [database.md §12.8](../database.md).

It also **dissolves the concern raised as AR-10**. The fear was stranded input VAT on supplies from owners below the registration threshold. Under the deemed-supplier mechanism those owners make no taxable supply at all, so there is nothing to strand — the rule exists precisely for this situation. The genuine exposure is operating two treatments correctly and evidencing each owner's status, which is why owner VAT registration becomes verified document data rather than a self-declared flag.

**Still to confirm with the advisor:** the treatment where the owner *is* VAT-registered, and UniGate's overall position. **OQ-24 remains open** — narrowed from "choose a model" to "confirm this reading".

### Sources

- [ZATCA — Wave 24 criteria](https://zatca.gov.sa/en/Pages/news_1426.aspx)
- [ZATCA — Wave 25 criteria](https://zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx)
- [Grant Thornton — VAT and electronic marketplaces in Saudi Arabia: deemed supplier rules 2026](https://www.grantthornton.sa/en/insights/articles-and-publications/vat_and_electronic_marketplace_in_saudi_arabia/)
- [VATupdate — ZATCA guide: VAT rules for e-market platforms and deemed supplier obligations](https://www.vatupdate.com/2026/01/09/zatcas-2025-guide-vat-rules-for-e-market-platforms-and-deemed-supplier-obligations-in-ksa/)
- [VATupdate — Wave 25 announcement](https://www.vatupdate.com/2026/07/27/zatca-announces-wave-25-of-e-invoicing-threshold-halved-to-sar-187500-integration-deadline-1-february-2027/)
- [ZATCA — VAT Implementing Regulations](https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/VATImplementingRegulations.aspx)

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep reserved columns, decide later | The timing of clearance changes the issue *path*, not just the schema. Late discovery means reissuing real invoices |
| Generate tax invoices on customer request | Cannot be cleared retrospectively; produces documents that look valid and may not be |
| Treat all invoices as simplified | Denies corporate customers the invoice they need to reclaim VAT — the opposite of what UniGate asked for |
| Build a direct integration now | Provider and applicability both unconfirmed; the same reasoning as [ADR-005](ADR-005-payment-abstraction.md) |
| Allow editing an issued invoice | Breaks the hash chain and the audit position; corrections must be forward-only |
