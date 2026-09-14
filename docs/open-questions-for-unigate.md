# UniGate — Questions Requiring Business Confirmation

**From:** Delivery team
**Date:** 2026-09-14
**Re:** Vehicle Hiring & Management Platform — design review, prior to development

---

## Why we are asking

The RFP sets out the scope of the platform clearly. It does not set out the **business rules** the platform must apply — the commission rate, what happens when a customer cancels, when owners get paid, how long owners have to bid. That is entirely normal for an RFP, but these rules have to be decided before they can be built.

We have designed the system so that every one of these is **configuration rather than code**, and we have recorded a working assumption for each so that design work was not held up. None of the values below is a decision UniGate has made — they are placeholders we chose, and we would rather be corrected now than after the platform is live.

Nineteen questions follow, grouped by how soon we need the answer.

---

## Answered on 14 September 2026 — thank you

Two of the four blocking questions are resolved and the design has been updated.

**Partial fulfilment (was Q2).** Confirmed: take the order even when not all vehicles are available, dispatch what exists, and supply the balance later. The order stays open until fully fulfilled. We have built this as a per-order option rather than universal behaviour, because it is right for cargo but wrong for simultaneous-need passenger work — 5 buses for a 07:00 shuttle cannot usefully arrive as 2 today and 3 tomorrow. Goods orders default to allowing waves; passenger orders default to all-or-nothing, and the customer can change it.

**Corporate invoicing (was Q3).** Confirmed: corporates are invoiced rather than charged per booking. Their bookings now confirm immediately against an approved credit limit instead of waiting for payment, and one invoice covers many bookings over a billing period.

**Three follow-up questions arise from these answers — questions 3, 4 and 5 below.** Question 3 (owner settlement timing) is a working-capital decision we would like to raise early.

**These two answers have unblocked development**, and build work on the foundation, accounts and fleet modules can now begin.

---

## Group A — Commercial and contractual

Neither of these blocks build work, but both affect what UniGate earns and what this engagement is contracted to deliver, so they should be settled early rather than discovered late.

### 1. Platform commission (OQ-01)

**Question.** What does UniGate charge? A percentage or a fixed fee? What rate? Is it charged on the total the customer pays including VAT, or on the amount excluding VAT? Does the rate vary by vehicle type or by owner?

**Why it matters.** This is UniGate's revenue line and it determines what every vehicle owner is paid. We freeze the commission calculation onto each booking permanently, so that changing the rate later never rewrites historical earnings. That protection also means bookings taken under a placeholder rate keep it — they cannot be corrected afterwards without a data migration and restated owner statements.

**Our working assumption.** 10% of the amount excluding VAT, applied globally, with the ability to override per owner and per vehicle category.

---

### 2. Mobile applications — scope (OQ-14)

**Question.** The RFP (§5) lists Android and iOS applications as a deliverable. The written brief we received defers mobile out of the first phase. Which reflects the agreement?

**Why it matters.** This is a contractual point rather than a technical one, and we would rather raise it than assume. It affects timeline, cost and what "complete" means at the end of this engagement.

**Our position.** We are building web first, and we are deliberately keeping the API independent of the web application so that mobile apps can be built against it later without rework. We are **not** building mobile applications in this engagement unless you tell us otherwise.

---

## Group B — Needed within the next few weeks

These do not block current work but have long lead times, so late answers become delays.

### 3. Do vehicle owners wait for the corporate customer to pay? (OQ-20)

**Question.** Owners are currently planned to be paid weekly. Corporate customers will now pay on invoice, typically 30 days later. Which of these is intended?

- **UniGate pays owners weekly regardless.** Owners are happy; UniGate funds roughly a month of corporate revenue out of its own working capital, permanently.
- **Owners wait until the customer pays.** No funding requirement; but owners earn markedly less predictably on corporate work than on retail work, which may push good operators towards retail jobs.

