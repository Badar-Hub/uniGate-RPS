'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, ChevronRight, Loader2, Navigation } from 'lucide-react';
import type { TripDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export const TRIP_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRIVER_ASSIGNED: 'secondary', DRIVER_EN_ROUTE: 'default', ARRIVED_AT_PICKUP: 'default', TRIP_STARTED: 'default', IN_PROGRESS: 'default', LOADING: 'default', LOADED: 'default', IN_TRANSIT: 'default',
  ARRIVED_AT_DESTINATION: 'default', UNLOADING: 'default', DELIVERED: 'default', COMPLETED: 'outline', CANCELLED: 'destructive', EXCEPTION: 'destructive', BOOKED: 'outline',
};

/** The driver's trips: active first, then upcoming; big tap targets. */
export function DriverTrips() {
  const t = useTranslations('driver');
  const tc = useTranslations('common');
  const [rows, setRows] = useState<TripDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    void api<TripDto[]>('/trips', { query: { pageSize: 50 } }).then((res) => {
      if (res.ok) setRows(res.data.filter((r) => r.status !== 'COMPLETED' && r.status !== 'CANCELLED').concat(res.data.filter((r) => r.status === 'COMPLETED' || r.status === 'CANCELLED').slice(0, 5)));
      else setError(res.error);
    });
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
        </Alert>
      )}
      {rows === null && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {rows?.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      <div className="space-y-3">
        {rows?.map((r) => (
          <Link key={r.id} href={`/driver/trips/${r.id}`} className="block">
            <Card className="active:bg-muted">
              <CardContent className="flex items-center gap-3 p-4">
                <Navigation className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium" dir="ltr">
                      {r.tripNumber}
                    </span>
                    <Badge variant={TRIP_TONE[r.status] ?? 'outline'}>{t(`trip.status.${r.status}` as 'trip.status.BOOKED')}</Badge>
                  </div>
                  <div className="truncate text-sm text-muted-foreground">{r.pickup.addressLine}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">
                    {new Date(r.scheduledStartAt).toLocaleString()} · {r.vehicle.plateNumberEn}
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
