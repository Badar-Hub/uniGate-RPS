import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, ClearanceQueueItemDto, InvoiceDto, InvoiceGenerateResultDto, InvoiceLineDto } from '@unigate/types';
import type { creditNoteBody, debitNoteBody, generateInvoicesBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError, NotImplementedError, ServiceUnavailableError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { Decimal, money, round2, round4, toMoneyString, vatOn } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { einvoicingProvider } from '@/integrations/einvoicing/index.js';
import { ClearanceProviderError, type EInvoiceDocument } from '@/integrations/einvoicing/provider.js';
import { logger } from '@/logging/logger.js';
import { creditExposureOf } from '@/modules/bookings/booking.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { invoiceBuyerOf, type InvoiceBuyer } from '@/modules/profiles/customer.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { verticalFor } from '@/verticals/registry.js';
import { toInvoiceDto, toInvoiceLineDto } from './finance.mapper.js';
import { postLedger } from './ledger.service.js';
import * as repo from './invoice.repository.js';

/**
 * Customer invoices (api.md §8.19, database.md §12.6–12.7, ADR-007). One code path, two
 * triggers: a single COMPLETED booking (the PREPAID/ad-hoc case) or a billing cycle consolidating
 * every unbilled INVOICED booking of a customer. The type is resolved from the buyer's VAT
 * registration at issue time; numbers and the ICV chain are minted inside the transaction under an
 * advisory lock; a standard tax invoice is undeliverable until the provider clears it. Nothing here
 * claims compliance — the provider port is where a certified integration lands (OQ-04).
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}
const systemScope: AnyScope = { kind: 'SYSTEM', jobName: 'invoicing', requestId: 'internal' };
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const utcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

interface Seller {
  vatNumber: string;
  nameEn: string;
  nameAr: string;
}
async function seller(): Promise<Seller> {
  const [vatNumber, nameEn, nameAr] = await Promise.all([getSettingValue<string>('finance.seller_vat_number', ''), getSettingValue<string>('finance.seller_name_en', ''), getSettingValue<string>('finance.seller_name_ar', '')]);
  if (!/^3[0-9]{13}3$/.test(vatNumber)) throw new BusinessRuleError('INVOICE_SELLER_VAT_NOT_CONFIGURED', 'finance.seller_vat_number is not set; no invoice can be issued until UniGate’s VAT registration is configured');
  return { vatNumber, nameEn: nameEn || 'UniGate', nameAr: nameAr || 'يونيغيت' };
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function getInvoice(scope: AnyScope, id: string): Promise<InvoiceDto> {
  const row = await repo.findInvoice(scope, id);
  if (!row) throw new NotFoundError();
  return toInvoiceDto(row, await repo.lastClearanceError(scope, id));
}

export async function listInvoices(scope: AnyScope, f: repo.InvoiceFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listInvoices(scope, f, page);
  return { items: items.map((i) => toInvoiceDto(i, null)), total };
}

export async function listLines(scope: AnyScope, id: string, page: { page: number; pageSize: number }): Promise<{ items: InvoiceLineDto[]; total: number }> {
  const r = await repo.listLines(scope, id, page);
  if (!r) throw new NotFoundError();
  return { items: r.items.map(toInvoiceLineDto), total: r.total };
}

/** Delivery gates shared by pdf-url and xml (api.md §8.19 consequence 2). */
function assertDeliverable(inv: repo.InvoiceRow): void {
  if (inv.clearanceStatus === 'PENDING' && inv.invoiceType !== 'SIMPLIFIED_TAX_INVOICE') throw new ConflictError('INVOICE_NOT_CLEARED', 'The invoice has not been cleared yet; there is no correct document to serve');
  if (inv.clearanceStatus === 'REJECTED') throw new BusinessRuleError('INVOICE_CLEARANCE_REJECTED', 'Clearance was rejected; void the invoice and re-issue');
}

export async function pdfUrl(scope: AnyScope, id: string): Promise<never> {
  const inv = await repo.findInvoice(scope, id);
  if (!inv) throw new NotFoundError();
  assertDeliverable(inv);
  // Rendering (PDF from the cleared artefact) is not wired: the portal renders the invoice from the DTO and prints it.
  throw new NotImplementedError('INVOICE_RENDERING_NOT_AVAILABLE', 'PDF rendering lands with the document pipeline; the portal prints the invoice from its lines');
}

export async function xmlUrl(scope: AnyScope, id: string): Promise<never> {
  const inv = await repo.findInvoice(scope, id);
  if (!inv) throw new NotFoundError();
  if (inv.clearanceStatus === 'NOT_REQUIRED') throw new NotFoundError('NOT_FOUND', 'No XML exists for an invoice that was never submitted');
  assertDeliverable(inv);
  throw new NotImplementedError('INVOICE_RENDERING_NOT_AVAILABLE', 'The cleared XML is retained by the provider integration; serving it lands with the certified adapter');
}

// ── the builder ──────────────────────────────────────────────────────────────

interface LineDraft {
  lineType: 'ORDER' | 'BOOKING' | 'ADJUSTMENT' | 'PENALTY' | 'DISCOUNT';
  tripRequestId: string | null;
  bookingId: string | null;
  bookingIds: string[];
  descriptionEn: string;
  descriptionAr: string;
  netAmount: Decimal;
  vatRate: Decimal;
  vatAmount: Decimal;
  totalAmount: Decimal;
  vatCategory: 'S' | 'Z' | 'E' | 'O';
}

/** Wording and VAT category come from the vertical that carried the load (ADR-010); the core never phrases a line itself. */
function describe(b: repo.BillableBooking, group: repo.BillableBooking[], granularity: 'ORDER' | 'BOOKING'): { text: { en: string; ar: string }; vatCategory: 'S' | 'Z' | 'E' | 'O' } {
  const v = verticalFor(b.transportType).invoice;
  const shape = { bookingNumber: b.bookingNumber, requestNumber: b.requestNumber, vehicleDescription: b.vehicleDescriptionSnapshot, pickupAddressLine: b.pickupAddressLine, dropoffAddressLine: b.dropoffAddressLine, scheduledStartAt: b.scheduledStartAt, vehicleCount: group.length };
  return { text: v.lineDescription(shape, granularity), vatCategory: v.vatCategory(shape) };
}

function linesFor(bookings: repo.BillableBooking[], granularity: 'ORDER' | 'BOOKING'): LineDraft[] {
  if (granularity === 'BOOKING') {
    return bookings.map((b) => {
      const d = describe(b, [b], 'BOOKING');
      return { lineType: 'BOOKING' as const, tripRequestId: null, bookingId: b.id, bookingIds: [b.id], descriptionEn: d.text.en, descriptionAr: d.text.ar, netAmount: b.totalAmount.sub(b.vatAmount), vatRate: b.vatRate, vatAmount: b.vatAmount, totalAmount: b.totalAmount, vatCategory: d.vatCategory };
    });
  }
  const byRequest = new Map<string, repo.BillableBooking[]>();
  for (const b of bookings) byRequest.set(b.tripRequestId, [...(byRequest.get(b.tripRequestId) ?? []), b]);
  return [...byRequest.entries()].flatMap(([tripRequestId, group]) => {
    const first = group[0];
    if (!first) return [];
    const total = group.reduce((a, b) => a.add(b.totalAmount), new Decimal(0));
    const vat = group.reduce((a, b) => a.add(b.vatAmount), new Decimal(0));
    const d = describe(first, group, 'ORDER');
    return [{ lineType: 'ORDER' as const, tripRequestId, bookingId: null, bookingIds: group.map((b) => b.id), descriptionEn: d.text.en, descriptionAr: d.text.ar, netAmount: total.sub(vat), vatRate: first.vatRate, vatAmount: vat, totalAmount: total, vatCategory: d.vatCategory }];
  });
}

/** ZATCA phase-1 style TLV (tags 1–5) base64 — the payload printed as the invoice QR. Format only; no compliance is claimed. */
function qrTlv(sellerName: string, vatNumber: string, at: Date, total: Decimal, vat: Decimal): string {
  const tlv = (tag: number, value: string) => {
    const v = Buffer.from(value, 'utf8');
    return Buffer.concat([Buffer.from([tag, v.length]), v]);
  };
  return Buffer.concat([tlv(1, sellerName), tlv(2, vatNumber), tlv(3, at.toISOString()), tlv(4, total.toFixed(2)), tlv(5, vat.toFixed(2))]).toString('base64');
}

interface HeaderInput {
  invoiceType: 'TAX_INVOICE' | 'SIMPLIFIED_TAX_INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  buyer: InvoiceBuyer;
  correctsInvoiceId: string | null;
  billingPeriod: { start: Date; end: Date } | null;
  granularity: 'ORDER' | 'BOOKING';
  supplyDate: Date;
  dueDate: Date;
  lines: LineDraft[];
  currency: string;
  /** false for a credit note: nothing is owed on the note itself. */
  payable: boolean;
}

/** Writes the header, lines and links; mints number/ICV/hash; returns the row (status DRAFT, postings not yet made). */
async function writeInvoice(scope: AnyScope, s: Seller, h: HeaderInput, tx: Prisma.TransactionClient): Promise<repo.InvoiceRow> {
  const provider = einvoicingProvider();
  const id = newId();
  const now = new Date();
  const subtotal = round2(h.lines.reduce((a, l) => a.add(l.netAmount), new Decimal(0)));
  const vat = round2(h.lines.reduce((a, l) => a.add(l.vatAmount), new Decimal(0)));
  const total = round2(h.lines.reduce((a, l) => a.add(l.totalAmount), new Decimal(0)));
  const identity = await repo.nextInvoiceIdentity(scope, tx);
  const einvoiceUuid = provider ? randomUUID() : null;
  const icv = provider ? identity.icv : null;
  const previousInvoiceHash = provider ? identity.previousInvoiceHash ?? '0'.repeat(64) : null;
  const canonical = JSON.stringify({ invoiceNumber: identity.invoiceNumber, einvoiceUuid, icv, previousInvoiceHash, invoiceType: h.invoiceType, seller: s.vatNumber, buyer: h.buyer.vatNumber, issueDate: dateOnly(now), supplyDate: dateOnly(h.supplyDate), subtotal: subtotal.toFixed(2), vat: vat.toFixed(2), total: total.toFixed(2), currency: h.currency, lines: h.lines.map((l) => ({ type: l.lineType, ref: l.tripRequestId ?? l.bookingId, net: l.netAmount.toFixed(2), vat: l.vatAmount.toFixed(2), total: l.totalAmount.toFixed(2) })) });
  const invoiceHash = provider ? createHash('sha256').update(canonical).digest('hex') : null;
  await tx.invoice.create({
    data: {
      id, invoiceNumber: identity.invoiceNumber, invoiceType: h.invoiceType, issuedToCustomerProfileId: h.buyer.customerProfileId, corporateCustomerProfileId: h.buyer.corporateCustomerProfileId, correctsInvoiceId: h.correctsInvoiceId,
      billingPeriodStart: h.billingPeriod?.start ?? null, billingPeriodEnd: h.billingPeriod?.end ?? null, sellerVatNumber: s.vatNumber, buyerVatNumber: h.buyer.vatNumber, lineGranularitySnapshot: h.granularity,
      subtotalAmount: subtotal, vatAmount: vat, totalAmount: total, paidAmount: 0, outstandingAmount: h.payable ? total : 0, currency: h.currency, issueDate: utcDate(dateOnly(now)), supplyDate: utcDate(dateOnly(h.supplyDate)), dueDate: utcDate(dateOnly(h.dueDate)), status: 'DRAFT',
      einvoiceUuid, icv, previousInvoiceHash, invoiceHash, qrCodeTlv: provider ? qrTlv(s.nameEn, s.vatNumber, now, total, vat) : null, clearanceStatus: provider ? 'PENDING' : 'NOT_REQUIRED',
    },
  });
  let sort = 0;
  for (const l of h.lines) {
    const lineId = newId();
    await tx.invoiceLine.create({ data: { id: lineId, invoiceId: id, lineType: l.lineType, tripRequestId: l.tripRequestId, bookingId: l.bookingId, descriptionEn: l.descriptionEn, descriptionAr: l.descriptionAr, quantity: 1, unitAmount: l.netAmount, netAmount: l.netAmount, vatRate: l.vatRate, vatAmount: l.vatAmount, totalAmount: l.totalAmount, vatCategory: l.vatCategory, sortOrder: sort++ } });
    if (l.bookingIds.length) await tx.invoiceLineBooking.createMany({ data: l.bookingIds.map((bookingId) => ({ invoiceLineId: lineId, bookingId })) });
  }
  const row = await repo.findInvoice(scope, id, tx);
  if (!row) throw new NotFoundError();
  return row;
}

/** Issue postings: the receivable against the frozen split of every booking the invoice covers. */
async function postIssue(scope: AnyScope, inv: repo.InvoiceRow, tx: Prisma.TransactionClient, at: Date): Promise<void> {
  const bookings = await repo.bookingsOfInvoice(scope, inv.id, tx);
  for (const b of bookings) {
    if (!b.split) continue;
    if (b.ownerIsPlatformFleet) {
      // A-57: UniGate is the supplier — transport revenue and fare VAT, no owner payable.
      await postLedger({ description: `invoice ${inv.invoiceNumber} · ${b.bookingNumber} (platform fleet)`, occurredAt: at, currency: inv.currency, bookingId: b.id, invoiceId: inv.id, lines: [
        { account: 'CUSTOMER_RECEIVABLE', direction: 'DEBIT', amount: b.totalAmount, customerProfileId: b.customerProfileId },
        { account: 'TRANSPORT_REVENUE', direction: 'CREDIT', amount: b.totalAmount.sub(b.vatAmount) },
        { account: 'VAT_PAYABLE', direction: 'CREDIT', amount: b.vatAmount },
      ] }, tx);
      continue;
    }
    await postLedger({
      description: `invoice ${inv.invoiceNumber} · ${b.bookingNumber}`, occurredAt: at, currency: inv.currency, bookingId: b.id, invoiceId: inv.id,
      lines: [
        { account: 'CUSTOMER_RECEIVABLE', direction: 'DEBIT', amount: b.totalAmount, customerProfileId: b.customerProfileId },
        { account: 'OWNER_PAYABLE', direction: 'CREDIT', amount: b.split.ownerNetAmount, ownerProfileId: b.ownerProfileId },
        { account: 'PLATFORM_COMMISSION_REVENUE', direction: 'CREDIT', amount: b.split.commissionAmount },
        { account: 'VAT_PAYABLE', direction: 'CREDIT', amount: b.split.commissionVatAmount },
        { account: 'PAYMENT_PROCESSING_FEES', direction: 'DEBIT', amount: b.split.paymentFeeAmount },
        { account: 'CUSTOMER_RECEIVABLE', direction: 'CREDIT', amount: b.split.paymentFeeAmount, customerProfileId: b.customerProfileId },
      ],
    }, tx);
  }
}

/**
 * Moves a DRAFT to its post-issue state. No provider → ISSUED (NOT_REQUIRED). Simplified →
 * ISSUED now, reported after. Standard → PENDING_CLEARANCE; issue completes in `runClearance`.
 */
async function markIssued(scope: AnyScope, inv: repo.InvoiceRow, tx: Prisma.TransactionClient, extraPostings: ((tx: Prisma.TransactionClient, at: Date) => Promise<void>) | null): Promise<'ISSUED' | 'PENDING_CLEARANCE'> {
  const provider = einvoicingProvider();
  const now = new Date();
  const blocking = provider !== null && (inv.invoiceType === 'TAX_INVOICE' || ((inv.invoiceType === 'CREDIT_NOTE' || inv.invoiceType === 'DEBIT_NOTE') && inv.buyerVatNumber !== null));
  if (blocking) {
    await tx.invoice.update({ where: { id: inv.id }, data: { status: 'PENDING_CLEARANCE', clearanceSubmittedAt: now } });
    return 'PENDING_CLEARANCE';
  }
  await tx.invoice.update({ where: { id: inv.id }, data: { status: 'ISSUED', ...(provider ? { clearanceSubmittedAt: now } : {}) } });
  if (extraPostings) await extraPostings(tx, now);
  else await postIssue(scope, inv, tx, now);
  await publishEvent('invoice', inv.id, 'invoice.issued', { invoiceNumber: inv.invoiceNumber, invoiceType: inv.invoiceType, customerProfileId: inv.issuedToCustomerProfileId, totalAmount: inv.totalAmount.toFixed(2), dueDate: dateOnly(inv.dueDate) }, tx);
  return 'ISSUED';
}

function documentOf(inv: repo.InvoiceRow): EInvoiceDocument {
  return {
    invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, invoiceType: inv.invoiceType, einvoiceUuid: inv.einvoiceUuid ?? '', icv: Number(inv.icv ?? 0), invoiceHash: inv.invoiceHash ?? '', previousInvoiceHash: inv.previousInvoiceHash ?? '',
    sellerVatNumber: inv.sellerVatNumber, buyerVatNumber: inv.buyerVatNumber, issueDate: dateOnly(inv.issueDate), supplyDate: dateOnly(inv.supplyDate), totalAmount: inv.totalAmount.toFixed(2), vatAmount: inv.vatAmount.toFixed(2), currency: inv.currency,
    canonical: JSON.stringify({ invoiceNumber: inv.invoiceNumber, icv: Number(inv.icv ?? 0), hash: inv.invoiceHash }),
  };
}

/**
 * Presents the document to the provider (after the issuing transaction committed, so a slow
 * authority never holds row locks). Clearance completes the issue: ISSUED + postings; a
 * rejection rests in CLEARANCE_FAILED; an unavailable provider leaves PENDING for the retry job.
 */
export async function runClearance(scope: AnyScope, invoiceId: string): Promise<'CLEARED' | 'REPORTED' | 'REJECTED' | 'UNAVAILABLE' | 'SKIPPED'> {
  const provider = einvoicingProvider();
  const inv = await repo.findInvoice(scope, invoiceId);
  if (!provider || !inv || inv.clearanceStatus === 'CLEARED' || inv.clearanceStatus === 'REPORTED' || inv.clearanceStatus === 'NOT_REQUIRED') return 'SKIPPED';
  const blocking = inv.status === 'PENDING_CLEARANCE' || inv.status === 'CLEARANCE_FAILED';
  let result;
  try {
    result = blocking ? await provider.clear(documentOf(inv)) : await provider.report(documentOf(inv));
  } catch (e) {
    const transient = e instanceof ClearanceProviderError ? e.transient : true;
    logger().warn({ err: e, invoiceId, transient }, 'clearance provider call failed');
    await prisma().invoice.update({ where: { id: invoiceId }, data: { clearanceAttemptCount: { increment: 1 }, clearanceResponse: { errorCode: 'PROVIDER_UNAVAILABLE', at: new Date().toISOString() } } });
    return 'UNAVAILABLE';
  }
  await prisma().$transaction(async (tx) => {
    await repo.lockInvoice(scope, invoiceId, tx);
    const cur = await repo.findInvoice(scope, invoiceId, tx);
    if (!cur) return;
    const now = new Date();
    const response = { ...result.responseRedacted, ...(result.errorCode ? { errorCode: result.errorCode } : {}) } as Prisma.InputJsonValue;
    if (result.status === 'REJECTED') {
      await tx.invoice.update({ where: { id: invoiceId }, data: { clearanceStatus: 'REJECTED', clearanceCompletedAt: now, clearanceAttemptCount: { increment: 1 }, clearanceResponse: response, ...(blocking ? { status: 'CLEARANCE_FAILED' } : {}) } });
      await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: 'invoice.clearance_rejected', entityType: 'invoice', entityId: invoiceId, severity: 'WARNING', afterValue: { errorCode: result.errorCode } }, tx);
      return;
    }
    await tx.invoice.update({ where: { id: invoiceId }, data: { clearanceStatus: result.status, clearanceCompletedAt: now, clearanceAttemptCount: { increment: 1 }, clearanceResponse: response, providerReference: result.providerReference, ...(blocking ? { status: 'ISSUED' } : {}) } });
    if (blocking) {
      if (cur.invoiceType === 'CREDIT_NOTE') await postCreditNote(cur, tx, now);
      else if (cur.invoiceType === 'DEBIT_NOTE') await postDebitNote(cur, tx, now);
      else await postIssue(scope, cur, tx, now);
      await publishEvent('invoice', invoiceId, 'invoice.issued', { invoiceNumber: cur.invoiceNumber, invoiceType: cur.invoiceType, customerProfileId: cur.issuedToCustomerProfileId, totalAmount: cur.totalAmount.toFixed(2), dueDate: dateOnly(cur.dueDate) }, tx);
    }
    await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: `invoice.${result.status.toLowerCase()}`, entityType: 'invoice', entityId: invoiceId, afterValue: { providerReference: result.providerReference } }, tx);
  });
  return result.status;
}