**Why it matters.** This is the most significant consequence of the invoicing decision and it is a treasury question rather than a software one. The amount of capital involved scales directly with corporate volume. We can build either, but the choice should be deliberate rather than inherited from a default.

**Our working assumption.** Owners are settled weekly regardless — UniGate carries the receivable.

---

### 4. Corporate billing cycle and credit approval (OQ-19, OQ-21)

**Question.** What is the billing cycle — monthly in arrears? What payment term — 30 days? Who approves a corporate credit limit, and what happens when a customer exceeds it or goes overdue: block new bookings outright, allow with manual approval, or warn only?

**Why it matters.** A hard block protects UniGate from bad debt; a soft warning protects the customer relationship. Whichever you choose will be enforced at the moment a booking is awarded, so it needs to be the behaviour you actually want in front of a customer.

**Our working assumption.** Monthly in arrears, 30-day terms, credit limits set by an administrator, and an award blocked if it would exceed the limit.

---

### 5. Filling the balance of a partly-fulfilled order (OQ-22, OQ-23)

**Question.** Two parts. First — when only some vehicles are supplied, how long does the balance stay open? Indefinitely until the customer closes it, or with a deadline? Second — when more vehicles become available, does the customer approve each additional vehicle and its price, or may UniGate dispatch against the open balance without going back to them?

**Why it matters.** Your description ("we should be able to take this order and dispatch") suggests your operations team may fill the balance directly. That is a reasonable way to work, but it means UniGate is committing the customer to additional vehicles and additional cost without a fresh approval — so it should be an explicit policy rather than a side effect. Later waves are separately priced and may cost more than the first.

**Our working assumption.** The balance stays open until the customer closes it, with a reminder after 7 days; the customer approves each additional vehicle, and an administrator may approve on their behalf with an audit record.

---

### 6. Payment gateway (OQ-03)

**Question.** Which payment provider will UniGate use, and is a merchant account already in place? Which of the five methods named in the RFP — Mada, Visa, MasterCard, STC Pay, Apple Pay — are actually contracted?

**Why it matters.** Merchant onboarding in Saudi Arabia typically takes several weeks and is outside our control, so this sits on the critical path. Not every provider offers STC Pay and Apple Pay. We have built the payment system so that connecting a provider is roughly one to two weeks of work once chosen — but we cannot start until it is.

**Current state.** A simulated gateway is used for development and testing. No real payment integration exists, and we have not pretended otherwise.

---

### 7. E-invoicing / ZATCA (OQ-04)

**Question.** Is UniGate subject to ZATCA e-invoicing (Fatoora), and at which phase? When a customer hires a vehicle, who issues the tax invoice — UniGate, or the vehicle owner?

**Why it matters.** **This is the item we would most like answered early.** Phase 2 e-invoicing requires invoices to be cryptographically stamped and cleared with ZATCA before issue. That cannot be applied retrospectively to invoices already sent to customers. The second half of the question — who is the seller — determines where VAT liability sits for the whole marketplace, and changes the financial model rather than just the software.

**This needs a tax advisor, not a developer.** We have reserved the necessary fields but have implemented nothing and claim no compliance.

---

### 8. Cancellation and refunds (OQ-05)

**Question.** If a customer cancels, what fee applies and how does it vary with notice given? What if the owner or driver cancels, or simply does not arrive? How quickly are refunds issued, and who approves them?

**Why it matters.** This decides money taken from customers and withheld from owners, and it is the single most common source of disputes on platforms of this kind. It is also the policy customers will read most closely.

**Our working assumption.** We snapshot whichever rule was in force onto each cancellation, so tiers can be introduced at any time without invalidating past cancellations. **No tiers are currently set.**

---

### 9. Owner settlement (OQ-06)

**Question.** How often are vehicle owners paid — weekly, fortnightly, monthly? Is there a holding period after a trip completes? A minimum payout amount? How does the money reach them — bank transfer, or through the payment provider?

**Why it matters.** Payment timing is the most common reason small operators leave a platform, so it is a commercial decision as much as a technical one. It also determines how much money UniGate holds at any time.

