'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { BookingDto, CreatePaymentResultDto, PaymentConfigDto, PaymentStatusDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

/**
 * Pay-now for a PENDING_PAYMENT booking: creates the intent and follows the gateway action.
 * When the browser returns (?payment=…), the panel polls GET /payments/{id}/status with a bounded
 * backoff — it never assumes success from the return itself (api.md §10).
 */
export function PayNow({ booking, returnedPaymentId, onPaid }: { booking: BookingDto; returnedPaymentId: string | null; onPaid: () => void }) {
  const t = useTranslations('portal.payments');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [cfg, setCfg] = useState<PaymentConfigDto | null>(null);
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [poll, setPoll] = useState<PaymentStatusDto | null>(null);
  const [polling, setPolling] = useState(Boolean(returnedPaymentId));
  const [bankRef, setBankRef] = useState<string | null>(null);

  useEffect(() => {
    void api<PaymentConfigDto>('/payments/config').then((res) => {
      if (res.ok) {
        setCfg(res.data);
        setMethod((m) => m || (res.data.methodTypes[0] ?? ''));
      } else setError(res.error);
    });
  }, []);

  // Bounded backoff: 1s, 2s, 3s … up to ~45s total, then stop and tell the user the page keeps checking on reload.
  useEffect(() => {
    if (!returnedPaymentId) return;
    let attempt = 0;
    let timer: number | undefined;
    let cancelled = false;
    const tick = async () => {
      const res = await api<PaymentStatusDto>(`/payments/${returnedPaymentId}/status`);
      if (cancelled) return;
      if (res.ok) {
        setPoll(res.data);
        if (res.data.status === 'PAID' || res.data.status === 'FAILED' || res.data.status === 'CANCELLED') {
          setPolling(false);
          if (res.data.status === 'PAID') onPaid();
          return;
        }
      }
      attempt++;
      if (attempt >= 9) {
        setPolling(false);
        return;
      }
      timer = window.setTimeout(() => void tick(), Math.min(1000 * attempt, 8000));
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [returnedPaymentId, onPaid]);

  async function start() {
    if (!method) return;
    setBusy(true);
    setError(null);
    const returnUrl = `${window.location.origin}/${locale}/bookings/${booking.id}`;
    const res = await api<CreatePaymentResultDto>('/payments', { method: 'POST', body: { bookingId: booking.id, amount: booking.totalAmount, currency: booking.currency, methodType: method, returnUrl }, headers: { 'Idempotency-Key': idempotencyKey() } });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    const { action, payment } = res.data;
    if (action.type === 'REDIRECT' && action.url) {
      // The return URL carries the payment id so the page knows what to poll; the state itself comes from the API.
      const back = new URL(action.url);
      back.searchParams.set('return', `${returnUrl}?payment=${payment.id}`);
      window.location.assign(back.toString());
      return;
    }
    setBusy(false);
    if (action.type === 'NONE') {
      const ref = action.clientPayload?.['reference'];
      setBankRef(typeof ref === 'string' ? ref : payment.paymentNumber);
    }
  }

  if (returnedPaymentId) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          {polling && (
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              {t('confirming')}
            </div>
          )}
          {poll?.status === 'PAID' && (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertDescription>{t('confirmed')}</AlertDescription>
            </Alert>
          )}
          {(poll?.status === 'FAILED' || poll?.status === 'CANCELLED') && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{t('failed', { code: poll.failureCode ?? poll.status })}</AlertDescription>
            </Alert>
          )}
          {!polling && poll && poll.status !== 'PAID' && poll.status !== 'FAILED' && poll.status !== 'CANCELLED' && (
            <p className="text-muted-foreground">{t('stillPending', { due: booking.paymentDueBy ? new Date(booking.paymentDueBy).toLocaleString() : '' })}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('payNow')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
          </Alert>
        )}
        {bankRef ? (
          <p className="text-sm">{t('bankTransfer', { reference: bankRef })}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="pay-method">{t('method')}</Label>
              <select id="pay-method" className="flex h-9 min-w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={method} onChange={(e) => { setMethod(e.target.value); }}>
                {cfg?.methodTypes.map((m) => (
                  <option key={m} value={m}>
                    {t(`methods.${m}` as 'methods.MADA')}
                  </option>
                ))}
              </select>
            </div>
            <Button disabled={busy || !method || !cfg} onClick={() => void start()}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? t('redirecting') : t('pay', { amount: booking.totalAmount, currency: booking.currency })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