async function granularityFor(buyer: InvoiceBuyer): Promise<'ORDER' | 'BOOKING'> {
  return buyer.invoiceLineGranularity ?? (await getSettingValue<'ORDER' | 'BOOKING'>('finance.invoice_line_granularity', 'ORDER'));
}

async function dueDateFor(buyer: InvoiceBuyer, bookings: repo.BillableBooking[], issue: Date): Promise<Date> {
  const snap = bookings.find((b) => b.creditTermsDaysSnapshot !== null)?.creditTermsDaysSnapshot ?? null;
  const days = snap ?? buyer.creditTermsDays ?? (await getSettingValue<number>('billing.default_credit_terms_days', 30));
  return addDays(issue, days);
}

/** POST /invoices — a single COMPLETED booking. */
export async function issueForBooking(scope: ActorScope, bookingId: string): Promise<InvoiceDto> {
  const s = await seller();
  const invoiceId = await prisma().$transaction(async (tx) => {
    const b = await repo.bookingForInvoice(scope, bookingId, tx);
    if (!b) throw new NotFoundError();
    if (b.alreadyBilled) throw new ConflictError('INVOICE_BOOKING_ALREADY_BILLED', `Booking ${b.bookingNumber} is already on a live invoice`);
    if (b.status !== 'COMPLETED') throw new BusinessRuleError('INVOICE_BOOKING_NOT_BILLABLE', `Booking ${b.bookingNumber} is ${b.status}; only COMPLETED bookings are invoiced`, { status: b.status });
    if (!b.split) throw new BusinessRuleError('INVOICE_BOOKING_NOT_BILLABLE', 'The booking has no financial snapshot');
    const buyer = await invoiceBuyerOf(scope, b.customerProfileId, tx);
    if (!buyer) throw new NotFoundError();
    const granularity = await granularityFor(buyer);
    const now = new Date();
    const row = await writeInvoice(scope, s, { invoiceType: buyer.vatNumber ? 'TAX_INVOICE' : 'SIMPLIFIED_TAX_INVOICE', buyer, correctsInvoiceId: null, billingPeriod: null, granularity, supplyDate: b.completedAt ?? now, dueDate: b.billingMode === 'INVOICED' ? await dueDateFor(buyer, [b], now) : now, lines: linesFor([b], granularity), currency: b.currency, payable: b.billingMode === 'INVOICED' }, tx);
    // A PREPAID booking was collected at checkout: the invoice documents a settled supply, so it carries no receivable.
    if (b.billingMode === 'PREPAID') await tx.invoice.update({ where: { id: row.id }, data: { paidAmount: row.totalAmount, outstandingAmount: 0 } });
    const state = await markIssued(scope, row, tx, b.billingMode === 'PREPAID' ? () => Promise.resolve() : null);
    if (b.billingMode === 'PREPAID' && state === 'ISSUED') await tx.invoice.update({ where: { id: row.id }, data: { status: 'PAID' } });
    await writeAudit({ ...audit(scope), action: 'invoice.created', entityType: 'invoice', entityId: row.id, severity: 'NOTICE', afterValue: { invoiceNumber: row.invoiceNumber, invoiceType: row.invoiceType, bookingId, totalAmount: row.totalAmount.toFixed(2), state } }, tx);
    return row.id;
  });
  const outcome = await runClearance(scope, invoiceId);
  if (outcome === 'UNAVAILABLE') {
    const inv = await repo.findInvoice(scope, invoiceId);
    if (inv?.status === 'PENDING_CLEARANCE') throw new ServiceUnavailableError(300, 'CLEARANCE_PROVIDER_UNAVAILABLE', `Invoice ${inv.invoiceNumber} was created and awaits clearance; the retry job will re-present it`);
  }
  return getInvoice(scope, invoiceId);
}

