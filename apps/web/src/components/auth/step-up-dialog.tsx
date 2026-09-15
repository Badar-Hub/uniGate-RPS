'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { OtpRequestResultDto, StepUpResultDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OtpField } from './otp-field';

/**
 * Step-up authentication for sensitive actions (api.md §6.2): requests a one-time code for the
 * action class, verifies it and hands the short-lived step-up token to the caller.
 */
export function StepUpDialog({ actionClass, onVerified, onClose }: { actionClass: string; onVerified: (stepUpToken: string) => void; onClose: () => void }) {
  const t = useTranslations('auth.stepUp');
  const tc = useTranslations('common');
  const [sent, setSent] = useState<OtpRequestResultDto | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function requestCode() {
    setError(null);
    const res = await api<OtpRequestResultDto>('/auth/step-up', { method: 'POST', body: { actionClass } });
    if (res.ok) setSent(res.data);
    else setError(res.error);
  }
  useEffect(() => {
    void requestCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- request once when the dialog opens
  }, [actionClass]);

  async function verify() {
    setBusy(true);
    setError(null);
    const res = await api<StepUpResultDto>('/auth/step-up/verify', { method: 'POST', body: { actionClass, code } });
    setBusy(false);
    if (res.ok) onVerified(res.data.stepUpToken);
    else setError(res.error);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
        )}
        <OtpField code={code} onChange={setCode} sentTo={sent?.sentTo ?? null} resendAfterSeconds={sent?.resendAfterSeconds ?? 60} onResend={requestCode} disabled={busy} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
          <Button onClick={() => void verify()} disabled={busy || code.length < 4}>
            {busy && <Loader2 className="animate-spin" />}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
