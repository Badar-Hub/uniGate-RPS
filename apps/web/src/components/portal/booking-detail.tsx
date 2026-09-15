'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { BookingDto, BookingStatusHistoryDto, CancelBookingResultDto, CancellationQuoteDto, VehicleAssignmentDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BOOKING_TONE } from './bookings-list';
import { PayNow } from './pay-now';

const CANCELLABLE = ['PENDING_PAYMENT', 'CONFIRMED', 'DRIVER_ASSIGNED', 'READY'];

/** One booking: schedule, route, parties, the owner's split, history, and the party-specific actions. */
export function BookingDetail({ id, returnedPaymentId = null }: { id: string; returnedPaymentId?: string | null }) {
  const t = useTranslations('portal.bookings');
  const tc = useTranslations('common');
  const { me, can } = useSession();
  const [b, setB] = useState<BookingDto | null>(null);
  const [history, setHistory] = useState<BookingStatusHistoryDto[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [drivers, setDrivers] = useState<VehicleAssignmentDto[] | null>(null);
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);

  const isOwner = Boolean(b && me?.profiles.owner?.id === b.ownerProfileId);
  const isCustomer = Boolean(b && me?.profiles.customer?.id === b.customerProfileId);
  const staff = can('bookings.manage');

  const load = useCallback(async () => {
    const res = await api<BookingDto>(`/bookings/${id}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setB(res.data);
    const h = await api<BookingStatusHistoryDto[]>(`/bookings/${id}/status-history`);
    if (h.ok) setHistory(h.data);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!b || !(isOwner || staff) || b.status !== 'CONFIRMED') return;
    void api<VehicleAssignmentDto[]>(`/vehicles/${b.vehicleId}/drivers`).then((res) => {
      if (res.ok) {
        const active = res.data.filter((a) => !a.assignedTo);
        setDrivers(active);
        setDriverId((d) => d || (active[0]?.driverProfileId ?? ''));
      }
    });
  }, [b, isOwner, staff]);

  async function assign() {
    if (!driverId) return;
    setBusy(true);
    setError(null);
    const res = await api<BookingDto>(`/bookings/${id}/assign-driver`, { method: 'POST', body: { driverProfileId: driverId } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(t('detail.assigned', { number: res.data.trip?.tripNumber ?? '' }));
    await load();
  }
  async function ready() {
    setBusy(true);
    setError(null);
    const res = await api<BookingDto>(`/bookings/${id}/ready`, { method: 'POST', body: {} });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(t('detail.readyDone'));
    await load();
  }

  if (!b) {
    return error ? (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
      </Alert>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    );
  }
  const f = b.financial;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" dir="ltr">
            {b.bookingNumber}
          </h1>
          <p className="text-sm text-muted-foreground" dir="ltr">
            <Link href={`/requests/${b.tripRequestId}`} className="text-primary underline-offset-4 hover:underline">
              {b.requestNumber}
            </Link>{' '}
            · {t('wave', { n: b.fulfilmentSequence })} · {b.totalAmount} {b.currency}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={BOOKING_TONE[b.status] ?? 'outline'}>{t(`status.${b.status}` as 'status.CONFIRMED')}</Badge>
          <Badge variant="outline">{t(`paymentStatus.${b.paymentStatus}` as 'paymentStatus.UNPAID')}</Badge>
        </div>
      </div>
      {notice && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detail.schedule')}</CardTitle>
            <CardDescription dir="ltr">
              {new Date(b.scheduledStartAt).toLocaleString()} → {new Date(b.scheduledEndAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">{t('detail.route')}: </span>
              {b.pickup.addressLine} → {b.dropoff.addressLine}
            </div>
            <div>
              <span className="text-muted-foreground">{t('vehicle')}: </span>
              <span dir="ltr">{b.vehiclePlateSnapshot}</span> · {b.vehicleDescriptionSnapshot}
            </div>
            <div>
              <span className="text-muted-foreground">{t('detail.owner')}: </span>
              {b.ownerNameSnapshot}
            </div>
            <div>
              <span className="text-muted-foreground">{t('detail.driver')}: </span>
              {b.driverName ?? t('detail.noDriver')}
              {b.trip && (
                <span className="ms-2 text-muted-foreground" dir="ltr">
                  ({t('detail.trip')} {b.trip.tripNumber})
                </span>
              )}
              {b.trip && (
                <Link href={`/track/${b.trip.id}`} className="ms-2 text-primary underline-offset-4 hover:underline">
                  {t('detail.track')}
                </Link>
              )}
            </div>
            {b.paymentDueBy && b.status === 'PENDING_PAYMENT' && (
              <div className="text-muted-foreground" dir="ltr">
                {t('detail.paymentDue')}: {new Date(b.paymentDueBy).toLocaleString()}
              </div>
            )}
          </CardContent>
        </Card>
        {f && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('detail.financial')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm" dir="ltr">
              <div className="flex justify-between"><span>{t('detail.gross')}</span><span>{f.grossAmount}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>{t('detail.commission')}</span><span>−{f.commissionAmount}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>{t('detail.commissionVat')}</span><span>−{f.commissionVatAmount}</span></div>
              <div className="flex justify-between font-medium"><span>{t('detail.net')}</span><span>{f.ownerNetAmount} {b.currency}</span></div>
            </CardContent>
          </Card>
        )}
        {b.cancellation && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('detail.cancellation')}</CardTitle>
              <CardDescription>{t('detail.cancelledBy', { role: b.cancellation.cancelledByRole })} · {t(`reasons.${b.cancellation.reasonCode}` as 'reasons.OTHER')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm" dir="ltr">
              <div className="flex justify-between"><span>{t('detail.fee')}</span><span>{b.cancellation.cancellationFeeAmount}</span></div>
              <div className="flex justify-between"><span>{t('detail.refund')}</span><span>{b.cancellation.refundAmount}</span></div>
              {b.cancellation.feeWaivedAt && <Badge variant="secondary">{t('detail.feeWaived')}</Badge>}
            </CardContent>
          </Card>
        )}
      </div>

      {isCustomer && b.billingMode === 'PREPAID' && (b.status === 'PENDING_PAYMENT' || returnedPaymentId) && (
        <PayNow booking={b} returnedPaymentId={returnedPaymentId} onPaid={() => void load()} />
      )}

      {(isCustomer || isOwner || staff) && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            {(isOwner || staff) && b.status === 'CONFIRMED' && (
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="driver">{t('detail.selectDriver')}</Label>
                  <select id="driver" className="flex h-9 min-w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={driverId} onChange={(e) => { setDriverId(e.target.value); }}>
                    {drivers?.map((d) => (
                      <option key={d.id} value={d.driverProfileId}>
                        {d.driverName}
                      </option>
                    ))}
                  </select>
                </div>
                <Button disabled={busy || !driverId} onClick={() => void assign()}>
                  {busy && <Loader2 className="animate-spin" />}
                  {t('detail.assignDriver')}
                </Button>
                {drivers?.length === 0 && <span className="text-xs text-muted-foreground">{t('detail.noDrivers')}</span>}
              </div>
            )}
            {(isOwner || staff) && b.status === 'DRIVER_ASSIGNED' && (
              <Button disabled={busy} onClick={() => void ready()}>
                {t('detail.ready')}
              </Button>
            )}
            {CANCELLABLE.includes(b.status) && (
              <Button variant="destructive" onClick={() => { setCancelOpen(true); }}>
                {t('detail.cancel')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('detail.history')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {history.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1 last:border-0">
              <span>
                <Badge variant="outline">{t(`status.${h.toStatus}` as 'status.CONFIRMED')}</Badge>
                {h.reason && <span className="ms-2 text-muted-foreground">{h.reason}</span>}
              </span>
              <span className="text-xs text-muted-foreground" dir="ltr">
                {new Date(h.occurredAt).toLocaleString()}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {cancelOpen && (
        <CancelDialog
          booking={b}
          onClose={() => { setCancelOpen(false); }}
          onCancelled={(r) => {
            setNotice(t('detail.cancelled', { fee: r.cancellation.cancellationFeeAmount, refund: r.cancellation.refundAmount }));
            setB(r.booking);
            void load();
          }}
        />
      )}
    </div>
  );
}

/** The quote is fetched first so the customer sees exactly what the cancel will charge (api.md §8.14). */
function CancelDialog({ booking, onClose, onCancelled }: { booking: BookingDto; onClose: () => void; onCancelled: (r: CancelBookingResultDto) => void }) {
  const t = useTranslations('portal.bookings');
  const tc = useTranslations('common');
  const [quote, setQuote] = useState<CancellationQuoteDto | null>(null);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    void api<CancellationQuoteDto>(`/bookings/${booking.id}/cancellation-quote`).then((res) => {
      if (res.ok) {
        setQuote(res.data);
        setReason(res.data.allowedReasonCodes[0] ?? '');
      } else setError(res.error);
    });
  }, [booking.id]);

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await api<CancelBookingResultDto>(`/bookings/${booking.id}/cancel`, { method: 'POST', body: { reasonCode: reason, ...(text.trim() ? { reasonText: text.trim() } : {}) }, headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCancelled(res.data);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle dir="ltr">{t('detail.cancelTitle', { number: booking.bookingNumber })}</DialogTitle>
          <DialogDescription>{quote ? t('detail.cancelDescription', { hours: quote.hoursBeforePickup }) : ''}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
          </Alert>
        )}
        {quote && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between" dir="ltr"><span>{t('detail.fee')}</span><span>{quote.feeAmount} {quote.currency}</span></div>
            <div className="flex justify-between font-medium" dir="ltr"><span>{t('detail.refund')}</span><span>{quote.refundAmount} {quote.currency}</span></div>
            {quote.windowPassed && <p className="text-destructive">{t('detail.windowPassed')}</p>}
            <div className="space-y-1">
              <Label htmlFor="cancel-reason">{t('detail.reason')}</Label>
              <select id="cancel-reason" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={reason} onChange={(e) => { setReason(e.target.value); }}>
                {quote.allowedReasonCodes.map((c) => (
                  <option key={c} value={c}>
                    {t(`reasons.${c}` as 'reasons.OTHER')}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cancel-text">{t('detail.reasonText')}</Label>
              <Input id="cancel-text" value={text} onChange={(e) => { setText(e.target.value); }} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="destructive" disabled={!quote || quote.windowPassed || busy || (reason === 'OTHER' && !text.trim())} onClick={() => void confirm()}>
            {busy && <Loader2 className="animate-spin" />}
            {t('detail.confirmCancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
