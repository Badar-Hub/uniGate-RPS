'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The MockGateway's hosted checkout. Choosing an outcome asks the API's dev-only endpoint, which
 * makes the gateway deliver its signed webhook to the API — the browser never tells UniGate the
 * payment succeeded; it only navigates back and the booking page polls the real state.
 */
export function MockCheckout({ providerPaymentId, returnUrl }: { providerPaymentId: string; returnUrl: string | null }) {
  const t = useTranslations('portal.payments.mock');
  const tc = useTranslations('common');
  const [busy, setBusy] = useState<'SUCCESS' | 'DECLINE' | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function choose(outcome: 'SUCCESS' | 'DECLINE') {
    setBusy(outcome);
    setError(null);
    const res = await api(`/payments/mock/checkout/${providerPaymentId}`, { method: 'POST', body: { outcome } });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
    if (returnUrl) {
      window.setTimeout(() => {
        window.location.assign(returnUrl);
      }, 800);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error.status === 502 || error.status === 500 ? t('unknown') : errorMessage(tc, error)}</AlertDescription>
            </Alert>
          )}
          <div className="text-xs text-muted-foreground" dir="ltr">
            {providerPaymentId}
          </div>
          {done ? (
            <p className="text-sm">{t('done')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <Button disabled={busy !== null} onClick={() => void choose('SUCCESS')}>
                {busy === 'SUCCESS' && <Loader2 className="animate-spin" />}
                {t('succeed')}
              </Button>
              <Button variant="outline" disabled={busy !== null} onClick={() => void choose('DECLINE')}>
                {busy === 'DECLINE' && <Loader2 className="animate-spin" />}
                {t('decline')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
