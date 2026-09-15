'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Code input with a resend cool-down driven by the API's `resendAfterSeconds`. */
export function OtpField({
  code,
  onChange,
  sentTo,
  resendAfterSeconds,
  onResend,
  disabled,
}: {
  code: string;
  onChange: (v: string) => void;
  sentTo: string | null;
  resendAfterSeconds: number;
  onResend: () => Promise<void>;
  disabled?: boolean;
}) {
  const t = useTranslations('auth');
  const [left, setLeft] = useState(resendAfterSeconds);
  useEffect(() => {
    setLeft(resendAfterSeconds);
  }, [resendAfterSeconds, sentTo]);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => {
      setLeft((s) => s - 1);
    }, 1000);
    return () => {
      clearTimeout(id);
    };
  }, [left]);

  return (
    <div className="space-y-2">
      <Label htmlFor="otp">{t('code')}</Label>
      <Input id="otp" inputMode="numeric" autoComplete="one-time-code" pattern="\d*" maxLength={8} value={code} onChange={(e) => { onChange(e.target.value.replace(/\D/g, '')); }} disabled={disabled} dir="ltr" className="text-center text-lg tracking-[0.5em]" />
      {sentTo && <p className="text-xs text-muted-foreground">{t('codeSentTo', { destination: sentTo })}</p>}
      <Button type="button" variant="link" size="sm" className="h-auto p-0" disabled={left > 0 || disabled} onClick={() => void onResend()}>
        {left > 0 ? t('resendIn', { seconds: left }) : t('resendCode')}
      </Button>
    </div>
  );
}
