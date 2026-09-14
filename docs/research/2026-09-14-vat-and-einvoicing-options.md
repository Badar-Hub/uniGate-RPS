# VAT and e-invoicing — options analysis and recommendation

**Date:** 2026-09-14
**Status:** Research complete. Recommendation made. **Advisor confirmation required before build.**

> **This is research, not tax or legal advice, and no compliance is claimed anywhere in this document.** It exists to shape the architecture correctly and to narrow what UniGate must ask its tax advisor and Saudi counsel. Every load-bearing claim is graded **PRIMARY** (retrieved from zatca.gov.sa or an official gazette), **SECONDARY** (Big-4 or established advisory commentary) or **UNCONFIRMED**.

---

## 1. The finding that reframes everything

The VAT question and the e-invoicing question looked independent. They are not.

The design recorded in [database.md §12.8](../database.md) resolves VAT treatment **per owner** — `DEEMED_SUPPLIER` for unregistered owners, `OWNER_IS_SUPPLIER` for registered ones. As a database branch that is cheap. As infrastructure it is not, because of one constraint:

> **A ZATCA cryptographic stamp identifier (CSID) is bound to exactly one VAT number, and ZATCA cross-checks the certificate's VAT number against the seller VAT inside the invoice XML.** *(PRIMARY — Electronic Invoice Security Features Implementation Standards v1.2, Req. 4; corroborated by a ZATCA moderator on ZATCA's own developer forum describing the exact rejection.)*

So an invoice that names the **owner** as supplier must be signed with the **owner's** certificate. Which means, for every VAT-registered owner on the platform:

- a separate EGS unit, keypair, CSR, compliance CSID and production CSID;
- a separate, strictly sequential ICV counter and PIH hash chain that may never be reset or shared;
- and an onboarding step that **UniGate cannot automate**, because:

