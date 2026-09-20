'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Check, FileText, Loader2, Settings, X } from 'lucide-react';
import type { DownloadUrlDto, PaymentConfigDto, PaymentDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const BANK_TRANSFER_PROVIDER = 'bank_transfer';
/** Queue views: the two PENDING buckets first (what finance works through), then the history. */
const VIEWS = ['TO_VERIFY', 'AWAITING_RECEIPT', 'VERIFIED', 'REJECTED', 'ALL'] as const;
type View = (typeof VIEWS)[number];
const fmt = (locale: string, iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/**
 * Bank transfers (IBFT) admin: receipts submitted by customers, verified or rejected by finance
 * against the bank statement. Verification is the only route that turns a transfer into PAID
 * (api.md §8.17); the receiving account itself lives in Admin → Settings → finance.
 */
export function AdminBankTransfersPage() {
  const t = useTranslations('portal.adminBankTransfers');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useSession();
  const [view, setView] = useState<View>('TO_VERIFY');
  const [rows, setRows] = useState<PaymentDto[] | null>(null);
  const [cfg, setCfg] = useState<PaymentConfigDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api<PaymentConfigDto>('/payments/config').then((res) => { if (res.ok) setCfg(res.data); });
  }, []);

  const load = useCallback(async () => {
    const status = view === 'TO_VERIFY' || view === 'AWAITING_RECEIPT' ? 'PENDING' : view === 'VERIFIED' ? 'PAID' : view === 'REJECTED' ? 'FAILED' : undefined;
    const res = await api<PaymentDto[]>('/payments', { query: { pageSize: 100, providerCode: BANK_TRANSFER_PROVIDER, ...(status ? { status } : {}) } });
    if (!res.ok) { setError(res.error); return; }
    const awaiting = (p: PaymentDto) => p.bankTransfer?.awaitingVerification === true;
    setRows(view === 'TO_VERIFY' ? res.data.filter(awaiting) : view === 'AWAITING_RECEIPT' ? res.data.filter((p) => !awaiting(p)) : res.data);
  }, [view]);
  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  async function act(id: string, path: 'verify-transfer' | 'reject-transfer', body: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    const res = await api(`/admin/payments/${id}/${path}`, { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(null);
    if (!res.ok) setError(res.error);
    await load();
  }

  async function openReceipt(documentId: string) {
    setError(null);
    const res = await api<DownloadUrlDto>(`/documents/${documentId}/download-url`);
    if (!res.ok) { setError(res.error); return; }
    window.open(res.data.url, '_blank', 'noopener');
  }

  const verify = (p: PaymentDto) => {
    const notes = window.prompt(t('verifyNotes', { number: p.paymentNumber, amount: `${p.amount} ${p.currency}` }), p.bankTransfer?.transferReference ?? '');
    if (notes === null) return;
    void act(p.id, 'verify-transfer', notes.trim() ? { notes: notes.trim() } : {});
  };
  const reject = (p: PaymentDto) => {
    const reason = window.prompt(t('rejectReason', { number: p.paymentNumber }));
    if (reason === null) return;
    if (reason.trim().length < 5) { window.alert(t('rejectReasonShort')); return; }
    void act(p.id, 'reject-transfer', { reason: reason.trim() });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {can('settings.read') && (
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/settings"><Settings className="size-4" />{t('configure')}</Link>
          </Button>
        )}
      </div>
      {cfg && !cfg.bankTransfer && (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertDescription>{t('notConfigured')}</AlertDescription>
        </Alert>
      )}
      {cfg?.bankTransfer && (
        <p className="text-sm text-muted-foreground">
          {t('receivingAccount')}: {cfg.bankTransfer.bankName} · {cfg.bankTransfer.accountName} · <span dir="ltr" className="font-mono">{cfg.bankTransfer.iban}</span>
        </p>
      )}
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Button key={v} variant={v === view ? 'default' : 'outline'} size="sm" onClick={() => { setView(v); }}>{t(`views.${v}`)}</Button>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payment')}</TableHead>
                <TableHead>{t('for')}</TableHead>
                <TableHead>{t('amount')}</TableHead>
                <TableHead>{t('transfer')}</TableHead>
                <TableHead>{t('receipt')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
              ) : (
                rows.map((p) => {
                  const bt = p.bankTransfer;
                  return (
                    <TableRow key={p.id}>
                      <TableCell dir="ltr" className="font-mono text-xs">{p.paymentNumber}<div className="text-muted-foreground">{fmt(locale, p.createdAt)}</div></TableCell>
                      <TableCell dir="ltr" className="text-sm">
                        {p.bookingId ? <Link className="underline" href={`/bookings/${p.bookingId}`}>{p.bookingNumber ?? p.bookingId.slice(0, 8)}</Link> : p.invoiceId ? <Link className="underline" href={`/invoices/${p.invoiceId}`}>{t('invoice')}</Link> : '—'}
                      </TableCell>
                      <TableCell dir="ltr">{p.amount} {p.currency}</TableCell>
                      <TableCell className="text-xs" dir="ltr">
                        {bt?.transferReference ? <div className="font-mono">{bt.transferReference}</div> : <div className="text-muted-foreground">—</div>}
                        {bt?.transferredAt && <div className="text-muted-foreground">{fmt(locale, bt.transferredAt)}</div>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {bt?.receiptDocumentId ? (
                          <Button variant="ghost" size="sm" onClick={() => void openReceipt(bt.receiptDocumentId ?? '')}><FileText className="size-4" />{t('openReceipt')}</Button>
                        ) : (
                          <span className="text-muted-foreground">{p.expiresAt ? t('noReceiptUntil', { at: fmt(locale, p.expiresAt) }) : t('noReceipt')}</span>
                        )}
                        {bt?.receiptSubmittedAt && <div className="text-muted-foreground" dir="ltr">{fmt(locale, bt.receiptSubmittedAt)}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === 'PAID' ? 'default' : p.status === 'FAILED' || p.status === 'CANCELLED' ? 'destructive' : 'outline'}>
                          {p.status === 'PENDING' ? (bt?.awaitingVerification ? t('views.TO_VERIFY') : t('views.AWAITING_RECEIPT')) : p.status}
                        </Badge>
                        {bt?.verificationNotes && <div className="mt-1 max-w-56 text-xs text-muted-foreground">{bt.verificationNotes}</div>}
                      </TableCell>
                      <TableCell className="text-end">
                        {can('payments.manage') && p.status === 'PENDING' && (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" disabled={busy === p.id} onClick={() => { verify(p); }}><Check className="size-4" />{t('verify')}</Button>
                            <Button variant="ghost" size="sm" disabled={busy === p.id} onClick={() => { reject(p); }}><X className="size-4" />{t('reject')}</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
