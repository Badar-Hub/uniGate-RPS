/**
 * The e-invoicing port (ADR-007). The invoice service builds the canonical document, chains the
 * hash and the counter, and hands the document to the provider for clearance (standard tax
 * invoices — blocking) or reporting (simplified — after issue). Nothing here claims compliance:
 * the port shapes the flow so a certified integration can be dropped in without a schema change.
 *
 * Credentials, cryptographic stamps and raw authority responses stay inside the adapter and the
 * database; no DTO ever carries them.
 */

export interface EInvoiceDocument {
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: 'TAX_INVOICE' | 'SIMPLIFIED_TAX_INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  einvoiceUuid: string;
  icv: number;
  invoiceHash: string;
  previousInvoiceHash: string;
  sellerVatNumber: string;
  buyerVatNumber: string | null;
  issueDate: string;
  supplyDate: string;
  totalAmount: string;
  vatAmount: string;
  currency: string;
  /** Canonical JSON the hash was computed over; a certified adapter would build UBL 2.1 XML from it. */
  canonical: string;
}

export interface ClearanceResult {
  status: 'CLEARED' | 'REPORTED' | 'REJECTED';
  providerReference: string | null;
  /** Authority-returned artefact (cleared XML) as bytes, when the flow produces one. */
  clearedXml: Buffer | null;
  errorCode: string | null;
  /** Redacted response for the audit trail — never a stamp, never a credential. */
  responseRedacted: Record<string, unknown>;
}

export class ClearanceProviderError extends Error {
  constructor(message: string, readonly transient: boolean) {
    super(message);
    this.name = 'ClearanceProviderError';
  }
}

export interface EInvoicingProvider {
  readonly code: string;
  /** Standard tax invoice: cleared BEFORE the document may be given to the buyer. */
  clear(doc: EInvoiceDocument): Promise<ClearanceResult>;
  /** Simplified tax invoice: issued first, reported afterwards. */
  report(doc: EInvoiceDocument): Promise<ClearanceResult>;
}