/** POST /admin/invoices/generate — the billing cycle. */
export async function generateCycle(scope: ActorScope, body: z.infer<typeof generateInvoicesBody>): Promise<InvoiceGenerateResultDto> {
  const s = await seller();
  const from = utcDate(body.periodStart);
  const toExclusive = addDays(utcDate(body.periodEnd), 1);
  const created: { invoiceId: string; customerProfileId: string }[] = [];
  const skipped: InvoiceGenerateResultDto['skipped'] = [];
  const groups = new Map<string, repo.BillableBooking[]>();
  const candidates = await repo.unbilledInvoicedBookings(scope, from, toExclusive, body.customerProfileId ?? null, prisma());
  for (const b of candidates) groups.set(b.customerProfileId, [...(groups.get(b.customerProfileId) ?? []), b]);
  for (const [customerProfileId] of groups) {
    try {
      const invoiceId = await prisma().$transaction(async (tx) => {
        // Re-read under the transaction: a concurrent single-booking issue may have billed some of these.
        const bookings = (await repo.unbilledInvoicedBookings(scope, from, toExclusive, customerProfileId, tx)).filter((b) => b.split);
        const head = bookings[0];
        if (!head) throw new BusinessRuleError('INVOICE_NOTHING_TO_BILL', 'Nothing left to bill');
        const buyer = await invoiceBuyerOf(scope, customerProfileId, tx);
        if (!buyer) throw new NotFoundError();
        const granularity = await granularityFor(buyer);
        const now = new Date();
        const supply = bookings.reduce((m, b) => (b.completedAt && b.completedAt > m ? b.completedAt : m), head.completedAt ?? now);
        const row = await writeInvoice(scope, s, { invoiceType: buyer.vatNumber ? 'TAX_INVOICE' : 'SIMPLIFIED_TAX_INVOICE', buyer, correctsInvoiceId: null, billingPeriod: { start: from, end: utcDate(body.periodEnd) }, granularity, supplyDate: supply, dueDate: await dueDateFor(buyer, bookings, now), lines: linesFor(bookings, granularity), currency: head.currency, payable: true }, tx);
        const state = await markIssued(scope, row, tx, null);
        await writeAudit({ ...audit(scope), action: 'invoice.created', entityType: 'invoice', entityId: row.id, severity: 'NOTICE', afterValue: { invoiceNumber: row.invoiceNumber, invoiceType: row.invoiceType, cycle: { periodStart: body.periodStart, periodEnd: body.periodEnd }, bookings: bookings.length, totalAmount: row.totalAmount.toFixed(2), state } }, tx);
        return row.id;
      });
      created.push({ invoiceId, customerProfileId });
    } catch (e) {
      skipped.push({ customerProfileId, reason: e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : 'ERROR' });
      logger().warn({ err: e, customerProfileId }, 'billing cycle skipped a customer');
    }
  }
  for (const c of created) await runClearance(scope, c.invoiceId);
  const invoices: InvoiceGenerateResultDto['invoices'] = [];
  for (const c of created) {
    const inv = await repo.findInvoice(scope, c.invoiceId);
    if (!inv) continue;
    const bookingCount = (await repo.bookingsOfInvoice(scope, inv.id, prisma())).length;
    invoices.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, customerProfileId: c.customerProfileId, invoiceType: inv.invoiceType, status: inv.status, bookingCount, totalAmount: toMoneyString(inv.totalAmount) });
  }
  await writeAudit({ ...audit(scope), action: 'invoice.cycle_run', entityType: 'billing_cycle', entityId: `${body.periodStart}..${body.periodEnd}`, afterValue: { customers: groups.size, invoices: invoices.length, skipped } });
  return { periodStart: body.periodStart, periodEnd: body.periodEnd, customersConsidered: groups.size, invoices, skipped };
}

