'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { OwnerDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RatingPrompt } from '@/components/portal/engagement/rating-prompt';

const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  DOCUMENTS_SUBMITTED: 'secondary',
  UNDER_REVIEW: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  SUSPENDED: 'destructive',
};

export function Dashboard() {
  const { me } = useSession();
  const t = useTranslations('portal');
  const tc = useTranslations('common');
  const [owner, setOwner] = useState<OwnerDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profiles.owner) return;
    void api<OwnerDto>('/me/owner-profile').then((res) => {
      if (res.ok) setOwner(res.data);
    });
  }, [me]);

  async function submitForReview() {
    if (!owner) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await api<OwnerDto>(`/owners/${owner.id}/submit-for-review`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOwner(res.data);
    setNotice(t('onboarding.submitted'));
  }

  if (!me) return null;
  const p = me.profiles;
  const missing = (error?.details as { missing?: string[] } | undefined)?.missing;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('welcome', { name: me.fullNameEn })}</h1>
      <RatingPrompt />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('profileSummary')}</CardTitle>
            <CardDescription>
              {t('roles')}: {me.roles.join(' · ')} · {t('permissions', { count: me.permissions.length })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {p.customer && <Badge variant="secondary">{t('customerProfile')}</Badge>}
            {p.owner && <Badge variant="secondary">{t('ownerProfileCard')}</Badge>}
            {p.driver && <Badge variant="secondary">{t('driverProfile')}</Badge>}
            {p.spo && <Badge variant="secondary">{t('spoProfile')}</Badge>}
            {!p.customer && !p.owner && !p.driver && !p.spo && <span className="text-sm text-muted-foreground">{t('noProfiles')}</span>}
          </CardContent>
        </Card>

        {p.owner && (
          <Card>
            <CardHeader>
              <CardTitle>{t('onboarding.title')}</CardTitle>
              <CardDescription>{t('ownerProfileCard')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!owner ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_TONE[owner.onboardingStatus] ?? 'outline'}>{owner.onboardingStatus}</Badge>
                    <span className="text-sm text-muted-foreground">{t(`onboarding.${owner.onboardingStatus}` as 'onboarding.DRAFT')}</span>
                  </div>
                  {owner.rejectionReason && owner.onboardingStatus !== 'APPROVED' && <p className="text-sm text-destructive">{owner.rejectionReason}</p>}
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="size-4" />
                      <AlertDescription>
                        {errorMessage(tc, error)}
                        {missing?.length ? <div className="mt-1 text-xs">{t('onboarding.missing', { codes: missing.join(', ') })}</div> : null}
                      </AlertDescription>
                    </Alert>
                  )}
                  {notice && (
                    <Alert>
                      <CheckCircle2 className="size-4" />
                      <AlertDescription>{notice}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/documents">{t('nav.documents')}</Link>
                    </Button>
                    {['DRAFT', 'DOCUMENTS_SUBMITTED', 'REJECTED'].includes(owner.onboardingStatus) && (
                      <Button size="sm" disabled={busy} onClick={() => void submitForReview()}>
                        {busy && <Loader2 className="animate-spin" />}
                        {t('onboarding.submit')}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
