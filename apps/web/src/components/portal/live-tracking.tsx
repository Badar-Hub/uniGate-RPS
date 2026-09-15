'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2, Phone, Radio } from 'lucide-react';
import type { TripTrackingDto, TrackingPositionDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { joinRoom, leaveRoom, realtime } from '@/lib/realtime';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const TripMap = dynamic(() => import('./trip-map').then((m) => m.TripMap), { ssr: false, loading: () => <div className="h-72 animate-pulse rounded-md bg-muted" /> });

interface LocationEvent {
  tripId: string;
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  speedKmh: number | null;
  accuracyM: number | null;
  recordedAt: string;
}

/**
 * The customer's live-tracking page (api.md §6.4 GET /tracking/trips/{id}, §9). The HTTP read is
 * the source of truth; the socket only refreshes the dot. A polling fallback covers a dead socket.
 */
export function LiveTracking({ tripId }: { tripId: string }) {
  const t = useTranslations('portal.tracking');
  const tc = useTranslations('common');
  const [data, setData] = useState<TripTrackingDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [position, setPosition] = useState<TrackingPositionDto | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const res = await api<TripTrackingDto>(`/tracking/trips/${tripId}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setData(res.data);
    setPosition(res.data.position);
  }, [tripId]);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), 15_000);
    const tick = window.setInterval(() => { setNow(Date.now()); }, 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load]);

  useEffect(() => {
    const room = `trip:${tripId}`;
    const s = realtime();
    const onLoc = (e: LocationEvent) => {
      if (e.tripId !== tripId) return;
      setPosition({ latitude: e.latitude, longitude: e.longitude, headingDeg: e.headingDeg, speedKmh: e.speedKmh, accuracyM: e.accuracyM, recordedAt: e.recordedAt, ageSeconds: 0, stale: false });
    };
    const onStatus = () => void load();
    const onConnect = () => {
      void joinRoom(room).then((ack) => { setLive(ack.ok); });
    };
    s.on('trip.location', onLoc);
    s.on('trip.status', onStatus);
    s.on('connect', onConnect);
    s.on('disconnect', () => { setLive(false); });
    if (s.connected) onConnect();
    return () => {
      s.off('trip.location', onLoc);
      s.off('trip.status', onStatus);
      s.off('connect', onConnect);
      leaveRoom(room);
    };
  }, [tripId, load]);

  if (!data) {
    return error ? (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
      </Alert>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    );
  }
  const ago = position ? Math.max(0, Math.round((now - new Date(position.recordedAt).getTime()) / 1000)) : null;
  const stale = ago !== null && ago > 120;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground" dir="ltr">
            {data.bookingNumber}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{t(`status.${data.tripStatus}` as 'status.BOOKED')}</Badge>
          <Badge variant={live ? 'default' : 'outline'}>
            <Radio className="me-1 size-3" />
            {live ? t('live') : t('reconnecting')}
          </Badge>
        </div>
      </div>
      <TripMap position={position} pickup={data.pickup} destination={data.destination} />
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            {position ? (
              <>
                <div className="text-muted-foreground" dir="ltr">
                  {t('lastSeen', { ago })}
                  {position.speedKmh !== null ? ` · ${position.speedKmh} km/h` : ''}
                </div>
                {stale && <div className="text-amber-700">{t('stale')}</div>}
              </>
            ) : (
              <div className="text-muted-foreground">{t('noPosition')}</div>
            )}
            {data.eta && (
              <div dir="ltr">
                {t('eta')}: {new Date(data.eta.arrivalAt).toLocaleTimeString()} · {t('remaining', { km: data.eta.remainingDistanceKm })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <div>
              <span className="text-muted-foreground">{t('vehicle')}: </span>
              <span dir="ltr">{data.vehicle.plateNumberEn}</span> · {data.vehicle.description}
            </div>
            {data.driver && (
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="text-muted-foreground">{t('driver')}: </span>
                  {data.driver.fullNameEn} · ★ {data.driver.ratingAvg}
                </span>
                {data.driver.phoneE164 && (
                  <Button asChild size="sm" variant="outline">
                    <a href={`tel:${data.driver.phoneE164}`}>
                      <Phone className="size-4" />
                      {t('call')}
                    </a>
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
