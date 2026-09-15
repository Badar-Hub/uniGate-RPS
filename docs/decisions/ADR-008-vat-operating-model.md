# ADR-008 — Uniform principal treatment, so there is one VAT identity and one certificate

**Status:** **Accepted — confirmed by UniGate as its operating model, 2026-09-15.** Advisor confirmation of the ZATCA characterisation is still recommended (OQ-24), but the decision is no longer ours to propose; it is the business's description of how it trades. See the addendum.
**Date:** 2026-09-14
**Supersedes:** the per-owner treatment recorded in [ADR-007](ADR-007-e-invoicing.md) addendum and [database.md §12.8](../database.md), which remains the fallback

> **No compliance is claimed and this is not tax advice.** Full options analysis, source grading and citations: [research/2026-09-14-vat-and-einvoicing-options.md](../research/2026-09-14-vat-and-einvoicing-options.md).

## Context

[ADR-007](ADR-007-e-invoicing.md) established that VAT treatment varies per owner: `DEEMED_SUPPLIER` for VAT-unregistered owners under Article 47(3), `OWNER_IS_SUPPLIER` for registered ones. That reading still appears correct. What was not understood at the time is what the second branch costs.

A ZATCA cryptographic stamp identifier is bound to exactly one VAT number, and the authority cross-checks the certificate's VAT number against the seller VAT inside the invoice XML. An invoice naming the owner as supplier must be signed with **the owner's** certificate. And the onboarding step that produces that certificate cannot be automated:

> "Is there a way to get an OTP through an API? — There is no API for OTP. You can only get OTPs through the portal."

The owner must personally log into the Fatoora portal, generate a one-hour OTP, and hand it over — at onboarding and at every renewal. So `OWNER_IS_SUPPLIER` is not a schema branch. It is a per-owner PKI onboarding funnel with a mandatory human step, a separate ICV/PIH chain that may never be reset, and a recurring renewal campaign, carried for the life of the platform.

## Decision

1. **Treat UniGate as the principal supplier for every booking**, so every invoice is issued under UniGate's own VAT number from a single EGS unit with a single certificate and a single hash chain.
2. **Basis:** Article 47(3) already compels this for unregistered owners. For registered owners the route is **VAT Law Article 9** — a taxable person supplying in their own name on behalf of another is treated as supplying for themselves — which ZATCA documented for online portals as the undisclosed-agent model, with two supplies and input tax deductible on both sides.
3. **Pair it with an Article 53(2) self-billing approval** so UniGate generates the registered owner's invoice to itself rather than chasing one from every owner every period.
4. **Keep `booking_financial_snapshots.vat_treatment`.** Under this ADR every booking resolves to `DEEMED_SUPPLIER`; the column expresses either outcome and makes the fallback a configuration change rather than a migration.
5. **Do not build per-owner CSID onboarding** unless and until the advisor rejects this position.

## Rationale

**It extends what is already mandatory rather than adding anything.** Unregistered owners are the bulk of any vehicle marketplace, and Art 47(3) makes UniGate their supplier regardless. This applies one treatment to the whole book instead of two treatments to two populations.

**It removes a class of correctness bug, not just work.** Under per-owner treatment the customer-facing tax document depends on resolving each owner's registration status at the exact moment of contract conclusion, re-verified on an ongoing basis, with the platform carrying the VAT where the status is not valid on the date of supply. A stale check produces an incorrect tax invoice already in a customer's hands — and invoices are immutable past `DRAFT` (ADR-007), so the remedy is a correction document, not a fix. Under uniform treatment, status still decides whether UniGate receives a deductible input invoice, but it **no longer changes the customer's document**. The same error becomes a reconciliation issue.

**It matches what the authority actually enforced.** Uber and Careem ran the published agency model in KSA and were assessed VAT on the full fare — on the express reasoning that drivers sit below the registration threshold and collecting from them is impractical. The combined bill was around USD 100m, settled in 2021. Article 47(3) now codifies that position. Building the agency model would mean re-adopting the posture that produced the assessment.

**The one genuine argument against it is not the characterisation risk — it is zero-rating evidence.** Cross-border goods transport is zero-rated under Article 34(1) with no vehicle-type test, and UniGate has a goods vertical. Under principal treatment **UniGate** owns the export and transport evidence for supplies physically performed by owners it does not control. Under agency that burden sits with the owner. This is a real cost of the recommendation and is listed for the advisor rather than argued away.

## Consequences

**Positive:** one certificate, one chain, one invoice template, one onboarding; no owner ever touches the Fatoora portal; e-invoicing becomes an integration rather than a platform; every provider option in the market supports the single-taxpayer case, so vendor choice stays open and the ADR-007 abstraction stays thin.