// ── corrections ──────────────────────────────────────────────────────────────

async function loadLocked(scope: AnyScope, id: string, tx: Prisma.TransactionClient): Promise<repo.InvoiceRow> {
  await repo.lockInvoice(scope, id, tx);
  const inv = await repo.findInvoice(scope, id, tx);
  if (!inv) throw new NotFoundError();
  return inv;
}

/** POST /invoices/{id}/void */
export async function voidInvoice(scope: ActorScope, id: string, reason: string): Promise<InvoiceDto> {
  await prisma().$transaction(async (tx) => {
    const inv = await loadLocked(scope, id, tx);
    if (inv.clearanceStatus === 'CLEARED' || inv.clearanceStatus === 'REPORTED') throw new ConflictError('INVOICE_ALREADY_CLEARED', 'The authority holds this invoice; correct it with a credit note');
    if (inv.paidAmount.gt(0)) throw new BusinessRuleError('INVOICE_NOT_VOIDABLE', 'Money has been received against this invoice; issue a credit note instead', { paidAmount: inv.paidAmount.toFixed(2) });
    const voidable = inv.status === 'DRAFT' || inv.status === 'CLEARANCE_FAILED' || inv.status === 'PENDING_CLEARANCE' || ((inv.status === 'ISSUED' || inv.status === 'OVERDUE') && inv.clearanceStatus === 'NOT_REQUIRED');
    if (!voidable) throw new BusinessRuleError('INVOICE_NOT_VOIDABLE', `An invoice in ${inv.status} (${inv.clearanceStatus}) cannot be voided`, { status: inv.status, clearanceStatus: inv.clearanceStatus });
    const now = new Date();
    // Postings were made only once ISSUED; a void of an issued (unsubmitted) invoice reverses them so the receivable disappears with the document.
    if (inv.status === 'ISSUED' || inv.status === 'OVERDUE') {
      const bookings = await repo.bookingsOfInvoice(scope, id, tx);
      for (const b of bookings) {
        if (!b.split) continue;
        if (b.ownerIsPlatformFleet) {
          await postLedger({ description: `void ${inv.invoiceNumber} · ${b.bookingNumber} (platform fleet)`, occurredAt: now, currency: inv.currency, bookingId: b.id, invoiceId: id, lines: [
            { account: 'CUSTOMER_RECEIVABLE', direction: 'CREDIT', amount: b.totalAmount, customerProfileId: b.customerProfileId },
            { account: 'TRANSPORT_REVENUE', direction: 'DEBIT', amount: b.totalAmount.sub(b.vatAmount) },
            { account: 'VAT_PAYABLE', direction: 'DEBIT', amount: b.vatAmount },
          ] }, tx);
          continue;
        }
        await postLedger({ description: `void ${inv.invoiceNumber} · ${b.bookingNumber}`, occurredAt: now, currency: inv.currency, bookingId: b.id, invoiceId: id, lines: [
          { account: 'CUSTOMER_RECEIVABLE', direction: 'CREDIT', amount: b.totalAmount, customerProfileId: b.customerProfileId },
          { account: 'OWNER_PAYABLE', direction: 'DEBIT', amount: b.split.ownerNetAmount, ownerProfileId: b.ownerProfileId },
          { account: 'PLATFORM_COMMISSION_REVENUE', direction: 'DEBIT', amount: b.split.commissionAmount },
          { account: 'VAT_PAYABLE', direction: 'DEBIT', amount: b.split.commissionVatAmount },
        ] }, tx);
      }
    }
    // Release the bookings: the link rows go, and BOOKING lines step out of the partial unique index while keeping their reference.
    await tx.invoiceLineBooking.deleteMany({ where: { invoiceLine: { invoiceId: id } } });
    await tx.invoiceLine.updateMany({ where: { invoiceId: id, lineType: 'BOOKING' }, data: { lineType: 'ADJUSTMENT' } });
    await tx.invoice.update({ where: { id }, data: { status: 'VOID', outstandingAmount: 0 } });
    await writeAudit({ ...audit(scope), action: 'invoice.voided', entityType: 'invoice', entityId: id, severity: 'NOTICE', beforeValue: { status: inv.status }, afterValue: { status: 'VOID', reason } }, tx);
    await publishEvent('invoice', id, 'invoice.voided', { invoiceNumber: inv.invoiceNumber, customerProfileId: inv.issuedToCustomerProfileId, reason }, tx);
  });
  return getInvoice(scope, id);
}

