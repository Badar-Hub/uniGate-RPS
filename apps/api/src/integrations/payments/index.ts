import { config } from '@/config/index.js';
import type { PaymentGateway } from './gateway.js';
import { MockGateway } from './mock.gateway.js';

/**
 * Gateway registry. One adapter per provider code; the active one comes from PAYMENT_PROVIDER.
 * Adding the real provider (OQ-03) means one class implementing the port and one line here.
 */
let active: PaymentGateway | null = null;

export function paymentGateway(): PaymentGateway {
  if (active) return active;
  const cfg = config();
  switch (cfg.providers.payment) {
    case 'mock':
      active = new MockGateway({ checkoutBaseUrl: `${cfg.appUrl}/pay/mock`, webhookSecret: cfg.crypto.paymentWebhookSecret ?? `mock-webhook-secret-${cfg.crypto.otpPepper.slice(0, 8)}` });
      return active;
    case 'hyperpay':
    case 'moyasar':
    case 'paytabs':
    case 'checkout':
      // Deliberately not implemented: no real integration exists until UniGate selects a provider (ADR-005, OQ-03).
      throw new Error(`payment provider "${cfg.providers.payment}" has no adapter yet (OQ-03)`);
  }
}

/** Resolve a webhook route's :provider against the registry (only the active adapter answers). */
export function gatewayByCode(code: string): PaymentGateway | null {
  const g = paymentGateway();
  return g.code === code ? g : null;
}

/** The mock's scripting surface, present only when the mock is the active gateway. */
export function mockGateway(): MockGateway | null {
  const g = paymentGateway();
  return g instanceof MockGateway ? g : null;
}

export function setPaymentGatewayForTests(g: PaymentGateway | null): void {
  active = g;
}