**Negative:**
- **Gross revenue recognition**, not net — materially different reported revenue, with zakat and income-tax presentation effects **not researched here**.
- **A ZATCA approval sits on the critical path.** No published process or lead time for Art 53(2) was found. This is a schedule risk and the application should start early, not at Phase 11.
- **Characterisation risk.** Whether ZATCA accepts undisclosed agency when the app displays driver name and vehicle plate — required for safety and TGA reasons — is a fact-pattern judgement.
- **UniGate carries zero-rating evidence** for cross-border goods work it does not physically perform.
- **No input credit on the owner leg.** The unregistered owner's supply is outside scope, so UniGate is liable for 15% of gross with credit only against its own costs. This is true under Art 47(3) regardless of this ADR, but uniform treatment applies it to the whole book.

## Addendum, 2026-09-15 — UniGate's own description of the model

Asked about OQ-24, UniGate described the business in one paragraph, paraphrased:

> A company contacts us to move air-conditioners from Riyadh to Jeddah and needs 40 vehicles. We have 10 of our own; we find an outsourcing company and hire 30 more. **Since we are providing the service, we issue the VAT invoice to the client for all 40.** The company we took 30 vehicles from issues *us* a VAT invoice, which UniGate reclaims. We do not even need to say how many vehicles on the client's invoice — just that they took this service from us for X, and the VAT is Y.

That is the principal model, stated as fact rather than proposed as treatment. Four consequences:

1. **The client contracts UniGate; UniGate sources capacity.** The vehicle owner is UniGate's *subcontractor*, not the client's supplier. This is the classic principal/subcontractor structure, and it is far more robust under VAT than the marketplace-agency framing the earlier analysis had to defend against. The characterisation risk in the Consequences section above is correspondingly lower; the adviser's question narrows to confirming that the *platform* mechanics (owners bidding, drivers visible to the client) do not disturb it.
2. **Registered subcontractors invoice UniGate; UniGate reclaims.** Exactly the input-side leg this ADR describes — by the supplier's own e-invoice, or by Art 53(2) self-billing where approved (OQ-25/OQ-30). **Unregistered subcontractors cannot issue one**, so their 15 % is a cost UniGate absorbs (Art 47(3) deemed-supplier or not, the outcome is the same).
3. **UniGate has its own fleet.** Ten of the forty are UniGate's vehicles. The platform must model UniGate as an owner of its own vehicles — no commission, no self-billing, no settlement; the trip is internal cost (A-57).
4. **The client's tax invoice is for the *service*, not per vehicle.** One line, "transport service Riyadh → Jeddah, X, VAT Y", satisfies Art 53(5)(f) ("scope and nature of the services rendered"). Per-vehicle detail is an operational statement, not tax-invoice content (A-58, FR-FINANCE-24).

## Addendum 2, 2026-09-15 — one model, and why the marketplace does not change who sells

UniGate then distinguished two ways of trading: a **managed service** (own fleet plus subcontractors) and a **marketplace** (registered companies bid on customer requests; the customer accepts one). The question was whether, in the marketplace case, the winning company should invoice the *customer* directly. UniGate's own objection decided it: a company that invoices the customer directly has everything it needs to deal with that customer next time without UniGate.

**Decision: one model.** UniGate is the seller on every customer invoice, in both ways of trading. The marketplace changes only *how UniGate finds the vehicles*, never *who sells the service*. Every supplier other than UniGate's own fleet invoices **UniGate** (or is self-billed by it under Art 53(2)), and UniGate reclaims. Consequences:

- **Anti-disintermediation is structural, not contractual.** The customer pays UniGate, holds UniGate's invoice, and the company is paid *by* UniGate. Bypassing the platform means giving up the customer, the payment and the settlement, not a commission.
- **The supplier's invoice obligation is enforced by the payout, not by threats.** A registered supplier's settlement line for a booking is **held until a valid tax invoice to UniGate is on file** for it — or until the self-billed invoice UniGate generated is accepted. No invoice, no money; nobody chases, nobody sues. Blacklisting remains available for the *unregistered* case and for repeated breaches (FR-FINANCE-25).
- **One certificate, one VAT model, one invoice per order** for the customer, however many companies supplied vehicles.
- **The `OWNER_IS_SUPPLIER` branch is now unreachable by business rule.** It stays in the schema as the fallback if ZATCA rejects the characterisation (the narrow OQ-24 point), but no flow produces it.
- **Contact masking until award, platform-only payment, and a non-circumvention clause on both sides** are retained as the second line of defence (security.md §9.3, FR-BIDDING-15).

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Per-owner dual treatment (ADR-007 as written) | Legally the most conservative, but buys permanent structural complexity: a per-owner PKI funnel with a mandatory manual step and a recurring renewal campaign. **Retained as the fallback if the advisor rejects this ADR** |
| Disclosed agency for all owners | Fails the Article 47(3) escape test for unregistered owners — an all-conditions factual test UniGate misses on pricing, payment collection and complaints handling. Not available |
| Require every owner to be VAT-registered | Owners below SAR 187,500 of supplies *or expenses* cannot register at all. A supply-side filter, not a VAT solution. Useful as an owner tier |
| Decide later, keep both paths warm | The two paths differ by an e-invoicing onboarding platform, not by a code branch. Deferring means either building that platform speculatively or blocking Phase 11 on an answer that could be sought now |