async function postCreditNote(note: repo.InvoiceRow, tx: Prisma.TransactionClient, at: Date): Promise<void> {
  // The platform bears the credit (REFUNDS_ISSUED); an owner's share, when agreed, is a settlement PENALTY line.
  await postLedger({ description: `credit note ${note.invoiceNumber}`, occurredAt: at, currency: note.currency, invoiceId: note.id, lines: [
    { account: 'CUSTOMER_RECEIVABLE', direction: 'CREDIT', amount: note.totalAmount, customerProfileId: note.issuedToCustomerProfileId },
    { account: 'REFUNDS_ISSUED', direction: 'DEBIT', amount: note.totalAmount },
  ] }, tx);
}

async function postDebitNote(note: repo.InvoiceRow, tx: Prisma.TransactionClient, at: Date): Promise<void> {
  await postLedger({ description: `debit note ${note.invoiceNumber}`, occurredAt: at, currency: note.currency, invoiceId: note.id, lines: [
    { account: 'CUSTOMER_RECEIVABLE', direction: 'DEBIT', amount: note.totalAmount, customerProfileId: note.issuedToCustomerProfileId },
    { account: 'PLATFORM_COMMISSION_REVENUE', direction: 'CREDIT', amount: note.subtotalAmount },
    { account: 'VAT_PAYABLE', direction: 'CREDIT', amount: note.vatAmount },
  ] }, tx);
}

