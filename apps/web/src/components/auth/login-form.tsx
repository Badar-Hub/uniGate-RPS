'use client';

import { useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { AuthResultDto, OtpRequestResultDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Link, useRouter } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OtpField } from './otp-field';

/**
 * Password or OTP sign-in in cookie mode: the API sets ug_at/ug_rt, the body carries
 * `tokens: null`, and the portal boots from /me.
 */
export function LoginForm({ next = '/dashboard' }: { next?: string }) {
  /** A driver-only account belongs in the driver app unless a specific page was requested. */
  const destination = (roles: string[]) => (next === '/dashboard' && roles.length === 1 && roles[0] === 'DRIVER' ? '/driver' : next);
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState<OtpRequestResultDto | null>(null);
  const [code, setCode] = useState('');

  async function onPassword(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<AuthResultDto>('/auth/login', { method: 'POST', body: { identifier: identifier.trim(), password, clientType: 'WEB' }, retryOnExpired: false });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.replace(destination(res.data.roles));
  }

  async function sendCode() {
    setBusy(true);
    setError(null);
    const res = await api<OtpRequestResultDto>('/auth/otp/request', { method: 'POST', body: { channel: 'SMS', destination: phone.trim(), purpose: 'LOGIN' }, retryOnExpired: false });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent(res.data);
    setCode('');
  }

  async function onOtp(e: SyntheticEvent) {
    e.preventDefault();
    if (!sent) {
      await sendCode();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api<AuthResultDto>('/auth/otp/verify', { method: 'POST', body: { channel: 'SMS', destination: phone.trim(), purpose: 'LOGIN', code, clientType: 'WEB' }, retryOnExpired: false });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.replace(destination(res.data.roles));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('signIn')}</CardTitle>
        <CardDescription>{t('signInSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="password" onValueChange={() => { setError(null); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="password">{t('passwordTab')}</TabsTrigger>
            <TabsTrigger value="otp">{t('otpTab')}</TabsTrigger>
          </TabsList>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="size-4" />
              <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
            </Alert>
          )}

          <TabsContent value="password">
            <form onSubmit={(e) => void onPassword(e)} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="identifier">{t('identifier')}</Label>
                <Input id="identifier" autoComplete="username" placeholder={t('identifierPlaceholder')} value={identifier} onChange={(e) => { setIdentifier(e.target.value); }} required dir="ltr" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t('password')}</Label>
                  <Link href="/forgot-password" className="text-xs text-primary underline-offset-4 hover:underline">
                    {t('forgotPassword')}
                  </Link>
                </div>
                <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); }} required dir="ltr" />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {t('signIn')}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="otp">
            <form onSubmit={(e) => void onOtp(e)} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="phone">{t('phone')}</Label>
                <Input id="phone" type="tel" autoComplete="tel" placeholder={t('phonePlaceholder')} value={phone} onChange={(e) => { setPhone(e.target.value); }} required disabled={Boolean(sent)} dir="ltr" />
              </div>
              {sent && <OtpField code={code} onChange={setCode} sentTo={sent.sentTo} resendAfterSeconds={sent.resendAfterSeconds} onResend={sendCode} disabled={busy} />}
              <Button type="submit" className="w-full" disabled={busy || (Boolean(sent) && code.length < 4)}>
                {busy && <Loader2 className="animate-spin" />}
                {sent ? t('verify') : t('sendCode')}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('noAccount')}{' '}
          <Link href="/register" className="text-primary underline-offset-4 hover:underline">
            {t('register')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
