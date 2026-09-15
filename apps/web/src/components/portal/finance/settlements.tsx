'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { OwnerDto, SettlementDto, SettlementLineDto, SettlementPreviewDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = { DRAFT: 'secondary', PENDING_APPROVAL: 'secondary', APPROVED: 'default', PROCESSING: 'default', PAID: 'outline', FAILED: 'destructive', CANCELLED: 'destructive' };
const iso = (d: Date) => d.toISOString();
const monthAgo = () => new Date(Date.now() - 30 * 86_400_000);

/**
 * Settlements (api.md §8.21). An owner sees their pending settlement (the dry-run preview over
 * the last 30 days) and the history; a finance officer builds settlements per owner and drives
 * them through submit → approve → pay from the detail page.
 */
export function SettlementsList() {
  const t = useTranslations('portal.finance.settlements');
  const tc = useTranslations('common');
  const { me, can } = useSession();
  const staff = can('settlements.create');
  const [rows, setRows] = useState<SettlementDto[] | null>(null);
  const [preview, setPreview] = useState<SettlementPreviewDto | null>(null);
  const [owners, setOwners] = useState<OwnerDto[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [from, setFrom] = useState(monthAgo().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    const res = await api<SettlementDto[]>('/settlements', { query: { pageSize: 100 } });
    if (res.ok) setRows(res.data);
    else setError(res.error);
  }, []);
  useEffect(() => {
    void load();
    if (me?.profiles.owner && !staff) {
      void api<SettlementPreviewDto>('/settlements/preview', { query: { periodStart: iso(monthAgo()), periodEnd: iso(new Date()) } }).then((res) => {
        if (res.ok) setPreview(res.data);
      });
    }
    if (staff) {
      void api<OwnerDto[]>('/owners', { query: { pageSize: 100, onboardingStatus: 'APPROVED' } }).then((res) => {
        // A-57: UniGate's own fleet is never settled.
        if (res.ok) setOwners(res.data.filter((o) => !o.isPlatformFleet));
      });
    }
  }, [load, me, staff]);

  async function runPreview() {
    if (!ownerId) return;
    setBusy(true);
    setError(null);
    const res = await api<SettlementPreviewDto>('/settlements/preview', { query: { ownerProfileId: ownerId, periodStart: `${from}T00:00:00.000Z`, periodEnd: `${to}T23:59:59.999Z` } });
    setBusy(false);
    if (res.ok) setPreview(res.data);
    else setError(res.error);
  }
  async function build() {
    if (!ownerId) return;
    setBusy(true);
    setError(null);
    const res = await api<SettlementDto>('/settlements', { method: 'POST', body: { ownerProfileId: ownerId, periodStart: `${from}T00:00:00.000Z`, periodEnd: `${to}T23:59:59.999Z` }, headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(false);
    if (res.ok) {
      setPreview(null);
      await load();
    } else setError(res.error);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{staff ? t('subtitleStaff') : t('subtitleOwner')}</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
        </Alert>
      )}
      {staff && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('build')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="st-owner">{t('owner')}</Label>
              <select id="st-owner" className="flex h-9 min-w-56 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={ownerId} onChange={(e) => { setOwnerId(e.target.value); }}>
                <option value="">—</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.businessNameEn ?? o.fullNameEn}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="st-from">{t('periodStart')}</Label>
              <Input id="st-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); }} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="st-to">{t('periodEnd')}</Label>
              <Input id="st-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); }} />
            </div>
            <Button variant="outline" disabled={busy || !ownerId} onClick={() => void runPreview()}>{t('preview')}</Button>
            <Button disabled={busy || !ownerId || !preview || preview.eligible.length === 0 || preview.belowMinimum} onClick={() => void build()}>
              {busy && <Loader2 className="animate-spin" />}
              {t('create')}
            </Button>
          </CardContent>
        </Card>
      )}
      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{staff ? t('previewTitle') : t('pending')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-4">
              <Stat label={t('gross')} value={`${preview.grossAmount} ${preview.currency}`} />
              <Stat label={t('deductions')} value={`${preview.commissionAmount} ${preview.currency}`} />
              <Stat label={t('net')} value={`${preview.netPayableAmount} ${preview.currency}`} />
              <Stat label={t('heldCount')} value={String(preview.held.length)} />
            </div>
            {preview.belowMinimum && <p className="text-amber-700">{t('belowMinimum', { min: preview.minimumPayoutAmount })}</p>}
            {preview.eligible.length === 0 && preview.held.length === 0 && <p className="text-muted-foreground">{t('nothingPending')}</p>}
            {preview.held.length > 0 && (
              <ul className="list-disc ps-5 text-muted-foreground">
                {preview.held.map((h) => (
                  <li key={h.bookingId}>
                    <span dir="ltr">{h.bookingNumber}</span> · {h.ownerNetAmount} · {t(`hold.${h.holdReason}` as 'hold.HOLD_PERIOD')} ({new Date(h.eligibleAt).toLocaleDateString()})
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('number')}</TableHead>
                {staff && <TableHead>{t('owner')}</TableHead>}
                <TableHead>{t('period')}</TableHead>
                <TableHead>{t('net')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
              ) : (
                rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/settlements/${s.id}`} className="font-medium text-primary underline-offset-4 hover:underline" dir="ltr">{s.settlementNumber}</Link>
                    </TableCell>
                    {staff && <TableCell>{s.ownerName}</TableCell>}
                    <TableCell className="text-sm text-muted-foreground">{new Date(s.periodStart).toLocaleDateString()} – {new Date(s.periodEnd).toLocaleDateString()}</TableCell>
                    <TableCell dir="ltr">{s.netPayableAmount} {s.currency}</TableCell>
                    <TableCell><Badge variant={TONE[s.status] ?? 'secondary'}>{t(`status.${s.status}` as 'status.DRAFT')}</Badge></TableCell>
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

function detailReason(e: ApiError): string {
  const d = e.details as Record<string, unknown> | undefined;
  const r = d?.['reason'];
  return typeof r === 'string' ? ` (${r})` : '';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium" dir="ltr">{value}</div>
    </div>
  );
}

export function SettlementDetail({ id }: { id: string }) {
  const t = useTranslations('portal.finance.settlements');
  const tc = useTranslations('common');
  const { can } = useSession();
  const [s, setS] = useState<SettlementDto | null>(null);
  const [lines, setLines] = useState<SettlementLineDto[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [penalty, setPenalty] = useState({ amount: '', description: '' });

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api<SettlementDto>(`/settlements/${id}`), api<SettlementLineDto[]>(`/settlements/${id}/lines`)]);
    if (a.ok) setS(a.data);
    else setError(a.error);
    if (b.ok) setLines(b.data);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, body?: object, headers?: Record<string, string>) {
    setBusy(true);
    setError(null);
    const res = await api<SettlementDto | SettlementLineDto>(`/settlements/${id}/${path}`, { method: 'POST', body: body ?? {}, ...(headers ? { headers } : {}) });
    setBusy(false);
    if (!res.ok) setError(res.error);
    await load();
  }

  if (!s) {
    return error ? (
      <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
    ) : (
      <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tc('loading')}</div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" dir="ltr">{s.settlementNumber}</h1>
          <p className="text-sm text-muted-foreground">{s.ownerName} · {new Date(s.periodStart).toLocaleDateString()} – {new Date(s.periodEnd).toLocaleDateString()}</p>
        </div>
        <Badge variant={TONE[s.status] ?? 'secondary'}>{t(`status.${s.status}` as 'status.DRAFT')}</Badge>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}{detailReason(error)}</AlertDescription></Alert>
      )}
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label={t('gross')} value={`${s.grossAmount} ${s.currency}`} />
        <Stat label={t('deductions')} value={`${s.commissionAmount} ${s.currency}`} />
        <Stat label={t('adjustments')} value={`${s.adjustmentsAmount} ${s.currency}`} />
        <Stat label={t('net')} value={`${s.netPayableAmount} ${s.currency}`} />
      </div>
      {s.bankAccount && <p className="text-sm text-muted-foreground">{t('paidTo', { bank: s.bankAccount.bankName, last4: s.bankAccount.ibanLast4 })}{s.paymentReference ? ` · ${s.paymentReference}` : ''}</p>}
      {s.notes && <p className="whitespace-pre-line text-sm text-muted-foreground">{s.notes}</p>}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('lineType')}</TableHead>
                <TableHead>{t('booking')}</TableHead>
                <TableHead>{t('description')}</TableHead>
                <TableHead>{t('amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell><Badge variant="outline">{t(`lineTypes.${l.lineType}` as 'lineTypes.BOOKING_EARNING')}</Badge></TableCell>
                  <TableCell dir="ltr">{l.bookingId ? <Link href={`/bookings/${l.bookingId}`} className="text-primary underline-offset-4 hover:underline">{l.bookingNumber}</Link> : '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.description}</TableCell>
                  <TableCell dir="ltr">{l.amount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {can('settlements.create') && s.status === 'DRAFT' && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('addLine')}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="pen-amount">{t('amount')}</Label>
              <Input id="pen-amount" dir="ltr" placeholder="-50.00" value={penalty.amount} onChange={(e) => { setPenalty({ ...penalty, amount: e.target.value }); }} />
            </div>
            <div className="min-w-64 space-y-1">
              <Label htmlFor="pen-desc">{t('description')}</Label>
              <Input id="pen-desc" value={penalty.description} onChange={(e) => { setPenalty({ ...penalty, description: e.target.value }); }} />
            </div>
            <Button variant="outline" disabled={busy || !penalty.amount || penalty.description.length < 3} onClick={() => void act('lines', { lineType: penalty.amount.startsWith('-') ? 'PENALTY' : 'ADJUSTMENT', amount: penalty.amount, description: penalty.description }).then(() => { setPenalty({ amount: '', description: '' }); })}>{t('addLine')}</Button>
            <Button disabled={busy} onClick={() => void act('submit')}>{t('submit')}</Button>
          </CardContent>
        </Card>
      )}
      {can('settlements.approve') && (s.status === 'PENDING_APPROVAL' || s.status === 'APPROVED') && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            {s.status === 'PENDING_APPROVAL' && <Button disabled={busy} onClick={() => void act('approve')}>{t('approve')}</Button>}
            <div className="min-w-64 space-y-1">
              <Label htmlFor="rej-reason">{t('rejectReason')}</Label>
              <Input id="rej-reason" value={reason} onChange={(e) => { setReason(e.target.value); }} />
            </div>
            <Button variant="destructive" disabled={busy || reason.length < 3} onClick={() => void act('reject', { reason })}>{t('reject')}</Button>
          </CardContent>
        </Card>
      )}
      {can('settlements.pay') && s.status === 'APPROVED' && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('pay')}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 space-y-1">
              <Label htmlFor="pay-ref">{t('paymentReference')}</Label>
              <Input id="pay-ref" dir="ltr" value={reference} onChange={(e) => { setReference(e.target.value); }} />
            </div>
            <Button disabled={busy || reference.length < 3} onClick={() => void act('pay', { paymentReference: reference }, { 'Idempotency-Key': idempotencyKey() })}>
              {busy && <Loader2 className="animate-spin" />}
              {t('markPaid')}
            </Button>
            <p className="basis-full text-xs text-muted-foreground">{t('payHint')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