const CORRECTABLE: repo.InvoiceRow['status'][] = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];

/** POST /invoices/{id}/credit-note */
export async function creditNote(scope: ActorScope, id: string, body: z.infer<typeof creditNoteBody>): Promise<InvoiceDto> {
  const s = await seller();
  const noteId = await prisma().$transaction(async (tx) => {
    const src = await loadLocked(scope, id, tx);
    if (!CORRECTABLE.includes(src.status)) throw new BusinessRuleError('VALIDATION_FAILED', `A ${src.status} invoice cannot be credited`, { status: src.status });
    if (src.invoiceType === 'CREDIT_NOTE') throw new BusinessRuleError('VALIDATION_FAILED', 'A credit note cannot be credited');
    const lines = await repo.allLines(scope, id, tx);
    const drafts: LineDraft[] = [];
    for (const l of lines) {
      const requested = body.lines?.find((x) => x.invoiceLineId === l.id);
      if (body.lines && !requested) continue;
      const amount = requested ? round2(money(requested.amount)) : l.totalAmount;
      if (amount.gt(l.totalAmount)) throw new BusinessRuleError('VALIDATION_FAILED', `Credit for line ${l.id} exceeds its total`, { invoiceLineId: l.id, lineTotal: l.totalAmount.toFixed(2) });
      const vat = round2(amount.sub(amount.div(new Decimal(1).add(l.vatRate))));
      drafts.push({ lineType: 'DISCOUNT', tripRequestId: null, bookingId: null, bookingIds: [], descriptionEn: `Credit against ${src.invoiceNumber}: ${l.descriptionEn}`, descriptionAr: `إشعار دائن مقابل ${src.invoiceNumber}: ${l.descriptionAr}`, netAmount: amount.sub(vat), vatRate: l.vatRate, vatAmount: vat, totalAmount: amount, vatCategory: l.vatCategory as 'S' | 'Z' | 'E' | 'O' });
    }
    if (body.lines && drafts.length !== body.lines.length) throw new BusinessRuleError('VALIDATION_FAILED', 'A referenced line does not belong to the invoice');
    const total = round2(drafts.reduce((a, l) => a.add(l.totalAmount), new Decimal(0)));
    if (total.lte(0)) throw new BusinessRuleError('VALIDATION_FAILED', 'Nothing to credit');
    if (total.gt(src.outstandingAmount)) throw new BusinessRuleError('VALIDATION_FAILED', 'The credit exceeds the outstanding amount; refund received money through /refunds', { outstandingAmount: src.outstandingAmount.toFixed(2), requested: total.toFixed(2) });
    const buyer = await invoiceBuyerOf(scope, src.issuedToCustomerProfileId, tx);
    if (!buyer) throw new NotFoundError();
    const now = new Date();
    const note = await writeInvoice(scope, s, { invoiceType: 'CREDIT_NOTE', buyer: { ...buyer, vatNumber: src.buyerVatNumber }, correctsInvoiceId: id, billingPeriod: null, granularity: src.lineGranularitySnapshot, supplyDate: now, dueDate: now, lines: drafts, currency: src.currency, payable: false }, tx);
    const outstanding = src.outstandingAmount.sub(total);
    const fully = outstanding.eq(0) && src.paidAmount.eq(0);
    await tx.invoice.update({ where: { id }, data: { outstandingAmount: outstanding, status: fully ? 'CREDITED' : outstanding.eq(0) ? 'PAID' : src.status } });
    await markIssued(scope, note, tx, async (t, at) => postCreditNote(note, t, at));
    await writeAudit({ ...audit(scope), action: 'invoice.credit_note', entityType: 'invoice', entityId: id, severity: 'NOTICE', afterValue: { noteId: note.id, noteNumber: note.invoiceNumber, amount: total.toFixed(2), reason: body.reason, sourceStatus: fully ? 'CREDITED' : src.status } }, tx);
    await publishEvent('invoice', id, 'invoice.credited', { invoiceNumber: src.invoiceNumber, creditNoteNumber: note.invoiceNumber, amount: total.toFixed(2), customerProfileId: src.issuedToCustomerProfileId }, tx);
    return note.id;
  });
  await runClearance(scope, noteId);
  return getInvoice(scope, noteId);
}

