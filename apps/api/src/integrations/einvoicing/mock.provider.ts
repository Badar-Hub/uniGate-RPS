import { createHash } from 'node:crypto';
import { ClearanceProviderError, type ClearanceResult, type EInvoiceDocument, type EInvoicingProvider } from './provider.js';

/**
 * Development/test stand-in for the clearance authority. Accepts every well-formed document,
 * echoes a reference derived from the hash, and can be scripted per invoice number to reject or
 * to be unavailable so the retry path is exercised. Forbidden in production by env validation.
 */
export class MockClearanceProvider implements EInvoicingProvider {
  readonly code = 'mock';
  private readonly scripted = new Map<string, 'REJECT' | 'UNAVAILABLE'>();

  script(invoiceNumber: string, outcome: 'REJECT' | 'UNAVAILABLE' | null): void {
    if (outcome) this.scripted.set(invoiceNumber, outcome);
    else this.scripted.delete(invoiceNumber);
  }

  private outcome(doc: EInvoiceDocument, status: 'CLEARED' | 'REPORTED'): ClearanceResult {
    const s = this.scripted.get(doc.invoiceNumber);
    if (s === 'UNAVAILABLE') throw new ClearanceProviderError('mock authority unavailable', true);
    if (s === 'REJECT') return { status: 'REJECTED', providerReference: null, clearedXml: null, errorCode: 'MOCK_REJECTED', responseRedacted: { provider: 'mock', outcome: 'REJECTED', invoiceNumber: doc.invoiceNumber } };
    if (!/^3[0-9]{13}3$/.test(doc.sellerVatNumber)) return { status: 'REJECTED', providerReference: null, clearedXml: null, errorCode: 'SELLER_VAT_INVALID', responseRedacted: { provider: 'mock', outcome: 'REJECTED' } };
    const ref = `MOCK-${createHash('sha256').update(doc.invoiceHash).digest('hex').slice(0, 16).toUpperCase()}`;
    // The "cleared" artefact is the canonical document countersigned by the mock — enough to make the "serve the authority copy" rule testable.
    const clearedXml = status === 'CLEARED' ? Buffer.from(`<MockCleared ref="${ref}">${doc.canonical}</MockCleared>`, 'utf8') : null;
    return { status, providerReference: ref, clearedXml, errorCode: null, responseRedacted: { provider: 'mock', outcome: status, reference: ref, invoiceNumber: doc.invoiceNumber } };
  }

  clear(doc: EInvoiceDocument): Promise<ClearanceResult> {
    return Promise.resolve(this.outcome(doc, 'CLEARED'));
  }
  report(doc: EInvoiceDocument): Promise<ClearanceResult> {
    return Promise.resolve(this.outcome(doc, 'REPORTED'));
  }
}
