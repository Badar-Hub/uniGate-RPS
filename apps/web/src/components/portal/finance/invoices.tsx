'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2, Printer } from 'lucide-react';
import type { ClearanceQueueItemDto, InvoiceDto, InvoiceGenerateResultDto, InvoiceLineDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CustomerStatement } from '@/components/portal/finance/customer-statement';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PayNow } from '@/components/portal/pay-now';

const TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = { DRAFT: 'secondary', PENDING_CLEARANCE: 'secondary', ISSUED: 'default', PARTIALLY_PAID: 'default', PAID: 'outline', OVERDUE: 'destructive', VOID: 'outline', CREDITED: 'outline', CLEARANCE_FAILED: 'destructive' };

/**
 * Invoices (api.md §8.19). Buyers see their own and pay the outstanding balance; finance runs the
 * billing cycle, watches the clearance queue and works corrections from the detail page. The
 * document itself is rendered from the DTO (the print view) — PDF rendering is a later step.
 */
export function InvoicesList() {
  const t = useTranslations('portal.finance.invoices');
  const tc = useTranslations('common');
  const { me, can } = useSession();
  const staff = can('invoices.issue');
  const [rows, setRows] = useState<InvoiceDto[] | null>(null);
  const [queue, setQueue] = useState<ClearanceQueueItemDto[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InvoiceGenerateResultDto | null>(null);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    const res = await api<InvoiceDto[]>('/invoices', { query: { pageSize: 100 } });
    if (res.ok) setRows(res.data);
    else setError(res.error);
    if (staff) {
      const q = await api<ClearanceQueueItemDto[]>('/admin/invoices/clearance-queue', { query: { pageSize: 50 } });
      if (q.ok) setQueue(q.data);
    }
  }, [staff]);
  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await api<InvoiceGenerateResultDto>('/admin/invoices/generate', { method: 'POST', body: { periodStart: from, periodEnd: to }, headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(false);
    if (res.ok) {
      setResult(res.data);
      await load();
    } else setError(res.error);
  }
  async function retry(id: string) {
    setBusy(true);
    const res = await api<InvoiceDto>(`/admin/invoices/${id}/retry-clearance`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) setError(res.error);
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{staff ? t('subtitleStaff') : t('subtitleBuyer')}</p>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      {!staff && me?.profiles.customer && <CustomerStatement customerProfileId={me.profiles.customer.id} />}
      {staff && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('cycle')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="inv-from">{t('periodStart')}</Label>
                <Input id="inv-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="inv-to">{t('periodEnd')}</Label>
                <Input id="inv-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); }} />
              </div>
              <Button disabled={busy} onClick={() => void generate()}>
                {busy && <Loader2 className="animate-spin" />}
                {t('run')}
              </Button>
            </div>
            {result && <p className="text-sm text-muted-foreground">{t('cycleResult', { customers: result.customersConsidered, invoices: result.invoices.length, skipped: result.skipped.length })}</p>}
            <p className="text-xs text-muted-foreground">{t('cycleHint')}</p>
          </CardContent>
        </Card>
      )}
      {staff && queue.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('clearanceQueue')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('number')}</TableHead>
                  <TableHead>{t('buyer')}</TableHead>
                  <TableHead>{t('clearance')}</TableHead>
                  <TableHead>{t('attempts')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((q) => (
                  <TableRow key={q.invoiceId}>
                    <TableCell><Link href={`/invoices/${q.invoiceId}`} className="text-primary underline-offset-4 hover:underline" dir="ltr">{q.invoiceNumber}</Link></TableCell>
                    <TableCell>{q.buyer.name}</TableCell>
                    <TableCell>
                      <Badge variant={q.clearanceStatus === 'REJECTED' ? 'destructive' : 'secondary'}>{q.clearanceStatus}</Badge>
                      {q.lastErrorCode && <span className="ms-2 text-xs text-muted-foreground" dir="ltr">{q.lastErrorCode}</span>}
                    </TableCell>
                    <TableCell>{q.attemptCount}</TableCell>
                    <TableCell className="text-end"><Button size="sm" variant="outline" disabled={busy} onClick={() => void retry(q.invoiceId)}>{t('retry')}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('number')}</TableHead>
                {staff && <TableHead>{t('buyer')}</TableHead>}
                <TableHead>{t('type')}</TableHead>
                <TableHead>{t('issued')}</TableHead>
                <TableHead>{t('due')}</TableHead>
                <TableHead>{t('total')}</TableHead>
                <TableHead>{t('outstanding')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
              ) : (
                rows.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell><Link href={`/invoices/${i.id}`} className="font-medium text-primary underline-offset-4 hover:underline" dir="ltr">{i.invoiceNumber}</Link></TableCell>
                    {staff && <TableCell>{i.buyerName}</TableCell>}
                    <TableCell className="text-sm">{t(`types.${i.invoiceType}` as 'types.TAX_INVOICE')}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{i.issueDate}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{i.dueDate}</TableCell>
                    <TableCell dir="ltr">{i.totalAmount} {i.currency}</TableCell>
                    <TableCell dir="ltr">{i.outstandingAmount}</TableCell>
                    <TableCell><Badge variant={TONE[i.status] ?? 'secondary'}>{t(`status.${i.status}` as 'status.ISSUED')}</Badge></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function InvoiceDetail({ id, returnedPaymentId }: { id: string; returnedPaymentId: string | null }) {
  const t = useTranslations('portal.finance.invoices');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { me, can } = useSession();
  const staff = can('invoices.issue');
  const [inv, setInv] = useState<InvoiceDto | null>(null);
  const [lines, setLines] = useState<InvoiceLineDto[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api<InvoiceDto>(`/invoices/${id}`), api<InvoiceLineDto[]>(`/invoices/${id}/lines`, { query: { pageSize: 200 } })]);
    if (a.ok) setInv(a.data);
    else setError(a.error);
    if (b.ok) setLines(b.data);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, body: object, idem = false) {
    setBusy(true);
    setError(null);
    const res = await api<InvoiceDto>(`/invoices/${id}/${path}`, { method: 'POST', body, ...(idem ? { headers: { 'Idempotency-Key': idempotencyKey() } } : {}) });
    setBusy(false);
    if (!res.ok) setError(res.error);
    await load();
  }

  if (!inv) {
    return error ? (
      <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
    ) : (
      <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tc('loading')}</div>
    );
  }
  const payable = (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID' || inv.status === 'OVERDUE') && Number(inv.outstandingAmount) > 0;
  const isBuyer = me?.profiles.customer?.id === inv.issuedToCustomerProfileId;
  const undeliverable = inv.status === 'PENDING_CLEARANCE' || inv.status === 'CLEARANCE_FAILED' || inv.status === 'DRAFT';
  const ar = locale === 'ar';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" dir="ltr">{inv.invoiceNumber}</h1>
          <p className="text-sm text-muted-foreground">{t(`types.${inv.invoiceType}` as 'types.TAX_INVOICE')} · {inv.buyerName}{inv.correctsInvoiceNumber ? ` · ${t('corrects', { number: inv.correctsInvoiceNumber })}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={TONE[inv.status] ?? 'secondary'}>{t(`status.${inv.status}` as 'status.ISSUED')}</Badge>
          {!undeliverable && (
            <Button variant="outline" size="sm" onClick={() => { window.print(); }}>
              <Printer className="size-4" />
              {t('print')}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <Alert variant="destructive" className="print:hidden"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      {undeliverable && <p className="text-sm text-amber-700 print:hidden">{t(inv.status === 'CLEARANCE_FAILED' ? 'clearanceFailed' : 'pendingClearance')}</p>}

      {/* The document — printable, rendered from the DTO */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap justify-between gap-4 text-sm">
            <div>
              <div className="text-lg font-semibold">{t(`types.${inv.invoiceType}` as 'types.TAX_INVOICE')}</div>
              <div dir="ltr">{inv.invoiceNumber}</div>
              <div className="text-muted-foreground">{t('issued')}: {inv.issueDate} · {t('supply')}: {inv.supplyDate} · {t('due')}: {inv.dueDate}</div>
              {inv.billingPeriodStart && <div className="text-muted-foreground">{t('period')}: {inv.billingPeriodStart} – {inv.billingPeriodEnd}</div>}
            </div>
            <div className="text-end">
              <div className="font-medium">{t('seller')}</div>
              <div className="text-muted-foreground" dir="ltr">{t('vat')}: {inv.sellerVatNumber}</div>
              <div className="mt-2 font-medium">{t('buyer')}</div>
              <div>{inv.buyerName}</div>
              {inv.buyerVatNumber && <div className="text-muted-foreground" dir="ltr">{t('vat')}: {inv.buyerVatNumber}</div>}
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('description')}</TableHead>
                <TableHead className="text-end">{t('net')}</TableHead>
                <TableHead className="text-end">{t('vatAmount')}</TableHead>
                <TableHead className="text-end">{t('lineTotal')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm">{ar ? l.descriptionAr : l.descriptionEn}</TableCell>
                  <TableCell className="text-end" dir="ltr">{l.netAmount}</TableCell>
                  <TableCell className="text-end" dir="ltr">{l.vatAmount} ({(Number(l.vatRate) * 100).toFixed(0)}%)</TableCell>
                  <TableCell className="text-end" dir="ltr">{l.totalAmount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="ms-auto max-w-xs space-y-1 text-sm">
            <Row label={t('subtotal')} value={`${inv.subtotalAmount} ${inv.currency}`} />
            <Row label={t('vatAmount')} value={`${inv.vatAmount} ${inv.currency}`} />
            <Row label={t('total')} value={`${inv.totalAmount} ${inv.currency}`} bold />
            <Row label={t('paid')} value={`${inv.paidAmount} ${inv.currency}`} />
            <Row label={t('outstanding')} value={`${inv.outstandingAmount} ${inv.currency}`} bold />
          </div>
          {inv.einvoice.clearanceStatus !== 'NOT_REQUIRED' && (
            <div className="border-t pt-3 text-xs text-muted-foreground" dir="ltr">
              {t('chain', { icv: inv.einvoice.icv ?? 0, clearance: inv.einvoice.clearanceStatus })} · {inv.einvoice.invoiceHash?.slice(0, 16)}…
            </div>
          )}
        </CardContent>
      </Card>

      {isBuyer && payable && (
        <div className="print:hidden">
          <PayNow target={{ invoiceId: inv.id, amount: inv.outstandingAmount, currency: inv.currency, returnPath: `/invoices/${inv.id}`, dueLabel: null }} returnedPaymentId={returnedPaymentId} onPaid={() => void load()} />
        </div>
      )}

      {staff && inv.status !== 'VOID' && inv.status !== 'CREDITED' && (
        <Card className="print:hidden">
          <CardHeader><CardTitle className="text-base">{t('corrections')}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 space-y-1">
              <Label htmlFor="inv-reason">{t('reason')}</Label>
              <Input id="inv-reason" value={reason} onChange={(e) => { setReason(e.target.value); }} />
            </div>
            {(inv.status === 'DRAFT' || inv.status === 'PENDING_CLEARANCE' || inv.status === 'CLEARANCE_FAILED' || ((inv.status === 'ISSUED' || inv.status === 'OVERDUE') && inv.einvoice.clearanceStatus === 'NOT_REQUIRED')) && (
              <Button variant="destructive" disabled={busy || reason.length < 3} onClick={() => void act('void', { reason })}>{t('void')}</Button>
            )}
            {(inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID' || inv.status === 'OVERDUE') && inv.invoiceType !== 'CREDIT_NOTE' && Number(inv.outstandingAmount) > 0 && (
              <Button variant="outline" disabled={busy || reason.length < 3} onClick={() => void act('credit-note', { reason }, true)}>{t('creditFull')}</Button>
            )}
            {(inv.status === 'PENDING_CLEARANCE' || inv.status === 'CLEARANCE_FAILED') && (
              <Button variant="outline" disabled={busy} onClick={() => void api<InvoiceDto>(`/admin/invoices/${id}/retry-clearance`, { method: 'POST' }).then(() => load())}>{t('retry')}</Button>
            )}
            <p className="basis-full text-xs text-muted-foreground">{t('correctionsHint')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span dir="ltr">{value}</span>
    </div>
  );
}
