'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { OpportunityDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** The owner's opportunity feed: redacted requests matched to their fleet, best vehicle first. */
export function Opportunities() {
  const t = useTranslations('portal.opportunities');
  const tr = useTranslations('portal.requests');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [rows, setRows] = useState<OpportunityDto[] | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    const res = await api<OpportunityDto[]>('/opportunities', { query: { pageSize: 50, includeDismissed: showDismissed ? 'true' : undefined } });
    if (res.ok) setRows(res.data);
    else setError(res.error);
  }, [showDismissed]);
  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(o: OpportunityDto) {
    const res = await api(`/opportunities/${o.id}/dismiss`, { method: 'POST', query: { undo: o.dismissedAt ? 'true' : undefined } });
    if (!res.ok) setError(res.error);
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showDismissed} onChange={(e) => { setShowDismissed(e.target.checked); }} />
          {t('showDismissed')}
        </label>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
        </Alert>
      )}
      {rows === null && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {rows?.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {rows?.map((o) => {
          const r = o.request;
          return (
            <Card key={o.id} className={o.dismissedAt ? 'opacity-60' : ''}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{r.vehicleCategory ? (locale === 'ar' ? r.vehicleCategory.nameAr : r.vehicleCategory.nameEn) : r.transportType}</CardTitle>
                    <CardDescription>
                      {r.pickup.addressLine} → {r.dropoff.addressLine}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">
                    {t('match')} {o.matchScore}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" dir="ltr">
                    {new Date(r.pickupAt).toLocaleString()}
                  </Badge>
                  {r.passengerDetails && <Badge variant="outline">{t('passengers', { count: r.passengerDetails.passengerCount })}</Badge>}
                  <Badge variant="outline">
                    {r.vehiclesRequired - r.vehiclesAwarded}/{r.vehiclesRequired} {tr('vehicles').toLowerCase()}
                  </Badge>
                  {r.estimatedDistanceKm && <Badge variant="outline">{tr('detail.distance', { km: r.estimatedDistanceKm })}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground" dir="ltr">
                  {t('closes', { date: new Date(r.biddingClosesAt).toLocaleString() })}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('eligible')}</div>
                  <div className="flex flex-wrap gap-1">
                    {o.eligibleVehicles.map((v) => (
                      <Badge key={v.id} variant="secondary" dir="ltr">
                        {v.plateNumberEn}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{t('bidSoon')}</span>
                  <Button size="sm" variant="ghost" onClick={() => void dismiss(o)}>
                    {o.dismissedAt ? t('undo') : t('dismiss')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
