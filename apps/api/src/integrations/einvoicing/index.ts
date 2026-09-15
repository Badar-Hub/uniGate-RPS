import { config } from '@/config/index.js';
import { MockClearanceProvider } from './mock.provider.js';
import type { EInvoicingProvider } from './provider.js';

/**
 * Provider registry. `none` means the platform issues plain invoices with clearanceStatus
 * NOT_REQUIRED — no chain, no authority, nothing claimed. `mock` exercises the full flow outside
 * production. A certified adapter is one class implementing the port and one case here (ADR-007).
 */
let active: EInvoicingProvider | null | undefined;

export function einvoicingProvider(): EInvoicingProvider | null {
  if (active !== undefined) return active;
  switch (config().providers.einvoicing) {
    case 'none':
      active = null;
      return active;
    case 'mock':
      active = new MockClearanceProvider();
      return active;
  }
}

export function mockClearanceProvider(): MockClearanceProvider | null {
  const p = einvoicingProvider();
  return p instanceof MockClearanceProvider ? p : null;
}

export function setEInvoicingProviderForTests(p: EInvoicingProvider | null | undefined): void {
  active = p;
}