> **"Is there a way to get an OTP through an API? — There is no API for OTP. You can only get OTPs through the portal."** *(PRIMARY — ZATCA Technical Guidelines FAQ, verbatim. Independently restated on ZATCA's Fatoora developer forum.)*

The owner must personally log into the Fatoora portal with their ERAD credentials, generate a one-time password valid for **one hour**, and hand it to UniGate inside that window — at onboarding, and again at every certificate renewal. No vendor removes this; ZATCA provides no delegation mechanism for it.

**Per-owner VAT treatment is therefore not a schema branch. It is a multi-tenant PKI platform with a human in the loop, per owner, forever.** That cost was not visible when §12.8 was written, and it is the single most important input to the decision below.

---

## 2. Corrections to prior work

Research contradicted five things already written into the docs. Recording them plainly.

| # | What was written | What research indicates | Grade |
|---|---|---|---|
| C-1 | §12.8(4): "Commission charged to an owner is itself VATable" | **Wrong for the deemed-supplier branch.** Where the platform is deemed supplier, the commission is the margin between the deemed purchase and the resale, already taxed inside the customer price; it is **not** a separately VATable supply. It *is* separately VATable in the owner-is-supplier branch. The claim is true for one branch and false for the other | SECONDARY (KPMG, Dhruva, A&M concurring; Grant Thornton appears to conflict, reconcilable as describing the non-deemed case). **Verify verbatim before building the billing engine** |
| C-2 | Implied that the owner's leg is a supply *to* UniGate | The owner leg is **outside the scope of VAT entirely** — "the resident supplier is not required to issue a tax invoice or collect VAT on its supplies". UniGate gets **no input credit on the owner leg**, only on its own costs | **PRIMARY** — ZATCA amendments guideline §2.10.3 |
| C-3 | AR-11 framed the possibly-missed Wave 24 deadline as acute exposure | Real, but **warning-first**. The published violation ladder is: 1st occurrence = **notice, no fine**, with **up to three months** to correct; then 1,000 / 5,000 / 10,000 / 40,000 SAR, resetting after 12 months. There is **no separately-named penalty for missing a wave deadline** at all | **PRIMARY** — ZATCA "Decision to Reclassify the VAT Field Violations" |
| C-4 | Nothing written — gap | The fines-exemption initiative running to **31 Dec 2026** appears to have **dropped e-invoicing/field-control coverage** that the round ending 30 Jun 2026 explicitly included | PRIMARY-by-absence, **high confidence but partly an argument from absence.** Confirm with ZATCA (19993) |
| C-5 | ADR-007 treats provider selection as a later choice | **ZATCA does not certify or approve solution providers.** Its directory carries an explicit disclaimer: *"This list is not considered as an approval by ZATCA of the e-solutions provided."* Vendor claims of "ZATCA approved" carry **zero** signal, and **regulatory liability stays with the taxpayer regardless of vendor** | **PRIMARY** — ZATCA Solution Providers Directory, EN and AR |

---

## 3. Decision 1 — VAT operating model

Five options. Two are not available to UniGate on its own facts.

### The gate everything passes through

Article 47(3), effective **1 January 2026**, deems the platform the supplier where it facilitates supplies by **resident suppliers who are not VAT-registered**. The escape requires **all three** of the following, and UniGate fails on multiple counts by design:

> - the non-registered supplier is identified as the actual supplier **in both the contracts and the tax invoice**;
> - there is a **direct and independent contractual relationship** between supplier and final customer, with the supplier setting all terms;
> - the marketplace **does not set terms and conditions, determine pricing, charge customers, collect payments, handle complaints, offer promotions, or provide compensation**.
>
> *(PRIMARY — ZATCA, Guideline for Amendments to the Implementing Regulation of VAT, April 2025, §2.10.3, verbatim.)*

It is an all-conditions factual test. **There is no elective opt-out**, despite vendor blogs describing "contractual opt-out clauses" — that claim has no basis in the ZATCA text.

**Transitional rule:** applies where the customer contract is **concluded on or after 1 January 2026**. *(SECONDARY — Dhruva, reporting ZATCA's 25 Dec 2025 guideline. The guideline PDF is no longer retrievable at the cited URL.)* Today is September 2026 — **this is live law, not future planning.**

### The options

| | **M1 — Per-owner dual** *(current design)* | **M2 — Principal for all** | **M3 — Self-billing** | **M4 — Require all owners VAT-registered** | **M5 — Disclosed agency** |
|---|---|---|---|---|---|
| **Basis** | Art 47(3) + general rules | **VAT Law Art 9** / undisclosed agency | Art 53(2) or 53(3) | Voluntary registration | Art 47(3) escape + Art 53(3) |
| **Works for unregistered owners?** | Yes (forced) | Yes | n/a — leg out of scope | Excludes them | ❌ **No** |
| **Customer receives** | Platform invoice *or* owner invoice | **Always platform invoice** | Owner invoice, platform-generated | Owner invoice | Owner invoice |
| **CSIDs required** | **1 + one per registered owner** | **1** | 1 + self-bill leg | one per owner | one per owner |
| **Per-owner Fatoora OTP dance** | ❌ Yes, for registered owners | ✅ **No** | ❌ Yes | ❌ Yes | ❌ Yes |
| **Commission VAT** | None (deemed) / 15% (registered) — **two paths** | None — becomes margin | n/a | 15% to owner | 15% to owner |
| **Invoicing pipelines** | **2** | **1** | 1 + a B2B leg | 1 | 1 |
| **ZATCA approval needed** | No | Only if paired with M3 | **Yes** | No | Yes, if platform issues |
| **Revenue recognition** | Mixed gross/net | **Gross** | n/a | Net | Net |
| **Main risk** | Status resolution at booking time; permanent dual infrastructure | Undisclosed-agency characterisation | Approval lead time | Loses owners below SAR 187,500 | **Fails Art 47(3)** |

**M5 is not available** for unregistered owners on UniGate's facts. Do not design for it.

**M4 is a supply-side filter, not a VAT solution.** Voluntary registration needs SAR 187,500 of *supplies **or expenses*** — and the "or expenses" limb is wider than it looks, since fuel, maintenance, insurance and driver wages count. But an owner below both figures **cannot register at all**, so a blanket gate permanently excludes the smallest owners. Useful as an owner *tier*, not as a gate.

### ⭐ Recommendation: M2 (uniform principal), enabled by M3 (self-billing) for registered owners

**Why.**

1. **It is already forced for the majority.** Unregistered owners are the bulk of any vehicle marketplace, and for them Art 47(3) makes UniGate the supplier whether or not it wants to be. M2 does not *add* principal treatment; it *extends* the treatment already mandated for most of the book to the rest of it.
2. **It is permitted, and ZATCA documented the route.** Art 47 does not let you elect deemed-supplier treatment for registered owners — but **VAT Law Article 9** is an older and independent mechanism, and ZATCA's own amendments guideline cites it: *"if a VAT-registered taxable person supplies goods or services in their own name on behalf of another party, they are treated as making the supplies for themselves."* ZATCA documented the undisclosed-agent route for online portals expressly (Electronic Contracts guideline §6.4.4): two supplies, owner invoices platform, platform invoices customer, **both sides deduct input tax**. *(PRIMARY.)*
3. **It collapses the infrastructure problem.** One VAT identity, one CSID, one hash chain, one invoice template, one onboarding — and **no owner ever touches the Fatoora portal.** Measured against M1, this is the difference between an e-invoicing integration and an e-invoicing *platform*.
4. **It removes a whole class of correctness bug.** Under M1 the customer-facing document depends on resolving each owner's VAT status at the exact moment of contract conclusion, and ZATCA expects that status to be re-verified **on an ongoing basis**, with the platform carrying the VAT where the owner's registration is not valid on the date of supply *(SECONDARY — Dhruva, KPMG)*. Under M2, VAT status still matters — it decides whether UniGate receives a deductible input invoice — but it **no longer changes the customer's document**. A stale status check becomes a reconciliation issue instead of an incorrect tax invoice already in a customer's hands.
5. **It matches what ZATCA actually enforced.** Uber and Careem ran the published agency model in KSA and were assessed VAT on the **full fare**, on the express reasoning that drivers sit below the registration threshold and collecting from them is impractical. The combined bill was around **USD 100m**, settled in October 2021 *(SECONDARY — Bloomberg via Gulf News; Arab News)*. Art 47(3) now codifies that same position. Building the agency model would mean re-adopting the posture that produced the assessment.

**What it costs.**

- **Gross revenue recognition**, not net. This changes reported revenue dramatically and has knock-on zakat/income-tax presentation effects that were not researched here and are a genuine open item.
- **An Art 53(2) self-billing approval from ZATCA** to generate the registered owner's invoice to UniGate, rather than chasing one from every owner every period. Conditions are explicit: ZATCA approval, prior written agreement, the invoice states it was issued by the customer on behalf of the supplier, **both parties VAT-registered**, the agreement recites the supplier's approval procedure, and the supplier certifies it will not itself invoice those supplies *(PRIMARY — Art 53(2), verbatim)*. **No published application process or lead time was found — this is a schedule risk, and it is the reason to start the application early rather than at Phase 11.**
- **The characterisation risk.** Will ZATCA accept undisclosed agency when the app displays driver name and vehicle plate for safety and TGA reasons? Showing who performs the service is not obviously the same as disclosing a principal. This is a fact-pattern judgement, and it is the **single question most worth paying an advisor to answer first** — because it is the only thing standing between UniGate and a materially simpler system.

**The counter-argument, stated fairly.** M1 is the lower-legal-risk default: it follows the letter of Art 47(3) for each owner and needs no approval or characterisation argument. The honest trade is *legal conservatism against permanent structural complexity*. The recommendation favours M2 because the complexity M1 buys is not a one-off cost — it is a per-owner onboarding funnel with a mandatory manual step and a recurring renewal campaign, carried for the life of the platform.

**Not a blocker for Phase 2.** The schema already snapshots `vat_treatment` per booking. M2 is expressible as *"every booking resolves to `DEEMED_SUPPLIER`"* — the M1 machinery becomes the fallback if the advisor rejects M2, rather than dead code. **Keep the column. Do not build the per-owner CSID onboarding until the advisor answers.**

---

## 4. Decision 2 — E-invoicing integration

### What every option must do

Onboarding per EGS unit (CSR → compliance CSID → a suite of 3 or 6 compliance-check documents → production CSID); **UBL 2.1** KSA-profile XML; **XAdES-BES** signature over **ECDSA secp256k1 / SHA-256**; **BER-TLV** QR with 9 tags for Phase 2; a strictly sequential **ICV** counter and **PIH** previous-invoice-hash chain that may never reset; **clearance** (B2B, synchronous, pre-issuance) and **reporting** (B2C, within 24 hours). *(All PRIMARY.)*

Three constraints worth internalising regardless of which option wins:

- **Clearance blocks issuance for B2B; reporting does not for B2C.** ZATCA outages are documented and recurring — ~46,000 failed records in Dec 2023, 30–60 second clearance responses in Mar 2024, timeouts in Jul 2025, 500s in Jun 2026, and a community-maintained unofficial status monitor, which is telling in itself. **Set clearance timeouts above 60s and never let a ZATCA call block a booking-confirmation request.**
- **The ICV/PIH allocator must be serialized per EGS unit from day one.** Parallel issuance from two nodes sharing one certificate produces chain corruption — and that is exactly what a horizontally-scaled Node app does by default. This needs `SELECT … FOR UPDATE` or a per-tenant advisory lock, designed in, not retrofitted.
- **Canonicalization is the most-reported failure mode.** Hash mismatches traced to XML whitespace handling dominate ZATCA's own developer forum.

### The options

| | **A — In-house** | **B — Provider API** | **C — ERP-mediated** | **D — SDK sidecar** |
|---|---|---|---|---|
| **Shape** | Build UBL, signing, QR, chain, clearance in TypeScript | JSON in, cleared invoice out | Push into a ZATCA-compliant accounting product | Node owns UBL + chain; Java/.NET sidecar signs |
| **Effort to first cleared invoice** | 3–5 engineer-months | **3–6 engineer-weeks** | 2–4 engineer-weeks *(single VAT number only)* | 2–4 engineer-months |
| **Ongoing burden** | **High, permanent** — XSD/rule versions, SDK churn, cert renewal | **Low** — vendor tracks the regulation | Low | High |
| **Lock-in** | None | Moderate, abstractable | **High** — books and data model | None |
| **Under M2 (one CSID)** | Tractable | Straightforward | Credible | Tractable |
| **Under M1 (N CSIDs)** | You are building a PKI platform | Only vendors with a connected-accounts model work | ❌ One ERP tenant per owner — impractical | You are building a PKI platform |

**On the Node/TypeScript ecosystem — this matters and is easy to get wrong.** ZATCA's own SDK is a **Java JAR pinned to JDK 11–14** (later JDKs dropped secp256k1 from the default providers) plus a .NET DLL. **There is no official JavaScript binding.** It signs and validates but makes **no API calls** and manages **no chain state**. The community TypeScript libraries are all single-maintainer with near-zero adoption; the most feature-complete one **shipped malicious bootstrap code in a recent version**. There is no mature Node path. *(All verified from repositories and ZATCA's SDK page.)*

### ⭐ Recommendation: B (provider API), single-tenant, behind the existing `EInvoicingProvider` abstraction

**Why.**

1. **The recommendation in Decision 1 makes this the easy case.** Under M2, UniGate is a single taxpayer with one VAT number — which is the configuration **every** vendor supports. The multi-tenant "connected accounts" capability that only one or two vendors document, and none contractually commit to, becomes irrelevant.
2. **The hard parts are exactly the parts with no good Node answer** — XAdES over secp256k1, TLV byte-length handling on Arabic UTF-8, and canonicalization. These are correctness problems with silent failure modes on live tax documents, and they are where the documented incidents cluster.
3. **ADR-007's abstraction already exists and does its job.** The provider sits behind `buildXml / stamp / clear / report / status` with a mock implementing rejection and timeout paths. Lock-in is a JSON contract, not a data model.
4. **Vendor choice is a diligence exercise, not an architecture decision** — which is the point of keeping the abstraction. No vendor selection is made here.

**What must be true before signing anything.** Because ZATCA approves nobody (C-5) and liability stays with UniGate regardless, ask every candidate the same three questions **in writing**: does the vendor manage the **ICV/PIH chain server-side**; what is the **SLA during ZATCA-side outages** and what happens to blocked B2B clearance; and what is the **actual pricing** — several credible vendors publish none. Note also that **no vendor in this market ships a Node/TypeScript SDK**; all are plain JSON/Bearer REST, so a thin typed client is trivial either way.

**Keep in-house alive as a genuine fallback, not a gesture.** Under M2 with one CSID it is 3–5 engineer-months, and an MIT-licensed reference implementation exists to read. That is a real option if vendor pricing or an outage SLA proves unacceptable — which is precisely why the abstraction should not be allowed to leak.

---

## 5. Decision 3 — the wave deadline

| Wave | Threshold | Qualifying years | Integration deadline |
|---|---|---|---|
| 24 | > SAR 375,000 | 2022, 2023, 2024 | **30 June 2026 — past** |
| 25 | > SAR 187,500 | 2022, 2023, 2024, 2025 | 1 February 2027 |

*(Both PRIMARY, from ZATCA's own announcement pages. Wave 26 not announced as of 14 Sep 2026; ZATCA's pattern is a new wave every 3–4 months, roughly halving the threshold, with ≥6 months' notice.)*

**The test is historical and disjunctive.** At SAR 510,000 UniGate clears both thresholds, so **the wave depends entirely on which year the revenue arose** — a single qualifying year captures you, and later decline cannot un-capture you.

**One action decides this, and it is not an engineering action:** pull VAT return data for 2022, 2023 and 2024 **separately** and test each year against SAR 375,000.

Three things sharpen the picture since the last update:

- **ZATCA notifies by email and SMS** — not letter — to the contacts registered in the ERAD taxpayer profile, at least six months ahead, and it is a legal obligation on ZATCA *(PRIMARY — Detailed Guidelines p.57; Implementation Resolution Clause Sixth(1))*. **Stale contact details are the most likely way a notification was missed.** There is **no wave-lookup tool** in the Fatoora portal, despite widespread vendor advice to "check the portal" — that advice has no primary basis.
- **Sources genuinely conflict on whether the obligation crystallises on notification.** ZATCA's FAQ says a taxpayer *"is not required to implement Phase 2 requirements until notified"*; ZATCA staff on ZATCA's own forum say taxpayers *"should voluntarily onboard by the due date without waiting for email from ZATCA as the criteria is already published."* The FAQ is a document ZATCA's own guides disclaim as **not binding**. Non-receipt is worth documenting contemporaneously; it should not be treated as a safe harbour.
- **Early onboarding is expressly permitted and officially recommended**, and the Fatoora portal gates only on VAT registration being active — not on wave membership *(PRIMARY — Detailed Guidelines p.58, two separate passages)*.

**⭐ Recommendation: determine the wave this week, then onboard early regardless of the answer.**

If Wave 25, early onboarding is explicitly sanctioned and removes the deadline as a project risk entirely. If Wave 24, it is the fastest route back into the documented regime, and the penalty ladder's notice-first entry rung with a three-month correction window means a remediable situation is very different from an unremediated one. **Either way the engineering work is identical, so the wave answer changes urgency, not design.**

**Two things not to do.** Do not bulk back-fill gap-period invoices without a written ZATCA position: sequence gaps are explicitly flagged for investigation, and the PIH/ICV chain conflict is entirely unaddressed in ZATCA guidance. And do not conflate the fines-exemption initiative with a deadline extension — **ZATCA has never extended a wave date**, and the initiative has only ever waived fines already incurred.

---

## 6. Three findings that change the design outside these decisions

### 6.1 ⚠️ The Article 50 "restricted motor vehicle" trap — and the product's name is part of it

Art 50 blocks input-tax deduction on the purchase or lease of a **restricted motor vehicle** — broadly, a road vehicle carrying up to ten persons — unless used exclusively for business with no private availability, or held for onward supply. *(PRIMARY, verbatim.)*

**If UniGate's supply is characterised as a vehicle *lease*, a business customer may be blocked from reclaiming the 15% at all.** That directly attacks the B2B value proposition — and the entire reason UniGate agreed to issue VAT-reclaim invoices in the first place.

Because UniGate supplies vehicle **and driver**, with operational control retained, the natural characterisation is a **transport service**, not a vehicle lease — and Art 50 should not bite. But that characterisation has to be *supported*, and right now the product is called **"Vehicle Hiring"**, which argues the other way.

**Engineering consequence:** invoice line-item descriptions, contract wording and product naming are all evidence of characterisation. This is nearly free to get right at design time and expensive afterwards. **UNCONFIRMED — take to the advisor.**

### 6.2 Cross-border goods transport is zero-rated — with no qualifying-means test

Art 34(1) zero-rates the **international transport of goods** with no vehicle-type condition at all: any leg to or from outside the Kingdom. Passenger transport is far narrower — it needs a **≥10-seat** vehicle used *predominantly* for international work, or a scheduled timetabled service; a car or SUV crossing the causeway does **not** qualify. There is **no exemption for domestic transport** — Chapter Five covers only financial services and residential real estate. *(PRIMARY, verbatim.)*

**Engineering consequence:** UniGate's goods-transport vertical means zero-rating is live, not theoretical. Zero-rated is not "nothing to do" — it needs VAT category code **Z** plus a reason code on the e-invoice, and it requires **evidence**. And there is a real trade-off with Decision 1: under the principal models, **UniGate owns the zero-rating evidence** — customs and export documentation for supplies physically performed by owners it does not control. Under agency that burden sits with the owner. This is the strongest single argument *against* M2, and it should be put to the advisor explicitly.

### 6.3 ⚠️ TGA licensing may bind before VAT does

This was outside the brief and is arguably larger than the VAT question for scope.

- Car rental and **rental brokerage** are governed by one regulation, and the aggregator role — **وسيط التأجير** — is a **separately licensed activity**. Operating it with an expired licence is violation #76, SAR 5,000. A licence that can expire must first be held.
- The constraint runs **both ways**: a licensed rental establishment is fined SAR 3,000 for contracting with a rental broker where **its own TGA service rating does not permit it** (violation #91). So owner onboarding is not just "VAT-registered" — it is "**TGA-licensed with a sufficient rating**".
- Licensing conditions include a **SAR 100,000 financial guarantee**, premises in the licensed city, and a commercial registration covering brokerage.
- **Rental contracts must be issued through TGA's designated unified electronic contract system**, and brokerage platforms must be **technically integrated with the Authority's platform**.
- A **draft regulation covering brokerage in *private* car rental via electronic applications** (individually-owned vehicles) was in public consultation as of July 2025 — directly relevant if UniGate onboards individual owners.
- Passenger ride-hailing sits under a **different** TGA regime again, with its own licence, Saudi-nationality driver requirement, driver-ownership default, and TGA **pre-approval of pricing**.

**And for the goods vertical there is a third artefact, already mandatory.** **Bayan** (بوابة بيان, now at `bayan.logisti.sa`) is TGA's electronic **transport document** (وثيقة النقل) for road goods transport. It has been **compulsory for all carriers since 1 March 2023**, and the 2025 heavy-freight executive regulation devotes a chapter to it. Three details matter:

- It is **not a tax document.** A full-text search of the official Bayan user guide for ضريبة / ZATCA / فاتورة returns only the phrase *"شاملة الضريبة"* (tax-inclusive) on two amount fields. There is no VAT number field, no separate VAT line, no Fatoora linkage. **Bayan and the ZATCA tax invoice are independent obligations — UniGate needs both.**
- Only a **carrier, transport company or freight broker** may create a document; shippers are query-only. So issuance sits with UniGate or the owner, never the customer.
- An **individual truck owner** (ناقل فرد) is a native account type, but is **capped at one vehicle** and needs a professional driver card. That is a real constraint on the individual-owner model for goods transport, independent of VAT.
- **No public API, developer portal or specification was found** — the official service card names a web portal as the only channel. KSA TMS vendors advertise live linkage, so a gated path via direct request to TGA appears to exist, but no published spec, form or onboarding process was located.

**Engineering consequence:** the mandatory TGA e-contract system constrains **where the contract of hire is generated**, which interacts directly with where the tax invoice is generated. If the contract must originate in TGA's system, that is a second mandatory external integration on the booking-confirmation path — alongside ZATCA clearance, and alongside Bayan for every goods trip. **None of the three is currently modelled.** *(PRIMARY-grade sources, but tga.gov.sa was unreachable during research and text came from the government consultation portal and gazette mirrors — article numbers should be verified with Saudi counsel before anyone relies on them.)*

---

## 7. What goes to the advisor, in priority order

The list has shortened and sharpened. These are decisions, not research gaps.

1. **Will ZATCA accept an undisclosed-agency / buy-resell characterisation (M2)** for a platform that displays driver and vehicle identity for safety and TGA reasons? *Unblocks the entire simplification.*
2. **Art 53(2) self-billing approval** — process, evidence, lead time, and whether approval is blanket or per-counterparty. *Schedule risk; start early.*
3. **Transport service vs vehicle lease**, and the Art 50 block on B2B recovery (§6.1). *Cheap now, expensive later.*
4. **Which wave** — from 2022/2023/2024 VAT returns tested separately (§5). *This week.*
5. **Commission VAT under the deemed-supplier branch** — verify C-1 verbatim before the billing engine is built.
6. **Zero-rating evidence ownership** under principal treatment for cross-border goods transport (§6.2).
7. **Gross-vs-net revenue recognition** consequences for zakat and income tax under M2. *Not researched; a material second-order effect.*
8. **TGA brokerage licensing and the unified e-contract obligation** (§6.3) — for Saudi counsel, not the tax advisor.

---

## 8. Sources

**Primary — ZATCA and Saudi government**
- [Guideline for Amendments to the Implementing Regulation of VAT, April 2025](https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Amendments-to-the-Implementing-Regulation-of-(VAT).PDF) — §2.10 is the operative text on Art 47
- [VAT Implementing Regulations, 8th edition](https://zatca.gov.sa/en/RulesRegulations/Taxes/Documents/Implmenting%20Regulations%20of%20the%20VAT%20Law_EN.pdf) — Arts 34, 50, 53; **note: predates the 2025 amendments and contains no Art 47 marketplace text**
- [VAT Guideline for Electronic Contracts, Sept 2022](https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/VAT-Guideline-for-Electronic-Contracts.pdf) — §6.4, disclosed vs undisclosed agency
- [Decision to Reclassify the VAT Field Violations](https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/VAT%20Violations%20Penalties_EN.pdf) — the penalty ladder
- [E-invoicing Detailed Technical Guidelines v2](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf) · [Detailed Guidelines v2](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf)
- [Security Features Implementation Standards v1.2](https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf) · [XML Implementation Standard v1.2](https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf)
- [E-Invoicing Implementation Resolution](https://zatca.gov.sa/en/E-Invoicing/Introduction/LawsAndRegulations/Documents/20230519_E-Invoicing%20Implementation%20Resolution%20English.pdf)
- [Solution Providers Directory](https://zatca.gov.sa/en/E-Invoicing/SolutionProviders/Pages/SolutionProvidersDirectory.aspx) — carries the no-approval disclaimer
- [Wave 24](https://zatca.gov.sa/en/Pages/news_1426.aspx) · [Wave 25](https://zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx) · [Fines exemption to Dec 2026](https://zatca.gov.sa/en/MediaCenter/News/Pages/Cancellation-of-fines-Dec-2026.aspx)
- [Q2 2026 inspections](https://zatca.gov.sa/en/MediaCenter/News/Pages/Inspection-61k-Visits-Q2-2026.aspx) · [Q1 2026](https://zatca.gov.sa/en/MediaCenter/News/Pages/Inspection-60k-Visits-Q1-2026.aspx)
- [ZATCA Fatoora developer community](https://zatca1.discourse.group/) — failure modes, outages, moderator statements
- TGA: [car rental and brokerage regulation](https://www.tga.gov.sa/Regulations/Regulation/1540) · [draft private-car-rental brokerage regulation](https://istitlaa.scbc.gov.sa/ar/Transportation/tga/TGAAPPLICATIONS/Pages/default.aspx) · [ride-hailing regulation](https://istitlaa.scbc.gov.sa/ar/Transportation/tga/TGARIDE/Pages/default.aspx)

**Secondary — advisory**
- [KPMG — deemed suppliers](https://kpmg.com/sa/en/insights/tax-insights/vat-guideline-for-persons-obligated-to-pay-tax-in-special-cases-deemed-suppliers.html) · [KPMG — amendments](https://kpmg.com/sa/en/insights/tax-insights/tax-alert-amendments-to-the-vat-implementing-regulations.html)
- [Dhruva — ZATCA guidance on deemed supplier obligations, 30 Dec 2025](https://dhruvaconsultants.com/wp-content/uploads/2025/12/ZATCA-Guidance-on-Deemed-Supplier-Obligations-for-Electronic-Marketplaces.pdf)
- [PwC — approved amendments](https://www.pwc.com/m1/en/services/tax/middle-east-tax-news-alerts/2025/approved-amendments-to-the-vat-implementing-regulations.html) · [Alvarez & Marsal](https://www.alvarezandmarsal.com/thought-leadership/saudi-arabia-tax-alert-vat-guide-on-electronic-marketplaces-and-deemed-supplier-rules-effective-january-1-2026) · [Grant Thornton KSA](https://www.grantthornton.sa/en/insights/articles-and-publications/vat_and_electronic_marketplace_in_saudi_arabia/)

**Market precedent**
- [Uber KSA General Terms, Annex 1 — VAT](https://www.uber.com/legal/en/document/?country=saudi-arabia&lang=en&name=general-terms-of-use) — full-fare VAT charged Dec 2020–Mar 2024 on ZATCA instruction, later revoked retrospectively
- [Careem captain terms](https://www.careem.com/en-AE/captain-terms-rides/) — *"the receipts are not valid tax invoices"*
- [Gulf News — the ~$100m assessment](https://gulfnews.com/business/are-ride-hailing-companies-uber-and-careem-facing-a-100m-tax-bill-in-saudi-arabia-1.1634538142220)
- [Invygo KSA terms](https://www.invygo.com/en-sa/tc) — the one KSA rental-aggregator precedent with published terms; disclosed-agency drafting
- [HungerStation restaurant contract terms](https://hungerstation.com/sa-en/general-terms-conditions-restaurant-contracts) — merchant issues the tax invoice; tax certificate optional at onboarding

**Sources could not confirm:** ZATCA's 25 Dec 2025 deemed-supplier guideline PDF (cited URL now 404s); a consolidated post-2025 edition of the Implementing Regulations; any published process for the Art 53(2)/53(3) "Authority approval"; any ZATCA guidance tying marketplaces to e-invoicing mechanics; any ZATCA guidance on late onboarding or gap-period invoices.