**Our working assumption.** Weekly, Sunday cut-off, three days after trip completion, no minimum.

---

### 10. Data hosting and PDPL (OQ-12)

**Question.** Where will the platform be hosted? Has UniGate taken advice on whether the Saudi Personal Data Protection Law requires personal data to remain inside the Kingdom?

**Why it matters.** This is a legal determination that constrains which cloud provider and region can be used. Moving hosting after production data exists is a migration with downtime. We have kept the platform provider-independent so the decision stays open, but it must be made before launch.

**We make no compliance claim.** This needs legal review.

---

## Group C — Needed before the relevant feature is built

### 11. Bidding window (OQ-02)

How long do owners have to bid, and how long does a submitted quote stay valid?
*Assumed: bidding closes 2 hours before pickup or 24 hours after the request, whichever is sooner; quotes valid 24 hours.*

### 12. Approval process (OQ-07)

Who approves new owners, drivers and vehicles? What documents are mandatory? Is there a turnaround commitment? Does a renewed document require re-approval?
*Assumed: manual admin approval, no stated turnaround, renewed documents are re-verified but do not trigger full re-approval.*

### 13. SMS provider (OQ-10)

Which provider will send verification codes, and is a sender ID registered with the CITC?
*Note: customers cannot register without SMS verification, so this gates public launch. Registration has lead time.*

### 14. GPS hardware (OQ-11)

Will vehicles use dedicated tracking devices, or is the driver's phone sufficient at launch? If devices, which vendor?
*Assumed: driver's phone at launch. Hardware can be added later without redesign.*

### 15. Transport licensing (OQ-13)

Does the platform, or do the vehicle owners, require Transport General Authority licensing? Must we verify and record operator permits?
*Assumed: not modelled beyond general document upload. Needs legal review.*

### 16. Drivers and vehicles (OQ-18)

Can a driver join independently with their own vehicle, or only as part of a registered owner's fleet?
*Assumed: only owners bid; an owner who drives their own vehicle is supported.*

### 17. SPO commissions (OQ-09)

The RFP mentions Sales Promotion Officers once, in passing, with no rules. What does an SPO earn, on what — a converted customer, every booking they introduce, a first booking only? Is it clawed back if the customer is refunded?

*This is the least-specified area of the entire scope.* We have built the tracking that records which SPO introduced which customer and booking, and reporting on it. **No commission is calculated**, because there is no rule to apply. Please advise whether SPO commission is needed for launch.

### 18. Data retention (OQ-08)

How long should we keep audit logs, GPS location history, identity documents after an account closes, and financial records?
*Assumed: audit 24 months, location history 12 months, documents 12 months after closure, financial records 10 years. Commercial record-keeping law and data protection law pull in opposite directions here, so this needs legal input.*

### 19. Scale and service levels (OQ-15)

How many users, vehicles and bookings do you expect in year one? What uptime is expected? Are there seasonal peaks — Hajj, Umrah, school terms?

**Why it matters.** The RFP sets no performance or availability targets. Every such figure in our design is our own proposal, and cannot be treated as an agreed service level until you confirm it. It also drives hosting cost.

*Assumed: 10,000 users, 2,000 vehicles, 500 bookings a day, 200 vehicles tracked at once, 99.5% uptime.*

---

## What happens next

Development is **no longer paused** — the two answers given on 14 September resolved everything that was blocking the database design, and foundation work has begun.

The remaining questions are needed before the phase each one affects is finished, not before work starts. In rough order of when we need them: questions 3, 6 and 7 within a few weeks; questions 1, 4, 8 and 9 before payments and finance are completed; the rest as they come up.

If it is easier, we are happy to walk through these on a call — several are quicker to resolve in conversation than in writing, particularly the commission, cancellation and settlement questions, which interact with each other.

Full technical detail for every item is in [assumptions.md](assumptions.md) and [requirements-analysis.md](requirements-analysis.md).
