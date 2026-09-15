# Article 53(2) self-billing for transport suppliers, and whether Wafeq can carry it

**Date:** 2026-09-14 · **Answers:** OQ-25 (and re-frames OQ-04, OQ-24, decision 2 of the [options research](2026-09-14-vat-and-einvoicing-options.md)) · **Status:** research, not tax advice

> **No compliance is claimed.** Every legal statement below is labelled **[LAW]** (VAT Law / Implementing Regulations), **[ZATCA]** (official guidance or technical specification), **[ZATCA-STAFF]** (a ZATCA employee answering on the official Fatoora developer community — authoritative in practice, not in law), **[VENDOR]** (Wafeq's own documentation), **[ADVISER]** (secondary commentary) or **[INTERPRETATION]** (ours). Where no official source exists the text says so rather than filling the gap.

---

## 0. Executive summary

1. **Self-billing is legal, but it is an approval, not a right.** VAT Implementing Regulations **Art 53(2)** lets a *Taxable Customer* issue tax invoices on behalf of a *Taxable Supplier* — "**Subject to the Authority's approval**", with a **prior written agreement**, **both parties VAT-registered**, an invoice statement that it is issued by the customer on behalf of the supplier, an **acceptance procedure** for each invoice, and a supplier **certification not to issue its own invoices**. **[LAW]** ZATCA's technical guideline repeats it: "It is mandatory for the Seller and Buyer to be in a Self-Billing agreement **which has been approved by ZATCA**." **[ZATCA]**
2. **Approval is at agreement level, not invoice level.** The regulation attaches the approval to *the agreement between such Supplier and Customer*, and deems every invoice issued under it to be issued by the supplier. Nothing suggests per-invoice approval. Whether ZATCA will accept **one application covering many suppliers** under a template agreement is **not documented anywhere official** — it is the first question to put to ZATCA (§9). **[LAW] + [INTERPRETATION]**
3. **No statutory or officially published processing period was identified.** No ZATCA SLA, service-card duration or guideline timeline for Art 53(2) approval was found. No adviser estimate credible enough to repeat was found either. Plan for an unknown lead time and apply first.
4. **The supplier must be VAT-registered.** Art 53(2) says so explicitly. For unregistered subcontractors — individual drivers, single-truck owners, small bus operators under SAR 375,000 — **no tax invoice exists to self-bill**: their supply is outside scope, they cannot charge VAT, and UniGate gets no input credit. A settlement statement is fine; calling it a *tax invoice* is not. **[LAW]**
5. **Under Phase 2, the buyer generates, signs and submits the self-billed XML.** It is a *Standard Tax Invoice* (B2B), goes through **Clearance** (synchronous, blocking), and is signed with **UniGate's** certificate — ZATCA validates that the buyer VAT in the XML equals the VAT in the certificate (`SELF_BILLED_VALIDATION`). The seller party in the XML remains the transport company. The only flag is **position 7 of the invoice transaction code (KSA-2) = `1`**. **Self-billing on simplified invoices is rejected (BR-KSA-31)**, and on export invoices (BR-KSA-06). **[ZATCA] + [ZATCA-STAFF]**
6. **This is why 53(2) beats 53(3).** A *third-party* invoice under 53(3) is still the supplier's invoice and must be signed with **the supplier's** certificate — one Fatoora onboarding, OTP and hash chain per supplier (the funnel [ADR-008](../decisions/ADR-008-vat-operating-model.md) exists to avoid). A *self-billed* invoice uses **UniGate's** certificate for every supplier. **[INTERPRETATION, from the CSID validation rule]**
7. **Wafeq — partly yes, and not through the path UniGate is using today.** Wafeq has **two APIs on one host**. The **Public API** (`POST /v1/invoices/`, then `/invoices/{id}/tax-authority/report/`) is what Wafeq Premium's accounting invoices use; its invoice schema has **no self-billing or indicator field**, and its **bills (supplier bills) have no tax-authority reporting endpoint at all**. The **Wafeq ZATCA API** (`POST /v1/zatca/invoices/report/`) is a separate, standalone compliance service whose document schema **does** expose `indicators: ["SELF_BILLING", "SUMMARY", "EXPORT", "NOMINAL", "THIRD_PARTY"]` and takes the seller (`supplier`) per document. It is sold separately ("Contact our sales team") and **does not post to the Wafeq ledger**. **Whether it lets `supplier.tax_registration_number` differ from the account's own VAT number when `SELF_BILLING` is set — which self-billing requires — is not documented.** That is the one question that decides the architecture (§8). **[VENDOR]**
8. **Recommended architecture:** UniGate platform → **Wafeq ZATCA API** for the self-billed document (compliance artefacts: cleared XML, PDF/A-3, QR, UUID, status) → **Wafeq Public API `bills`** for the accounting record (supplier bill with `external_id` = settlement id, cleared PDF attached) → supplier payment. One settlement, two Wafeq calls, one idempotency key each. Fallback if Wafeq cannot: a second EGS device under UniGate's own VAT number, with any provider (or in-house) that exposes KSA-2 position 7 — a taxpayer may run several EGS units, each with its own CSID and chain.
9. **Do first, in this order:** (a) confirm with Wafeq (§10); (b) send the ZATCA approval application with a signed pilot agreement for **one** supplier and ask the blanket question in the same submission (§9); (c) build the settlement → self-billing request → clearance → bill pipeline against Wafeq's **simulation** environment; (d) no self-billed invoice in production before the approval reference is on file.

---

## 1. The law

### 1.1 Article 53(2), VAT Implementing Regulations — full text **[LAW]**

Source: ZATCA English translation, *Implementing Regulations of the Value Added Tax Law*, Eighth Edition (09/11/2021), Board Resolution No. (3839) as amended through Resolution No. (2-7-21). Article 53, paragraph 2 (footnote 23: "amended pursuant to BoD Resolution No (2-7-21) dated 04/04/1443H corresponding to 09/11/2021G"):

> "Subject to the Authority's approval, a Taxable Customer may issue Tax Invoices on behalf of a Supply made by a Taxable Supplier provided that a prior agreement between such Supplier and Customer has been made to this effect; that the Tax Invoice state that it was issued by the Customer on behalf of the Supplier; and that the Supplier and Customer are registered with the Authority for VAT purposes. A Tax Invoice issued as per this Paragraph will be deemed to be issued by the Supplier. The agreement referred to in this Paragraph must include a recitation of the procedures required for the Tax Invoices to be approved by the Supplier on whose behalf they are issued and a certification by the Supplier that they will not issue invoices in respect of the Supplies for those Tax Invoices were issued."

URL: <https://zatca.gov.sa/en/RulesRegulations/Taxes/Documents/Implmenting%20Regulations%20of%20the%20VAT%20Law_EN.pdf> (pp. 46–47 of the PDF). The Arabic text is the legally binding version; the English is ZATCA's own translation.

**Was it amended since?** The 2025 amendment package (Board Resolution 01-06-24, gazetted 18 April 2025) touched Arts 10, 15, 33, 50, 66, 69, 70 and added an e-invoicing suspension power as Art 53(10). **Art 53(2) itself was not changed.** Sources: [EY alert](https://www.ey.com/en_gl/technical/tax-alerts/saudi-arabia-approves-amendments-to-vat-implementing-regulations), [Sovos on the proposed 53(10)](https://sovos.com/blog/vat/proposed-amendments-to-saudi-arabias-vat-implementation-regulations-vatir-what-is-changing/). **[ADVISER]** — the gazetted Arabic text should be checked by the advisor.

### 1.2 The seven conditions, unpacked

| # | Condition | Where it bites UniGate |
|---|---|---|
| 1 | **Authority's approval** | Before the first self-billed invoice. An invoice issued without it is not a valid tax invoice — see 1.4 |
| 2 | **Prior agreement** between *this* supplier and *this* customer | One agreement per supplier (a template is fine; the counterparty is not) |
| 3 | Invoice **states** it is issued by the customer on behalf of the supplier | A mandatory text line on the PDF *and* KSA-2 position 7 = 1 in the XML |
| 4 | **Both** parties VAT-registered | Excludes every unregistered subcontractor (§5) |
| 5 | Invoice **deemed issued by the supplier** | The supplier's output VAT, the supplier's return, the supplier's liability for accuracy of what UniGate wrote |
| 6 | Agreement recites the **acceptance procedure** | An agreed procedure, not a signature per invoice — see §4.3 |
| 7 | Supplier **certifies it will not issue** invoices for those supplies | Duplicate-invoice risk is the supplier's undertaking, but UniGate should detect it anyway |

### 1.3 Article 53(3) — the alternative UniGate should *not* use here **[LAW]**

> "Subject to the Authority's approval, a Taxable Person may issue Tax Invoices through a third-party provided that all obligations … are satisfied. The Supplier shall be responsible for the accuracy of the information shown on the Tax Invoice and for reporting Output Tax on the supply."

Under 53(3) UniGate would be the supplier's *agent for issuing*, the invoice remains the supplier's document in every technical sense, and — because a CSID is bound to one VAT number and validated against the seller VAT in the XML — it must be signed with **the supplier's** certificate. That is the per-supplier onboarding funnel described in [ADR-008](../decisions/ADR-008-vat-operating-model.md). Self-billing under 53(2) is signed with **the buyer's** certificate (§6). For a company with many suppliers, that difference is the whole business case.

### 1.4 What goes wrong without approval **[LAW] + [INTERPRETATION]**

- Art 49(7): "Input Tax may only be deducted where the Taxable Person holds evidence of the amount of Input Tax paid or payable in a form specified in Article forty-eight of the Agreement" — i.e. a valid tax invoice. A customer-issued invoice outside an approved 53(2) arrangement is not one. **UniGate's input-tax deduction on every such purchase is at risk on audit.**
- The supplier, having certified it would not issue invoices, has issued none — so **no valid tax invoice exists for the supply at all**, which is the supplier's compliance failure too.
- E-invoicing penalties: the graduated ladder (notice → SAR 1,000 → 5,000 → 10,000 → 40,000) documented in the [options research §2 C-3](2026-09-14-vat-and-einvoicing-options.md) applies to non-compliant e-invoices. Not a named self-billing penalty; the same ladder.

---

## 2. The approval process

### 2.1 What is officially documented **[ZATCA]**

- The *E-invoicing Detailed Technical Guideline* v2 (Nov 2022), §4 Reporting and Clearance, p. ~50: "Standard documents (B2B) are generally submitted by the Seller; however, Standard documents (B2B) under Self-Billing are submitted by the Buyer. **It is mandatory for the Seller and Buyer to be in a Self-Billing agreement which has been approved by ZATCA.**" URL: <https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf>
- The *Detailed Guidelines for E-Invoicing* v2 (May 2023), §3.1: the customer or third party issuing on behalf of a resident taxable person is itself **within the scope of the e-invoicing regulation** (citing Art 53(3) as amended 09/11/2021). URL: <https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf>

### 2.2 What is *not* officially documented

Despite searching zatca.gov.sa (English and Arabic e-services, forms, guidelines, FAQ) **no official ZATCA page describing the self-billing application — its form name, channel, required attachments or processing time — was located.** One secondary source describes "a form [that] allows businesses to request ZATCA's approval for issuing self-invoices or third-party invoices, following specific terms and a formal agreement" ([ClearTax, ZATCA portal overview](https://www.cleartax.com/sa/all-about-zatca-gov-sa-portal)) **[ADVISER]**, which is consistent with the regulation but adds no procedural detail.

### 2.3 Practical route — **[INTERPRETATION]**, to be confirmed by the advisor

| Step | What | Basis |
|---|---|---|
| 1 | Draft the self-billing agreement (§4) and **sign it with the first supplier** | Art 53(2) requires a *prior* agreement; ZATCA approves an *agreement*, so there must be one to approve |
| 2 | Submit an approval request through the **ZATCA portal (VAT → requests / general request)** as a VAT taxpayer, attaching: the signed agreement; both parties' VAT certificates; a cover letter describing the arrangement, the services (subcontracted passenger/pilgrim and goods transport), the acceptance procedure, the systems used (Wafeq, Phase 2 integrated) and **the list of suppliers intended to be covered** | Secondary description of "a form"; absence of any dedicated e-service suggests a general request |
| 3 | Ask, in the same submission, whether approval is granted **per agreement/counterparty or for the arrangement as a whole**, and how additional suppliers are to be notified | §3 |
| 4 | Do not issue any self-billed invoice until a **written approval with a reference number** is held; record it against the agreement (§11) | Art 53(2) "subject to the Authority's approval" is a condition precedent, not a notification |
| 5 | If ZATCA requires a per-supplier application, batch them: same template, one schedule | Cost control |

**Signed agreement attached?** The regulation makes the agreement a condition and the guideline says ZATCA approves *the agreement*, so **yes, attach it** — an unsigned draft is not "a prior agreement … made to this effect".

### 2.4 Lead time

**No statutory or officially published processing period was identified.** No ZATCA service card, SLA, guideline or FAQ gives a duration for Art 53(2) approval, and no Saudi adviser source found gave a figure specific enough to repeat. Treat the lead time as unknown, apply early, and keep the ordinary route (supplier issues its own e-invoice) running until approval lands.

---

## 3. Blanket vs per-counterparty

### 3.1 What the text supports **[LAW]**

- "provided that a prior agreement between **such Supplier and Customer** has been made" — the agreement is a bilateral instrument with a specific supplier.
- "**A Tax Invoice** issued as per this Paragraph will be deemed to be issued by the Supplier" — the deeming applies to every invoice under the arrangement; nothing in the paragraph contemplates approval of individual invoices.
- "The agreement … must include a recitation of the procedures required for the Tax Invoices to be approved **by the Supplier**" — the per-invoice approval in the regulation is the *supplier's*, not ZATCA's.

### 3.2 Conclusions

| Question | Answer | Confidence |
|---|---|---|
| Is approval per invoice? | **No.** Once the arrangement is approved, UniGate issues recurring self-billed invoices under it without further ZATCA involvement | High — text and guideline |
| Is approval per agreement / per supplier? | **The approval attaches to an agreement, and an agreement is with one supplier.** So the *unit* of approval is the counterparty | High on the unit; see next row |
| Can one application cover many suppliers? | **Not documented.** ZATCA may accept a single application with a template agreement and a schedule of suppliers, or may want one per agreement | **Unknown — ask ZATCA (§9 Q1)** |
| Does adding a supplier later need a new approval? | Follows from the previous answer. Design the agreement so a new supplier signs the *same* template, and ask ZATCA whether a notification suffices | Unknown |
| Does ZATCA grant "company-level authorisation"? | No basis in the text for an authorisation untethered from agreements | Medium |

**Design consequence:** model `self_billing_agreements` as **one row per supplier**, each carrying its own `zatca_approval_reference`; if ZATCA grants a blanket reference, every row carries the same value. That schema is correct under either answer (§11).

---

## 4. The self-billing agreement

### 4.1 Mandatory content (from Art 53(2)) **[LAW]**

1. Identification of both parties, **including both VAT registration numbers** (both must be registered).
2. The statement that UniGate will issue tax invoices **on behalf of** the supplier for the covered supplies.
3. The **procedure for the supplier's approval/acceptance** of each invoice.
4. The supplier's **certification that it will not issue tax invoices** for the covered supplies.

### 4.2 Recommended structure, tailored to transport subcontracting

| § | Clause | Notes |
|---|---|---|
| 1 | **Parties** — UniGate (legal name, CR, VAT no., address per VAT certificate); Supplier (same) | Address fields must match what goes into the XML (BR-KSA-09/10 seller address rules) |
| 2 | **Recitals** — Art 53(2); both parties registered; supplier holds the TGA licence(s) it needs to perform the services | Ties the tax arrangement to the regulatory one (OQ-13) |
| 3 | **Definitions** — Trip, Completed Trip, Settlement Period, Settlement Statement, Self-Billed Invoice, Acceptance Window, Clearance | |
| 4 | **Scope of supplies** — road passenger transport (incl. pilgrim/Hajj/Umrah movements), bus hire with driver, goods transport, ancillary services; **exclusions** (e.g. anything invoiced by the supplier to third parties) | Precision matters: the supplier's undertaking not to invoice is scoped by this clause |
| 5 | **Effective date and term** — from ZATCA approval date; 12 months auto-renewing; **conditional on approval** (§17) | |
| 6 | **Pricing and settlement methodology** — per-trip rates / rate card reference; how distance, waiting time, no-shows, cancellations and tolls are priced; VAT at the standard rate unless a zero-rating applies **and the supplier has provided the evidence** | Zero-rated international legs (Art 34) need evidence; put the burden on the supplier |
| 7 | **Completed-trip confirmation** — what data proves completion (platform trip record, GPS end event, POD, passenger manifest); who may dispute it and within how long | Feeds the settlement engine |
| 8 | **Settlement cycle** — weekly/fortnightly/monthly; statement issued on day N; **invoice date = statement date**; one self-billed invoice per supplier per period (a *summary* invoice, KSA-2 position 6 = 1, covering the period's trips, issued no later than the 15th of the following month per Art 53(4)) | Summary invoices are permitted for periods ≤ one month |
| 9 | **Acceptance procedure** — statement delivered via the supplier portal and email; supplier has **X business days** to object line-by-line; **silence = acceptance**; on objection the disputed lines are withheld and the undisputed balance is invoiced | This *is* the Art 53(2) "procedure for approval by the Supplier" — see §4.3 |
| 10 | **Issuance and delivery** — UniGate generates, signs and submits the invoice for clearance; delivers the **cleared** PDF/A-3 (with embedded XML) to the supplier; the invoice carries the statement "Issued by the Customer on behalf of the Supplier under Art 53(2)" in Arabic and English | |
| 11 | **Supplier undertaking not to issue invoices** for covered supplies; if it does, it must cancel by credit note and notify UniGate | Mandatory certification |
| 12 | **VAT responsibilities** — output VAT is the supplier's, reported in the supplier's return; supplier must **maintain registration** and notify UniGate within N days of any change, suspension, group joining/leaving or deregistration; UniGate may verify status via ZATCA's VAT lookup at any time and **suspend self-billing from the date registration ceases** | Art 53(2) fails the moment one party is unregistered |
| 13 | **Credit and debit notes** — UniGate issues them under the same arrangement, referencing the original invoice; reasons limited to those in Art 40; supplier acceptance procedure applies | Buyer submits these too |
| 14 | **Records** — both parties keep the cleared XML/PDF, statements and acceptance evidence for **six years from the end of the tax period** (Art 66(1)), in Arabic where required (Art 66(2)) | |
| 15 | **Data and systems** — Phase 2 compliance is UniGate's responsibility for generation, signing and clearance; the supplier consents to its details being included in invoices submitted to ZATCA; PDPL notice | |
| 16 | **Disputes** — internal escalation, then per master services agreement | |
| 17 | **Condition precedent and suspension** — no self-billed invoice before ZATCA approval; either party may suspend on ZATCA instruction; **automatic termination on deregistration of either party** | |
| 18 | **Termination** — notice; transition back to supplier-issued invoices from a stated date; no overlap | |
| 19 | **Language, governing law, signatures** — Arabic prevails | |
| Schedule A | Rate card / pricing method | |
| Schedule B | Acceptance window and communication channels | |
| Schedule C | Form of the self-billed invoice statement text | |

### 4.3 Is explicit acceptance of *every* invoice legally required?

**No — an agreed procedure is what the regulation requires.** Art 53(2) requires the agreement to "include a recitation of the procedures required for the Tax Invoices to be approved by the Supplier". It prescribes *that there be a procedure*, not that every invoice carry an affirmative signature. A deemed-acceptance mechanism (objection window, silence = acceptance) is a procedure. **[LAW] + [INTERPRETATION]** — the advisor should confirm ZATCA has not taken a narrower view in practice. Whatever the procedure, **record the acceptance event** (timestamp, channel, user or "deemed") per invoice (§11).

---

## 5. Unregistered suppliers

| Supplier type | Can UniGate self-bill a *tax invoice*? | What UniGate can do |
|---|---|---|
| VAT-registered transport company | **Yes** under an approved 53(2) agreement | Self-billed Standard Tax Invoice, cleared, input VAT deductible |
| Company **below** the mandatory threshold (SAR 375,000) but **above** the voluntary threshold (SAR 187,500 of supplies *or expenses*) | **Not until it registers.** Voluntary registration is available (Art 7) | Make voluntary registration an onboarding tier; self-bill once the VAT certificate is verified |
| Company below SAR 187,500, individual drivers, single-vehicle owners, non-registered subcontractors | **No.** Art 53(2) requires both parties registered. The supply is outside VAT; there is no output tax and no invoice to issue | Issue a **settlement statement / remittance advice** — a commercial document, **not** labelled tax invoice, showing no VAT. No input credit. **If UniGate operates as a platform** the deemed-supplier rule (Art 47(3), effective 1 Jan 2026) already makes UniGate the supplier to the end customer for these owners — see [ADR-008](../decisions/ADR-008-vat-operating-model.md); it changes nothing here: still no tax invoice from the owner |
| Non-resident carrier | Outside 53(2) (resident registration). Reverse charge on imported services applies where relevant; not researched further | — |

**[LAW]** Thresholds: mandatory SAR 375,000, voluntary SAR 187,500 (VAT Law / Implementing Regulations Art 3 and Art 7 — voluntary registration is available on *supplies or expenses*). **Design consequence:** `vat_registration_status` per supplier, verified from the certificate and re-verified on a schedule, gates two things — whether a self-billed *tax invoice* is generated, and whether VAT appears on the settlement at all.

---

## 6. Phase 2 mechanics for a self-billed invoice

| Item | Ordinary B2B invoice | **Self-billed B2B invoice** | Source |
|---|---|---|---|
| Who generates the XML | Seller's EGS | **Buyer's (UniGate's) EGS** | Technical Guideline §4 **[ZATCA]** |
| Who submits to FATOORA | Seller | **Buyer** | same |
| API | Clearance | **Clearance** (it is a Standard Tax Invoice) — synchronous; not valid until ZATCA's stamp is returned | same |
| Document type | `InvoiceTypeCode` 388, `@name` starting `01` | **Same**, `@name` = `01` + flags with **position 7 = `1`** (e.g. `0100000` → `0100001`) | XML Implementation Standard v1.2 §11.2.1, BR-KSA-06 **[ZATCA]** |
| Seller party (`AccountingSupplierParty`) | Seller | **Transport supplier** — its VAT number, CRN, address | ZATCA staff: "seller's VAT number should be provided under AccountingSupplierParty … Do not interchange them" **[ZATCA-STAFF]** |
| Buyer party (`AccountingCustomerParty`) | Buyer | **UniGate** | same |
| Certificate that signs | Seller's CSID | **UniGate's CSID.** ZATCA checks the *buyer* VAT against the certificate: error `SELF_BILLED_VALIDATION` — "Buyer vat number in the provided certificate is not equal the vat number in the XML"; and `BR-CUSTOM-VALIDATION-01` rejects seller VAT = buyer VAT | **[ZATCA-STAFF]** |
| Simplified (B2C) variant | Allowed | **Not allowed** — BR-KSA-31: for `02` documents only third-party, nominal and summary flags are accepted | **[ZATCA]** |
| Export combination | — | **Not allowed** — BR-KSA-06 | **[ZATCA]** |
| Mandatory statement | — | "issued by the Customer on behalf of the Supplier" on the human-readable invoice (Art 53(2)); the XML flag is position 7 | **[LAW] + [ZATCA]** |
| UUID (KSA-1) | Per document | Same — generated by UniGate's EGS | **[ZATCA]** |
| Invoice hash / PIH (KSA-13) / ICV (KSA-16) | Seller's chain | **UniGate's chain** — self-billed documents sit in the same counter and hash chain as UniGate's own sales invoices on that device (or on a dedicated device with its own chain) | **[ZATCA] + [INTERPRETATION]** |
| QR (KSA-14) | ZATCA-stamped on clearance | Same — returned in the clearance response | Technical Guideline §4 |
| Credit / debit notes | Seller issues, references original | **UniGate issues** (381/383, position 7 = 1), `BillingReference` to the original self-billed invoice, reason per Art 40, cleared | **[ZATCA] + [INTERPRETATION]** |
| Whose VAT return | Seller's output, buyer's input | **Supplier's output** (invoice deemed issued by the supplier), **UniGate's input** | **[LAW]** |

Sources: XML Implementation Standard v1.2 (May 2023) <https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf> (§5.3 "Self Billed — The invoice is issued by the buyer instead of the supplier. It is only applicable in B2B scenarios. It will not have any effect on the fields, however its mandated that the invoice states that it is self-billed"; §11.2.1; rules BR-KSA-06, BR-KSA-31). Fatoora developer community thread "Self Billing Errors", ZATCA staff (Ankit K. Tiwari): <https://zatca1.discourse.group/t/self-billing-errors/4491>.

**Two operational notes [INTERPRETATION]:**
- The supplier's own e-invoicing wave is irrelevant to *these* documents: the issuer is UniGate, UniGate is integrated, so every self-billed invoice must be a cleared Phase 2 document from day one.
- Because clearance is synchronous and blocking, the self-billing job must be asynchronous with respect to settlement — the pattern already designed in [ADR-007](../decisions/ADR-007-e-invoicing.md) (outbox, `PENDING_CLEARANCE`, `CLEARANCE_FAILED`, immutable past `DRAFT`).

---

## 7. Wafeq — what the documentation actually says **[VENDOR]**

Reviewed 2026-09-14: <https://developer.wafeq.com/> (Public API, index at `/llms.txt`), <https://zatca.wafeq.com/> (ZATCA API, index at `/llms.txt`), Wafeq help centre.

### 7.1 Two APIs, one host

| | **Wafeq Public API** | **Wafeq ZATCA API** |
|---|---|---|
| Base | `https://api.wafeq.com/v1` | `https://api.wafeq.com/v1/zatca/…` (docs at zatca.wafeq.com) |
| Auth | `Authorization: Api-Key <key>` (org-wide) or OAuth Bearer (multi-tenant) | `Authorization: Api-Key`, plus `X-ZATCA-Environment: simulation|production`, optional `X-ZATCA-Connected-Account-ID` |
| Purpose | "creates and manages accounting invoices inside a Wafeq organization" | "a standalone Saudi Phase 2 compliance service and **does not create invoices in the Wafeq accounting application**" |
| Commercial | Plus / Premium / Enterprise support the Fatoora Phase 2 connection ("only these plans support the ZATCA Phase 2 integration") | "**Interested in the Wafeq ZATCA API? Contact our sales team**" — not documented as included in any plan |
| Key doc | <https://developer.wafeq.com/docs/wafeq-public-api-vs-zatca-api> | same page |

Wafeq's own rule: "If you need both accounting and ZATCA compliance — create the invoice with the Wafeq Public API, then use that invoice's Public API tax-authority reporting action. **Do not separately recreate the same document through the standalone ZATCA API.**"

### 7.2 Public API inventory (what Premium's `Api-Key` reaches)

| Resource | Endpoints | Notes |
|---|---|---|
| Contacts | list/create/retrieve/update/delete `/contacts/` | one contact serves as customer or supplier |
| Invoices | CRUD `/invoices/`, line items, `GET …/download/` (PDF), **`POST /invoices/{id}/tax-authority/report/`** | reporting response: `status`, `reported_ts`, `metadata.errors[]`, `metadata.warnings[]` |
| Simplified invoices | same shape, own tax-authority report endpoint | B2C |
| Credit notes | CRUD, download, **tax-authority report** | |
| Debit notes | CRUD, download — **no tax-authority report endpoint listed** | |
| Bills (supplier bills) | CRUD `/bills/`, line items, download PDF, `attachments` | **no tax-authority endpoint** |
| Purchase orders | CRUD, `POST …/bill/` convert to draft bill | |
| Payments / payment requests | CRUD, download | settle invoices *or* bills |
| `external_id` | on invoices, bills, contacts, … | "Store both the source ID and returned Wafeq ID in a tenant-scoped mapping table" |
| Idempotency | `X-Wafeq-Idempotency-Key` header on POSTs | retry 429/5xx/timeouts with the same key; never 400 |
| **Webhooks** | **None documented** in either index | poll `status` / `reported_ts` |
| Rate limits | not published; 429 handling documented | |

### 7.3 ZATCA API document schema (the part that matters)

`POST /v1/zatca/invoices/report/` takes `document` with: `currency`, `customer` (identification `{type, value}`, `tax_registration_number`, address), **`supplier`** (same shape — *passed per document*), `document_number`, `supply_date`, `line_items[]`, `tax_amount_type`, `tax_total`, `discounts`, `charges`, `payment_means`, `note`, and:

> `indicators` — "Special properties of the document, such as whether it is a third-party, nominal, export, summary, or self-billed invoice." Enum: **`SELF_BILLING`**, `SUMMARY`, `EXPORT`, `NOMINAL`, `THIRD_PARTY`.

Response: `status`, `reference`, `qr_code_data` (base64), `reported_ts`, `sent_ts`, `created_ts`, `metadata` (errors/warnings), `response` ("The response from the ZATCA API"), plus `GET …/download/` for the PDF/A-3 with embedded XML. Also: `…/validate/` (no submission), `…/bulk-report/`, `…/retry/` (status `ERROR` retried hourly), `…/summary/`. Credit notes and debit notes have the same set. Source: <https://zatca.wafeq.com/reference/invoices_report_create>.

The "Platforms / white label" guide shows the `supplier` block populated with *the connected account's* CRN, i.e. the seller is the certificate holder — the ordinary case. **No example, guide or help article shows `SELF_BILLING` in use**, and nothing states whether a document with `SELF_BILLING` may carry a `supplier.tax_registration_number` different from the account's own — the exact thing self-billing requires.

### 7.4 Assessment of "UniGate system → Wafeq REST API → Wafeq → ZATCA"

| Requirement | Public API (current) | ZATCA API | Verdict |
|---|---|---|---|
| Sales invoices to customers (already live) | ✅ | n/a | keep |
| **Self-billed invoice** on behalf of a registered supplier | ❌ no indicator field; invoice schema is for UniGate-as-seller | ⚠️ `SELF_BILLING` exists; **VAT-mismatch behaviour undocumented** | **Ask Wafeq (§10)** |
| Accounting entry for the purchase | via `bills` ✅ | ❌ by design | use both |
| Supplier payment record | `payments` on the bill ✅ | ❌ | |
| Cleared XML / PDF / QR / UUID retrieval | on invoices only | ✅ | |
| Webhooks | ❌ | ❌ | poll |
| Multiple VAT numbers / branches | not in scope | connected accounts, branches & group VAT guide | not needed under ADR-008 |

**The architecture is appropriate *if* Wafeq confirms §10 Q1–Q3.** If it does, Wafeq becomes the single external e-invoicing dependency for both directions of UniGate's paper, which is exactly the shape [ADR-007](../decisions/ADR-007-e-invoicing.md) wanted behind `EInvoicingProvider`. If it does not, see §8.2.

---

## 8. Recommended workflow and architecture

### 8.1 End-to-end (Wafeq ZATCA API path)

```
Supplier completes trips
  → Platform validates completion (trip record, GPS end, POD/manifest)          [existing trip lifecycle]
  → Settlement engine closes the period: rate card × trips → settlement lines   [settlements, immutable once closed]
  → Settlement statement published to supplier portal + email; acceptance window opens
  → Window closes (accepted / deemed / partially disputed → disputed lines withheld)
  → Pre-flight: supplier VAT status re-verified; agreement ACTIVE with approval ref; supplier not = UniGate VAT
  → Outbox job: build self-billing request (supplier = transport company, customer = UniGate,
      indicators [SELF_BILLING, SUMMARY], supply_date = period end, note = Art 53(2) statement AR/EN)
  → POST /v1/zatca/invoices/validate/   (dry run; reject → CLEARANCE_FAILED with metadata.errors)
  → POST /v1/zatca/invoices/report/     (idempotency key = settlement id; synchronous clearance)
  → Store: wafeq reference, status, reported_ts, qr_code_data, ZATCA response, UUID/hash from XML
  → GET …/download/  → store PDF/A-3 (embedded XML) in document storage; hash it
  → Deliver cleared PDF to supplier (portal + email); record delivery
  → POST /v1/bills/  (external_id = settlement id, contact = supplier, attachments = cleared PDF, lines = settlement)
  → Payment run → POST /v1/payments/ against the bill → ledger
  → Credit/debit note path mirrors the above (reference original invoice)
```

Everything from "Outbox job" down runs off the transactional outbox with durable retry; the settlement itself never blocks on ZATCA. Manual review queue for `CLEARANCE_FAILED` (invoices are immutable past `DRAFT` — corrections are forward-only, per ADR-007).

### 8.2 Fallback if Wafeq cannot carry self-billed documents

1. **Keep Wafeq for sales invoices and the ledger** (bills, payments) — no change.
2. **Onboard a second EGS device under UniGate's own VAT number** for self-billed documents. A taxpayer may run several EGS units; each has its own CSID and its own ICV/PIH chain, so this does not disturb the Wafeq device's chain. The OTP is UniGate's own — one portal visit, not one per supplier.
3. Put **any provider that exposes KSA-2 position 7** behind `EInvoicingProvider` for that device — or the in-house adapter already designed in the [options research §4 option A](2026-09-14-vat-and-einvoicing-options.md). The self-billed document is otherwise an ordinary cleared B2B invoice; nothing exotic is needed beyond the flag and the seller/buyer mapping.
4. Attach the cleared PDF to the Wafeq bill exactly as in 8.1.

**Do not** try to represent the self-billed tax invoice as a Wafeq *bill* and treat the bill PDF as the tax document: a bill is not signed, not cleared, carries no ZATCA stamp or QR, and is not a tax invoice.

---

## 9. Exact questions to send to ZATCA (with the application)

1. **Unit of approval.** "We intend to enter Art 53(2) self-billing agreements on an identical template with multiple VAT-registered transport suppliers. May we submit **one** application covering all listed suppliers, with additional suppliers notified by schedule update, or must each agreement be approved separately?"
2. **Channel and content.** "Please confirm the channel for the Art 53(2) approval request and the documents required (signed agreement, VAT certificates, description of the acceptance procedure, system details)."
3. **Effect on the supplier's own wave.** "Where the supplier has not yet reached its Integration Phase wave, do self-billed invoices issued by us (already integrated) need to be cleared Phase 2 documents? (We assume yes.)"
4. **Acceptance procedure.** "Is a deemed-acceptance procedure (objection window, silence = acceptance) an acceptable 'procedure for approval by the Supplier' under Art 53(2)?"
5. **Summary invoices.** "May a self-billed invoice be a summary invoice covering a calendar month of trips under Art 53(4), issued by the 15th of the following month?"
6. **Change of status.** "What is required when a supplier deregisters, joins a VAT group or is suspended mid-term — is the approval automatically void from that date?"
7. **Reference.** "Please state the approval reference to be quoted on our records and, if required, on the invoices."

## 10. Exact questions to send to Wafeq

1. **Core.** "Does the Wafeq ZATCA API (`POST /v1/zatca/invoices/report/`) support **ZATCA Phase 2 Self-Billed Standard Tax Invoices under Article 53(2)**, where UniGate is the **buyer** and signs/submits with **UniGate's** CSID on behalf of a **VAT-registered transport supplier** shown as `document.supplier`? Specifically: with `indicators: ["SELF_BILLING"]`, will you accept `supplier.tax_registration_number` **different from** our account's VAT number and place **our** VAT number as the buyer, so that ZATCA's `SELF_BILLED_VALIDATION` passes? Please provide a worked request/response example and the invoice transaction code you emit (expected `0100001` / `0100011` for summary)."
2. **Clearance and artefacts.** "Confirm the document goes through Clearance (not Reporting), and that the response/download returns the cleared XML with ZATCA stamp, QR, UUID and invoice hash."
3. **Notes.** "Confirm self-billed credit notes and debit notes (`indicators: SELF_BILLING`, `BillingReference` to the original) are supported through the same API."
4. **Commercial.** "Is the Wafeq ZATCA API included in our Premium subscription or a separate contract? What are the rate limits and any document-volume pricing?"
5. **Chain.** "Will self-billed documents share the ICV/PIH chain of our existing Wafeq Fatoora device, or do you require a separate registered device? Can we register an additional device under our VAT number for this purpose?"
6. **Public API.** "Is there any way to flag a Public API invoice or **bill** as self-billed and report it to ZATCA? (We read the schemas as no.)"
7. **Simulation.** "Can we exercise the full self-billing flow against `X-ZATCA-Environment: simulation` before ZATCA approval is granted?"
8. **Webhooks.** "Do you offer webhooks or status callbacks for reporting outcomes, or is polling the only option?"

---

## 11. Data UniGate should store

Extends the [database.md](../database.md) invoicing tables rather than replacing them. All money `NUMERIC(14,2)`; all identifiers UUID v7; nothing here is ever deleted.

**`self_billing_agreements`** (one per supplier)
`id`, `supplier_id`, `supplier_vat_number` (verified snapshot), `unigate_vat_number`, `template_version`, `signed_document_id` (→ document store), `effective_from`, `expires_at`, `acceptance_window_days`, `status` (`DRAFT` → `SIGNED` → `SUBMITTED_TO_ZATCA` → `ACTIVE` → `SUSPENDED` / `TERMINATED`), **`zatca_approval_reference`**, `zatca_submitted_at`, `zatca_approved_at`, `zatca_approval_document_id`, `suspended_reason`, audit columns.

**`supplier_vat_verifications`**
`supplier_id`, `vat_number`, `verified_at`, `method` (`CERTIFICATE_UPLOAD` / `ZATCA_LOOKUP` / `MANUAL`), `status` (`REGISTERED` / `NOT_FOUND` / `SUSPENDED` / `DEREGISTERED`), `evidence_document_id`, `checked_by`.

**`supplier_settlements`** (the statement)
`id`, `supplier_id`, `agreement_id`, `period_start`, `period_end`, `subtotal`, `vat_amount`, `total`, `status` (`OPEN` → `PUBLISHED` → `ACCEPTED` / `DEEMED_ACCEPTED` / `DISPUTED` → `INVOICED` / `WITHHELD`), `published_at`, `acceptance_deadline_at`, **`supplier_acceptance_status`**, `accepted_at`, `accepted_by`, `acceptance_channel`; lines reference trips/bookings.

**`self_billed_invoices`** (a specialisation of `invoices` with `direction = PURCHASE`, `issued_on_behalf_of_supplier_id`)
`settlement_id` (unique), `agreement_id`, `zatca_approval_reference` (denormalised at issue), `invoice_number`, `invoice_uuid` (KSA-1), `invoice_hash`, `previous_invoice_hash`, `icv`, `transaction_code` (e.g. `0100011`), `clearance_status` (`PENDING_CLEARANCE` / `CLEARED` / `CLEARANCE_FAILED`), `cleared_at`, `zatca_response` (jsonb, redacted), `qr_code_data`, `xml_document_id`, `pdf_document_id`, `provider` (`WAFEQ_ZATCA_API` / …), **`wafeq_reference`**, `wafeq_status`, `wafeq_reported_ts`, `idempotency_key`, `delivered_to_supplier_at`, `delivery_channel`.

**`supplier_bills`** (ledger mirror)
`settlement_id`, **`wafeq_bill_id`**, `wafeq_contact_id`, `external_reference`, `bill_number`, `status`, `paid_at`, `wafeq_payment_id`.

**`invoice_corrections`** — `original_invoice_id`, `note_type` (`CREDIT` / `DEBIT`), `reason_code` (Art 40), `credit_note_reference`, same clearance/provider columns as above.

Never store: Wafeq `Api-Key`, Fatoora OTPs, private keys, CSR material — these live in the secrets manager only, and are never logged (brief §security constraints).

---

## 12. Final implementation recommendation

| # | Question | Answer |
|---|---|---|
| 1 | Does UniGate legally need Art 53(2) approval? | **Yes.** "Subject to the Authority's approval" is a condition precedent. **[LAW]** |
| 2 | Blanket or supplier-specific? | **Approval attaches to an agreement, and agreements are per supplier.** Whether one application can cover many agreements is undocumented — ask ZATCA (§9 Q1). Model per supplier either way |
| 3 | Approval for every invoice? | **No.** Once the arrangement is approved, invoices issue under it; the only per-invoice approval is the *supplier's*, via the agreed procedure |
| 4 | Official lead time? | **No statutory or officially published processing period was identified.** Apply now |
| 5 | Can one agreement cover recurring transactions? | **Yes** — that is its purpose; use monthly summary self-billed invoices (Art 53(4)) |
| 6 | Must the supplier be VAT-registered? | **Yes, both parties.** Unregistered subcontractors get a settlement statement, not a tax invoice, and yield no input credit |
| 7 | Can Wafeq Premium handle it? | **Not through the Public API UniGate uses today** (no self-billing on invoices; no ZATCA reporting on bills). **Possibly through the separately-sold Wafeq ZATCA API**, which exposes `SELF_BILLING`; the VAT-mismatch behaviour is undocumented |
| 8 | Confirm with Wafeq before development | §10 Q1 (VAT mismatch with `SELF_BILLING`), Q4 (is the ZATCA API in the contract), Q5 (device/chain), Q7 (simulation) |
| 9 | Integrate with Wafeq or directly with ZATCA? | **Wafeq first**, behind `EInvoicingProvider`, for both sales and self-billed documents if §10 Q1 is yes. Direct (second EGS device, any KSA-2-capable adapter) **only** for the self-billed leg if Wafeq says no. Never move the sales leg |
| 10 | Implement first | (1) Wafeq confirmation and ZATCA application **this week** — both are waits, not work. (2) Supplier VAT verification + `self_billing_agreements` + settlement acceptance workflow — needed under any provider. (3) Provider adapter against Wafeq simulation. (4) Production self-billing only with an approval reference on file |

## 13. Risks and open items

| Risk | Mitigation |
|---|---|
| ZATCA approval takes longer than the settlement cycle needs | Keep supplier-issued e-invoices as the running path until approval; agreement §5 makes self-billing conditional |
| ZATCA requires per-agreement approval and UniGate has dozens of suppliers | Template agreement + batched applications; onboarding tier "self-billing eligible" only after approval |
| Wafeq ZATCA API rejects supplier VAT ≠ account VAT | Fallback §8.2 — second EGS device, KSA-2-capable adapter |
| Supplier deregisters mid-period | Verification before every issue; agreement auto-suspends; withheld settlement re-issued as statement without VAT |
| Supplier issues its own invoice despite undertaking | Detect via supplier portal declaration + reconciliation of supplier VAT returns is impossible from outside; contractually require credit-note cancellation; treat duplicates as breach |
| Self-billed invoices pollute UniGate's own sales chain | Acceptable (one chain per device is the rule) — or a dedicated device if Wafeq offers it (§10 Q5) |
| Zero-rated international legs under self-billing | Supplier must supply evidence before the line is zero-rated; default standard rate (OQ-27) |
| Art 47(3) deemed-supplier and 53(2) interplay for a *platform* | For registered owners, 53(2) is the input-side document under [ADR-008](../decisions/ADR-008-vat-operating-model.md); for unregistered owners nothing is self-billed. Advisor to confirm the two rules coexist as described (OQ-24) |

## 14. Revenue and thresholds — the two things not to conflate

**A. VAT registration.** Mandatory at SAR 375,000 of annual taxable supplies; voluntary from SAR 187,500 of supplies *or expenses* (Implementing Regulations Art 7). UniGate at ~SAR 510,000 is above the mandatory line — hence registered. **[LAW]**

**B. E-invoicing Integration Phase waves.** Set by ZATCA per wave on *VAT-taxable revenue in specified historic years*, not by the registration threshold: Wave 24 = > SAR 375,000 in 2022, 2023 **or** 2024, deadline **30 June 2026** ([ZATCA news](https://zatca.gov.sa/en/Pages/news_1426.aspx)); Wave 25 = > SAR 187,500 in 2022–2025, deadline **1 February 2027** ([ZATCA news](https://zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx)). No Wave 26 announced as of the research date. **[ZATCA]** ZATCA notifies targeted taxpayers directly; **a notification held by UniGate governs over any reading of the criteria.**

**For UniGate this is now moot:** the statement that Wafeq is already connected to Fatoora and issuing UniGate's sales invoices means UniGate is *already integrated*. OQ-04's remaining sub-question closes; AR-11 downgrades to "confirm the Wafeq device is registered in **production**, not simulation, and that every sales invoice since the wave date was cleared/reported through it".

## 15. Sources

**Legislation**
- Implementing Regulations of the VAT Law, ZATCA English translation, 8th ed. 09/11/2021 — Arts 7, 49(7), 53(2)–(5), 66. <https://zatca.gov.sa/en/RulesRegulations/Taxes/Documents/Implmenting%20Regulations%20of%20the%20VAT%20Law_EN.pdf>
- 2025 amendments (Board Resolution 01-06-24, gazetted 18 Apr 2025) — EY summary <https://www.ey.com/en_gl/technical/tax-alerts/saudi-arabia-approves-amendments-to-vat-implementing-regulations>; Sovos on proposed Art 53(10) <https://sovos.com/blog/vat/proposed-amendments-to-saudi-arabias-vat-implementation-regulations-vatir-what-is-changing/>

**ZATCA e-invoicing**
- E-invoicing Detailed Technical Guideline v2, Nov 2022 — §4 Clearance, self-billing submitted by buyer, agreement approved by ZATCA. <https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf>
- Detailed Guidelines for E-Invoicing v2, May 2023 — §1.5, §3.1 scope includes customer/third party issuing on behalf. <https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf>
- Electronic Invoice XML Implementation Standard v1.2, May 2023 — §5.3 invoice indicators, §11.2.1 type codes, BR-KSA-06, BR-KSA-31. <https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf>
- Fatoora developer community, "Self Billing Errors" — ZATCA staff on party mapping and `SELF_BILLED_VALIDATION`. <https://zatca1.discourse.group/t/self-billing-errors/4491>
- Wave 24 criteria <https://zatca.gov.sa/en/Pages/news_1426.aspx>; Wave 25 criteria <https://zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx>

**Wafeq**
- Public API index <https://developer.wafeq.com/llms.txt>; Public vs ZATCA API <https://developer.wafeq.com/docs/wafeq-public-api-vs-zatca-api>; reliable-integration guide <https://developer.wafeq.com/docs/design-a-reliable-integration>; invoice report endpoint <https://developer.wafeq.com/reference/invoices_tax_authority_report_create>; invoices/bills schemas <https://developer.wafeq.com/reference/invoices_create>, <https://developer.wafeq.com/reference/bills_create>
- ZATCA API index <https://zatca.wafeq.com/llms.txt>; report invoice schema (`indicators` enum) <https://zatca.wafeq.com/reference/invoices_report_create>; platforms / connected accounts <https://zatca.wafeq.com/docs/for-platforms-or-white-label>; quickstart <https://zatca.wafeq.com/docs/report-a-simplified-invoice-to-zatca>
- Plan requirement for Phase 2 connection <https://www.wafeq.com/en-sa/wafeq-help/e-invoicing-ksa/setting-up-e-invoicing-phase-2-with-wafeq>

**Secondary**
- ClearTax, ZATCA portal overview (mentions an approval form for self/third-party invoices) <https://www.cleartax.com/sa/all-about-zatca-gov-sa-portal>