/** POST /invoices/{id}/debit-note — an increase, itself payable, credit-checked for corporate buyers. */
export async function debitNote(scope: ActorScope, id: string, body: z.infer<typeof debitNoteBody>): Promise<InvoiceDto> {
  const s = await seller();
  const vatPct = await getSettingValue<number>('finance.vat_rate_pct', 15);
  const vatRate = round4(money(vatPct).div(100));
  const noteId = await prisma().$transaction(async (tx) => {
    const src = await loadLocked(scope, id, tx);
    if (!CORRECTABLE.includes(src.status)) throw new BusinessRuleError('VALIDATION_FAILED', `A ${src.status} invoice cannot be increased`, { status: src.status });
    const drafts: LineDraft[] = body.lines.map((l) => {
      const net = round2(money(l.netAmount));
      const vat = vatOn(net, vatRate);
      return { lineType: l.lineType, tripRequestId: null, bookingId: null, bookingIds: [], descriptionEn: l.descriptionEn, descriptionAr: l.descriptionAr, netAmount: net, vatRate, vatAmount: vat, totalAmount: net.add(vat), vatCategory: 'S' as const };
    });
    const total = drafts.reduce((a, l) => a.add(l.totalAmount), new Decimal(0));
    const buyer = await invoiceBuyerOf(scope, src.issuedToCustomerProfileId, tx);
    if (!buyer) throw new NotFoundError();
    if (buyer.creditStatus === 'APPROVED' && buyer.corporateCustomerProfileId) {
      const exposure = await creditExposureOf(scope, src.issuedToCustomerProfileId, tx);
      const projected = money(exposure.receivable).add(money(exposure.uninvoiced)).add(total);
      if (projected.gt(money(buyer.creditLimitAmount))) throw new BusinessRuleError('RULE_CREDIT_LIMIT_EXCEEDED', 'The debit note would exceed the customer’s credit limit', { creditLimitAmount: buyer.creditLimitAmount, projectedExposure: projected.toFixed(2) });
    }
    const now = new Date();
    const note = await writeInvoice(scope, s, { invoiceType: 'DEBIT_NOTE', buyer: { ...buyer, vatNumber: src.buyerVatNumber }, correctsInvoiceId: id, billingPeriod: null, granularity: src.lineGranularitySnapshot, supplyDate: now, dueDate: await dueDateFor(buyer, [], now), lines: drafts, currency: src.currency, payable: true }, tx);
    await markIssued(scope, note, tx, async (t, at) => postDebitNote(note, t, at));
    await writeAudit({ ...audit(scope), action: 'invoice.debit_note', entityType: 'invoice', entityId: id, severity: 'NOTICE', afterValue: { noteId: note.id, noteNumber: note.invoiceNumber, amount: total.toFixed(2), reason: body.reason } }, tx);
    return note.id;
  });
  await runClearance(scope, noteId);
  return getInvoice(scope, noteId);
}

/** POST /admin/invoices/{id}/retry-clearance — same document, same number, same ICV. */
export async function retryClearance(scope: ActorScope, id: string): Promise<InvoiceDto> {
  const inv = await repo.findInvoice(scope, id);
  if (!inv) throw new NotFoundError();
  if (inv.clearanceStatus === 'CLEARED' || inv.clearanceStatus === 'REPORTED') throw new ConflictError('INVOICE_ALREADY_CLEARED', 'The invoice is already cleared');
  if (inv.status !== 'PENDING_CLEARANCE' && inv.status !== 'CLEARANCE_FAILED' && inv.clearanceStatus !== 'PENDING') throw new BusinessRuleError('VALIDATION_FAILED', `Nothing to retry for a ${inv.status} invoice`, { status: inv.status });
  await writeAudit({ ...audit(scope), action: 'invoice.clearance_retry', entityType: 'invoice', entityId: id, afterValue: { previousClearanceStatus: inv.clearanceStatus, attempts: inv.clearanceAttemptCount } });
  const outcome = await runClearance(scope, id);
  if (outcome === 'REJECTED') logger().info({ invoiceId: id }, 'clearance rejected again — a non-transient rejection needs a void and a re-issue');
  return getInvoice(scope, id);
}

