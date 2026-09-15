'use client';

import { useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Always shows the same confirmation — the API never reveals whether the identifier exists (api.md §4.6). */
export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api('/auth/password/forgot', { method: 'POST', body: { identifier: identifier.trim() }, retryOnExpired: false });
    setBusy(false);
    if (!res.ok && res.error.status !== 200) {
      setError(res.error);
      return;
    }
    setDone(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('forgotTitle')}</CardTitle>
        <CardDescription>{t('forgotSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        {done ? (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>{t('forgotSent')}</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="identifier">{t('identifier')}</Label>
              <Input id="identifier" autoComplete="username" placeholder={t('identifierPlaceholder')} value={identifier} onChange={(e) => { setIdentifier(e.target.value); }} required dir="ltr" />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {tc('continue')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            {t('signIn')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const fe = fieldErrors(error);

  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    const res = await api('/auth/password/reset', { method: 'POST', body: { token, newPassword: password }, retryOnExpired: false });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('resetTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {!token ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{t('resetInvalidLink')}</AlertDescription>
          </Alert>
        ) : done ? (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>{t('resetDone')}</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t('newPassword')}</Label>
              <Input id="newPassword" type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); }} required minLength={10} dir="ltr" />
              <p className="text-xs text-muted-foreground">{fe['newPassword'] ?? t('passwordHint')}</p>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {tc('save')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            {t('signIn')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
