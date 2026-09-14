# ADR-005 — Payment gateway abstraction with persist-then-process webhooks

**Status:** Accepted
**Date:** 2026-09-14

## Context

RFP §3 requires Mada, Visa, MasterCard, STC Pay and Apple Pay. It names **no gateway**, and UniGate has not confirmed a merchant account or acquirer (**OQ-03**).

The engagement brief is explicit (§17, §49): *do not create fake direct integrations*, and *never trust payment success reported by the frontend*.

## Decision

1. **A `PaymentGateway` interface** with `createPayment`, `getPaymentStatus`, `refundPayment`, `processWebhook`. No provider SDK type appears in any service signature.
2. **A `MockGateway` for development** that implements the interface *fully* — including signed webhook callbacks and scriptable failure modes.
3. **No production adapter is written** until a provider is selected.
4. **Webhooks: verify signature → persist → return 200 → process asynchronously.**
5. **Payment success is established only by the gateway**, never by the client.
6. **Gateway tokens only.** No PAN, CVV or cardholder data ever enters UniGate systems.

## Rationale

### Interface first, adapter later

The provider decision is commercial (fees, settlement terms, supported methods, onboarding time) and outside engineering's control. Building payment *orchestration* — state machine, idempotency, reconciliation, refund rules, ledger postings — behind an interface means the whole flow is built and tested now, and adapting to the chosen provider is one class implementing four methods. Estimated one to two weeks once OQ-03 is answered.

Writing a speculative adapter for a provider that may not be chosen would be wasted effort and, worse, would create the false impression that payments work.

### `MockGateway` is a real implementation, not a stub

It is a *development* gateway, not a pretend production one. It implements the complete interface including HMAC-signed webhook callbacks to the real webhook endpoint, and supports scripted outcomes: success, decline, timeout, duplicate delivery, out-of-order delivery, invalid signature.

The entire payment path — including the webhook pipeline, idempotency and every failure branch — is therefore exercised end-to-end in automated tests. This is the difference between a mock that hides bugs and one that finds them.

### Persist-then-process

```
provider → POST /webhooks/payments/:provider
  1. verify signature          → invalid ⇒ persist, alert, DO NOT process
  2. INSERT payment_webhook_events
       UNIQUE (provider_code, provider_event_id) ⇒ duplicate returns 200 immediately
  3. return 200                (fast — before any business logic)
  4. BullMQ job processes      → payment PAID → booking CONFIRMED → ledger postings
```

Each step exists for a reason:

- **Signature first.** An unverified webhook is an unauthenticated request claiming money moved. Invalid-signature events are *stored and alerted on*, never discarded — a forged webhook is evidence of an attack in progress, not noise.
- **Persist before processing.** A crash mid-processing loses nothing; the event is durable and the job retries.
- **Fast 200.** Gateways retry aggressively on slow responses. Doing business logic before responding causes duplicate deliveries and, eventually, timeouts that look like failures to the provider.
- **Idempotency as a unique constraint.** `UNIQUE (provider_code, provider_event_id)` makes duplicate delivery structurally harmless. It cannot be forgotten the way an `if (alreadyProcessed)` check can.

### Never trust the client

The browser returning to a success URL updates nothing. It triggers a *status poll*; the state change comes from the webhook or a server-side `getPaymentStatus` call. A client POST claiming `status: PAID` is ignored — not validated, ignored.

This is the single most commonly exploited flaw in e-commerce implementations, and it is prevented by making the client's report structurally incapable of changing payment state.

### Tokens only

Saved payment methods store the **gateway's token**, brand and last four digits. Nothing else. No PAN, no CVV, no expiry beyond what the gateway returns for display.

This typically places the platform in PCI-DSS SAQ-A scope, but **scope must be confirmed with the chosen acquirer** — no compliance is claimed here (see [security.md](../security.md)).

Additionally, `payment_transactions.request_payload_redacted` / `response_payload_redacted` pass through the shared redaction allow-list before storage. Provider payloads routinely contain fragments that should never be persisted, and "we'll just store the raw response for debugging" is how card data ends up in a database.

## Consequences

**Positive:** provider-independent; the full flow including failure modes is testable today; webhook handling is correct by construction; no fabricated integration; refunds, reconciliation and ledger postings are built and proven before the provider exists.

**Negative:** production payments are blocked on OQ-03 (risk AR-2); the chosen provider may expose a capability the interface does not model, requiring extension; `MockGateway` must be rigorously prevented from being enabled outside development — enforced by environment validation that refuses to boot a production configuration with the mock provider selected.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Pick a provider now and integrate directly | The choice is UniGate's, not engineering's. A wrong guess is wasted work plus a misleading impression of readiness |
| Stripe-style provider-agnostic aggregator | Mada and STC Pay coverage in KSA is the deciding factor and is provider-specific; the abstraction belongs in our code |
| Synchronous webhook processing | Slow responses cause provider retries and duplicate processing; a crash mid-processing loses the event |
| Trust the client's success callback and verify later | The classic exploitable flaw. Non-negotiable |
| Store raw provider payloads unredacted "for debugging" | Risks persisting cardholder data and provider secrets |