export async function clearanceQueue(scope: AnyScope, f: Parameters<typeof repo.clearanceQueue>[1], page: { page: number; pageSize: number }): Promise<{ items: ClearanceQueueItemDto[]; total: number }> {
  const { items, total } = await repo.clearanceQueue(scope, f, page);
  const now = Date.now();
  const out: ClearanceQueueItemDto[] = [];
  for (const i of items) {
    out.push({ invoiceId: i.id, invoiceNumber: i.invoiceNumber, invoiceType: i.invoiceType, status: i.status, clearanceStatus: i.clearanceStatus, clearanceSubmittedAt: i.clearanceSubmittedAt?.toISOString() ?? null, attemptCount: i.clearanceAttemptCount, ageSeconds: Math.floor((now - i.createdAt.getTime()) / 1000), lastErrorCode: await repo.lastClearanceError(scope, i.id), buyer: { customerProfileId: i.issuedToCustomerProfileId, name: i.issuedTo.corporate?.companyNameEn ?? i.issuedTo.user.fullNameEn, vatNumber: i.buyerVatNumber } });
  }
  return { items: out, total };
}

// ── payments against invoices ────────────────────────────────────────────────

export interface InvoicePaymentView {
  id: string;
  invoiceNumber: string;
  customerProfileId: string;
  status: repo.InvoiceRow['status'];
  outstandingAmount: Decimal;
  currency: string;
}

export async function invoiceForPayment(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<InvoicePaymentView | null> {
  const inv = await repo.findInvoice(scope, id, tx);
  if (!inv) return null;
  return { id: inv.id, invoiceNumber: inv.invoiceNumber, customerProfileId: inv.issuedToCustomerProfileId, status: inv.status, outstandingAmount: inv.outstandingAmount, currency: inv.currency };
}

export function isPayable(v: InvoicePaymentView): boolean {
  return (v.status === 'ISSUED' || v.status === 'PARTIALLY_PAID' || v.status === 'OVERDUE') && v.outstandingAmount.gt(0);
}

/** The gateway captured an invoice payment: paid/outstanding move, status follows, the receivable is settled against cash. Idempotent per payment through the caller's state machine. */
export async function applyInvoicePaymentCaptured(scope: AnyScope, invoiceId: string, amount: Decimal, paymentId: string, at: Date, tx: Prisma.TransactionClient): Promise<void> {
  const inv = await loadLocked(scope, invoiceId, tx);
  const applied = amount.gt(inv.outstandingAmount) ? inv.outstandingAmount : amount;
  const outstanding = inv.outstandingAmount.sub(applied);
  await tx.invoice.update({ where: { id: invoiceId }, data: { paidAmount: inv.paidAmount.add(applied), outstandingAmount: outstanding, status: outstanding.eq(0) ? 'PAID' : 'PARTIALLY_PAID' } });
  await postLedger({ description: `invoice payment ${inv.invoiceNumber}`, occurredAt: at, currency: inv.currency, invoiceId, paymentId, lines: [
    { account: 'CASH_GATEWAY', direction: 'DEBIT', amount: applied, customerProfileId: inv.issuedToCustomerProfileId },
    { account: 'CUSTOMER_RECEIVABLE', direction: 'CREDIT', amount: applied, customerProfileId: inv.issuedToCustomerProfileId },
  ] }, tx);
  await publishEvent('invoice', invoiceId, outstanding.eq(0) ? 'invoice.paid' : 'invoice.partially_paid', { invoiceNumber: inv.invoiceNumber, customerProfileId: inv.issuedToCustomerProfileId, amount: applied.toFixed(2), outstandingAmount: outstanding.toFixed(2) }, tx);
}

// ── jobs ─────────────────────────────────────────────────────────────────────

/** ISSUED / PARTIALLY_PAID past due → OVERDUE (once); reminders on the configured days after due. */
export async function markOverdueInvoices(now = new Date()): Promise<{ overdue: number; reminders: number }> {
  const today = utcDate(dateOnly(now));
  const reminderDays = await getSettingValue<number[]>('billing.overdue_reminder_days', [7, 14, 30]);
  const rows = await repo.listDueForOverdue(systemScope, today);
  let overdue = 0;
  let reminders = 0;
  for (const r of rows) {
    const daysOverdue = Math.floor((today.getTime() - r.dueDate.getTime()) / 86_400_000);
    await prisma().$transaction(async (tx) => {
      if (r.status !== 'OVERDUE') {
        await tx.invoice.update({ where: { id: r.id }, data: { status: 'OVERDUE' } });
        await publishEvent('invoice', r.id, 'invoice.overdue', { invoiceNumber: r.invoiceNumber, customerProfileId: r.issuedToCustomerProfileId, outstandingAmount: r.outstandingAmount.toFixed(2), daysOverdue }, tx);
        overdue++;
      }
      if (reminderDays.includes(daysOverdue)) {
        await publishEvent('invoice', r.id, 'invoice.overdue_reminder', { invoiceNumber: r.invoiceNumber, customerProfileId: r.issuedToCustomerProfileId, outstandingAmount: r.outstandingAmount.toFixed(2), daysOverdue }, tx);
        reminders++;
      }
    });
  }
  return { overdue, reminders };
}

/** Re-presents invoices whose clearance is still pending (provider outage) — same document, same ICV. */
export async function retryPendingClearances(olderThanMinutes = 5, take = 100): Promise<number> {
  const provider = einvoicingProvider();
  if (!provider) return 0;
  const rows = await prisma().invoice.findMany({ where: { clearanceStatus: 'PENDING', OR: [{ clearanceSubmittedAt: null }, { clearanceSubmittedAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) } }] }, select: { id: true }, take });
  let done = 0;
  for (const r of rows) {
    const o = await runClearance(systemScope, r.id);
    if (o === 'CLEARED' || o === 'REPORTED') done++;
  }
  return done;
}
