'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { AuthResultDto, RegisterResultDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { Link, useRouter } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OtpField } from './otp-field';

/** Registration → REGISTRATION OTP → session (api.md §8.1). The terms version comes from public settings. */
export function RegisterForm() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [termsVersion, setTermsVersion] = useState('1.0');

  const [form, setForm] = useState({ intent: 'CUSTOMER', phoneE164: '', email: '', password: '', fullNameEn: '', fullNameAr: '', accepted: false });
  const [registered, setRegistered] = useState<RegisterResultDto | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    void api<{ key: string; value: unknown }[]>('/settings/public').then((res) => {
      const v = res.ok ? res.data.find((s) => s.key === 'platform.terms_version')?.value : null;
      if (typeof v === 'string' && v) setTermsVersion(v);
    });
  }, []);

  const fe = fieldErrors(error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => { setForm((f) => ({ ...f, [k]: e.target.value })); };

  async function onRegister(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<RegisterResultDto>('/auth/register', {
      method: 'POST',
      retryOnExpired: false,
      body: {
        intent: form.intent,
        phoneE164: form.phoneE164.trim(),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        password: form.password,
        fullNameEn: form.fullNameEn.trim(),
        ...(form.fullNameAr.trim() ? { fullNameAr: form.fullNameAr.trim() } : {}),
        preferredLocale: locale,
        acceptedTermsVersion: termsVersion,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRegistered(res.data);
  }

  async function resend() {
    setError(null);
    const res = await api('/auth/otp/request', { method: 'POST', body: { channel: 'SMS', destination: form.phoneE164.trim(), purpose: 'REGISTRATION' }, retryOnExpired: false });
    if (!res.ok) setError(res.error);
  }

  async function onVerify(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<AuthResultDto>('/auth/otp/verify', { method: 'POST', body: { channel: 'SMS', destination: form.phoneE164.trim(), purpose: 'REGISTRATION', code, clientType: 'WEB' }, retryOnExpired: false });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.replace('/dashboard');
  }

  if (registered) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t('verifyPhoneTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onVerify(e)} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
              </Alert>
            )}
            <OtpField code={code} onChange={setCode} sentTo={registered.otpSentTo} resendAfterSeconds={60} onResend={resend} disabled={busy} />
            <Button type="submit" className="w-full" disabled={busy || code.length < 4}>
              {busy && <Loader2 className="animate-spin" />}
              {t('verify')}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('register')}</CardTitle>
        <CardDescription>{t('registerSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onRegister(e)} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label>{t('intent')}</Label>
            <Select value={form.intent} onValueChange={(v) => { setForm((f) => ({ ...f, intent: v })); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CUSTOMER">{t('intentCustomer')}</SelectItem>
                <SelectItem value="VEHICLE_OWNER">{t('intentOwner')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullNameEn">{t('fullNameEn')}</Label>
            <Input id="fullNameEn" autoComplete="name" value={form.fullNameEn} onChange={set('fullNameEn')} required />
            {fe['fullNameEn'] && <p className="text-xs text-destructive">{fe['fullNameEn']}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullNameAr">{t('fullNameAr')}</Label>
            <Input id="fullNameAr" value={form.fullNameAr} onChange={set('fullNameAr')} dir="rtl" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phoneE164">{t('phone')}</Label>
            <Input id="phoneE164" type="tel" autoComplete="tel" placeholder={t('phonePlaceholder')} value={form.phoneE164} onChange={set('phoneE164')} required dir="ltr" />
            {fe['phoneE164'] && <p className="text-xs text-destructive">{fe['phoneE164']}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} dir="ltr" />
            {fe['email'] && <p className="text-xs text-destructive">{fe['email']}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('password')}</Label>
            <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={10} dir="ltr" />
            <p className="text-xs text-muted-foreground">{fe['password'] ?? t('passwordHint')}</p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={form.accepted} onChange={(e) => { setForm((f) => ({ ...f, accepted: e.target.checked })); }} required />
            <span>{t('acceptTerms')}</span>
          </label>
          <Button type="submit" className="w-full" disabled={busy || !form.accepted}>
            {busy && <Loader2 className="animate-spin" />}
            {t('register')}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('haveAccount')}{' '}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            {t('signIn')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
