'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Check, Loader2, Play, X } from 'lucide-react';
import type { RefundDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const select = 'flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';
const STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'] as const;
const fmt = (locale: string, iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** Refunds admin (api.md §8.18): the queue with four-eyes approval, rejection with a reason, and processing through the gateway. */
export function AdminRefundsPage() {
  const t = useTranslations('portal.adminRefunds');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { me, can } = useSession();
  const [status, setStatus] = useState('REQUESTED');
  const [rows, setRows] = useState<RefundDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<RefundDto[]>('/refunds', { query: { pageSize: 50, ...(status ? { status } : {}) } });
    if (res.ok) setRows(res.data);
    else setError(res.error);
  }, [status]);
  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  async function act(id: string, path: string, body?: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    const res = await api(`/refunds/${id}/${path}`, { method: 'POST', ...(body ? { body } : {}), headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(null);
    if (!res.ok) setError(res.error);
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <select className={select} value={status} onChange={(e) => { setStatus(e.target.value); }} aria-label={t('status')}>
          <option value="">{t('any')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('number')}</TableHead>
                <TableHead>{t('booking')}</TableHead>
                <TableHead>{t('amount')}</TableHead>
                <TableHead>{t('reason')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('requested')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
              ) : (
                rows.map((r) => {
                  const mine = r.requestedByUserId === me?.id;
                  return (
                    <TableRow key={r.id}>
                      <TableCell dir="ltr" className="font-mono text-xs">{r.refundNumber}<div className="text-muted-foreground">{r.paymentNumber}</div></TableCell>
                      <TableCell dir="ltr">{r.bookingNumber ?? '—'}</TableCell>
                      <TableCell dir="ltr">{r.amount} {r.currency}</TableCell>
                      <TableCell className="text-sm">{r.reasonCode}{r.reasonText ? <div className="text-xs text-muted-foreground">{r.reasonText}</div> : null}</TableCell>
                      <TableCell><Badge variant={r.status === 'COMPLETED' ? 'default' : r.status === 'FAILED' || r.status === 'REJECTED' ? 'destructive' : 'outline'}>{r.status}</Badge></TableCell>
                      <TableCell className="text-xs" dir="ltr">{fmt(locale, r.createdAt)}</TableCell>
                      <TableCell className="text-end">
                        {can('payments.refund') && (
                          <div className="flex justify-end gap-1">
                            {r.status === 'REQUESTED' && <Button variant="ghost" size="sm" disabled={busy === r.id || mine} title={mine ? t('fourEyes') : undefined} onClick={() => void act(r.id, 'approve', {})}><Check className="size-4" />{t('approve')}</Button>}
                            {(r.status === 'REQUESTED' || r.status === 'APPROVED') && <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => { const reason = window.prompt(t('rejectReason')); if (reason && reason.length >= 3) void act(r.id, 'reject', { reason }); }}><X className="size-4" />{t('reject')}</Button>}
                            {r.status === 'APPROVED' && <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => void act(r.id, 'process')}><Play className="size-4" />{t('process')}</Button>}
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
