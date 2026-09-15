'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { AcceptBidResultDto, AwardResultDto, BidDto, TripRequestDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from '@/lib/i18n/routing';
import { BID_TONE } from './bids-list';

/**
 * The customer's comparison list on one request (api.md §8.11 `GET /trip-requests/{id}/bids`),
 * cheapest first, with single acceptance or — for an all-or-nothing order — the group award.
 */
export function RequestBids({ request, canAccept, onChanged }: { request: TripRequestDto; canAccept: boolean; onChanged: (r: TripRequestDto) => void }) {
  const t = useTranslations('portal.bids.compare');
  const tb = useTranslations('portal.bids');
  const tc = useTranslations('common');
  const [rows, setRows] = useState<BidDto[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const remainder = request.vehiclesRequired - request.vehiclesAwarded;
  const groupOnly = !request.allowPartialFulfilment && request.vehiclesRequired > 1;
  const open = request.biddingOpen && remainder > 0;

  const load = useCallback(async () => {
    const res = await api<BidDto[]>(`/trip-requests/${request.id}/bids`, { query: { pageSize: 100 } });
    if (res.ok) setRows(res.data);
    else setError(res.error);
  }, [request.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function accept(b: BidDto) {
    setBusy(true);
    setError(null);
    const res = await api<AcceptBidResultDto>(`/bids/${b.id}/accept`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(t('accepted', { number: res.data.booking.bookingNumber }));
    onChanged(res.data.tripRequest);
    await load();
  }
  async function awardSelected() {
    setBusy(true);
    setError(null);
    const res = await api<AwardResultDto>(`/trip-requests/${request.id}/award`, { method: 'POST', body: { bidIds: selected }, headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(t('awarded', { count: res.data.bookings.length }));
    setSelected([]);
    onChanged(res.data.tripRequest);
    await load();
  }
  async function reject(b: BidDto) {
    setError(null);
    const res = await api<BidDto>(`/bids/${b.id}/reject`, { method: 'POST', body: {} });
    if (!res.ok) setError(res.error);
    await load();
  }
  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <CardDescription>{groupOnly && open ? t('awardHint', { count: remainder }) : t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {rows === null && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {rows?.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {groupOnly && canAccept && <TableHead>{t('select')}</TableHead>}
                  <TableHead>{t('owner')}</TableHead>
                  <TableHead>{tb('vehicle')}</TableHead>
                  <TableHead>{tb('total')}</TableHead>
                  <TableHead>{t('rating')}</TableHead>
                  <TableHead>{tb('validUntil')}</TableHead>
                  <TableHead>{tb('statusLabel')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => {
                  const live = b.status === 'SUBMITTED';
                  return (
                    <TableRow key={b.id} className={b.status === 'ACCEPTED' ? 'bg-muted/50' : ''}>
                      {groupOnly && canAccept && (
                        <TableCell>
                          <input type="checkbox" aria-label={t('select')} disabled={!live || !open} checked={selected.includes(b.id)} onChange={() => { toggle(b.id); }} />
                        </TableCell>
                      )}
                      <TableCell>
                        <span className="font-medium">{b.ownerName}</span>
                        {b.ownerNotes && <div className="text-xs text-muted-foreground">{b.ownerNotes}</div>}
                      </TableCell>
                      <TableCell dir="ltr">
                        {b.vehicle.plateNumberEn}
                        <div className="text-xs text-muted-foreground">{b.vehicle.description}</div>
                      </TableCell>
                      <TableCell dir="ltr" className="font-medium">
                        {b.totalAmount} {b.currency}
                        <div className="text-xs font-normal text-muted-foreground">
                          {b.baseAmount} + {b.extrasAmount} + VAT {b.vatAmount}
                        </div>
                      </TableCell>
                      <TableCell dir="ltr">{b.ownerRatingAvg}</TableCell>
                      <TableCell className="text-sm" dir="ltr">
                        {new Date(b.validUntil).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={BID_TONE[b.status] ?? 'outline'}>{tb(`status.${b.status}` as 'status.SUBMITTED')}</Badge>
                      </TableCell>
                      <TableCell>
                        {canAccept && live && open && (
                          <div className="flex gap-1">
                            {!groupOnly && (
                              <Button size="sm" disabled={busy} onClick={() => void accept(b)}>
                                {busy && <Loader2 className="animate-spin" />}
                                {t('accept')}
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reject(b)}>
                              {t('reject')}
                            </Button>
                          </div>
                        )}
                        {b.status === 'ACCEPTED' && b.bookingId && (
                          <Link href={`/bookings/${b.bookingId}`} className="text-xs text-primary underline-offset-4 hover:underline">
                            {t('booked')}
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {groupOnly && canAccept && open && rows && rows.length > 0 && (
          <div className="flex justify-end">
            <Button disabled={busy || selected.length !== remainder} onClick={() => void awardSelected()}>
              {busy && <Loader2 className="animate-spin" />}
              {t('awardSelected', { count: selected.length })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
