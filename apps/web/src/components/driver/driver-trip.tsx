'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2, LocateFixed, LocateOff, MapPin, Radio } from 'lucide-react';
import type { TripDto, TripStatusResultDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { PING_INTERVAL_MS, tracker, type TrackerState } from '@/lib/driver/tracker';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TRIP_TONE } from './driver-trips';

/** Statuses during which the device should be streaming its position. */
const TRACKING_STATUSES = ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'TRIP_STARTED', 'IN_PROGRESS', 'LOADING', 'LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING', 'DELIVERED', 'EXCEPTION'];
const ODOMETER_STATUSES = ['TRIP_STARTED', 'LOADED', 'COMPLETED', 'DELIVERED'];

/**
 * The driver's trip screen: the status buttons the API allows (allowedNextStatuses), the odometer
 * prompt where the step needs it, and the live-location agent — started automatically when the
 * trip is in a tracked state and stopped when it ends.
 */
export function DriverTrip({ id }: { id: string }) {
  const t = useTranslations('driver.trip');
  const tc = useTranslations('common');
  const [trip, setTrip] = useState<TripDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [odometer, setOdometer] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [track, setTrack] = useState<TrackerState>(tracker().snapshot);
  const [manualOff, setManualOff] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const res = await api<TripDto>(`/trips/${id}`);
    if (res.ok) setTrip(res.data);
    else setError(res.error);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => tracker().subscribe(setTrack), []);
  useEffect(() => {
    const i = window.setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { window.clearInterval(i); };
  }, []);

  // The agent follows the trip state: on while tracked (unless the driver switched it off), off otherwise.
  const shouldTrack = Boolean(trip && TRACKING_STATUSES.includes(trip.status) && !manualOff);
  useEffect(() => {
    if (shouldTrack) void tracker().start(id);
    else if (tracker().snapshot.tripId === id) tracker().stop();
  }, [shouldTrack, id]);
  useEffect(() => () => { if (tracker().snapshot.tripId === id) tracker().stop(); }, [id]);

  async function move(status: string) {
    if (!trip) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const pos = track.last;
    const body = {
      status,
      occurredAt: new Date().toISOString(),
      ...(pos ? { latitude: pos.latitude, longitude: pos.longitude, ...(pos.accuracyM !== undefined ? { accuracyM: pos.accuracyM } : {}) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(ODOMETER_STATUSES.includes(status) && odometer.trim() ? { odometerKm: Number(odometer) } : {}),
    };
    const res = await api<TripStatusResultDto>(`/trips/${id}/status`, { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPending(null);
    setOdometer('');
    setNote('');
    setNotice(t('updated', { status: t(`status.${res.data.status}` as 'status.BOOKED') }));
    await load();
  }

  if (!trip) {
    return error ? (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
      </Alert>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    );
  }
  const terminal = trip.status === 'COMPLETED' || trip.status === 'CANCELLED';
  const nextStatuses = trip.allowedNextStatuses.filter((s) => s !== 'CANCELLED');
  const needsOdometer = pending !== null && ODOMETER_STATUSES.includes(pending);
  const lastAgo = track.last ? Math.max(0, Math.round((now - new Date(track.last.recordedAt).getTime()) / 1000)) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold" dir="ltr">
            {trip.tripNumber}
          </h1>
          <p className="text-xs text-muted-foreground" dir="ltr">
            {trip.bookingNumber} · {trip.vehicle.plateNumberEn}
          </p>
        </div>
        <Badge variant={TRIP_TONE[trip.status] ?? 'outline'}>{t(`status.${trip.status}` as 'status.BOOKED')}</Badge>
      </div>
      {notice && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">{t('pickup')}</div>
              <div>{trip.pickup.addressLine}</div>
              <a className="text-xs text-primary underline-offset-4 hover:underline" href={`https://www.google.com/maps/dir/?api=1&destination=${trip.pickup.latitude},${trip.pickup.longitude}`} target="_blank" rel="noreferrer">
                {t('openMap')}
              </a>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">{t('dropoff')}</div>
              <div>{trip.dropoff.addressLine}</div>
              <a className="text-xs text-primary underline-offset-4 hover:underline" href={`https://www.google.com/maps/dir/?api=1&destination=${trip.dropoff.latitude},${trip.dropoff.longitude}`} target="_blank" rel="noreferrer">
                {t('openMap')}
              </a>
            </div>
          </div>
          <div className="text-xs text-muted-foreground" dir="ltr">
            {t('scheduled')}: {new Date(trip.scheduledStartAt).toLocaleString()}
          </div>
        </CardContent>
      </Card>

      {/* the location agent */}
      {!terminal && (
        <Card className={track.active ? 'border-primary' : ''}>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {track.active ? <Radio className="size-4 animate-pulse text-primary" /> : <LocateOff className="size-4 text-muted-foreground" />}
                <span className="font-medium">{track.active ? t('sharing') : t('notSharing')}</span>
              </div>
              {TRACKING_STATUSES.includes(trip.status) && (
                <Button size="sm" variant={track.active ? 'outline' : 'default'} onClick={() => { setManualOff(track.active); }}>
                  {track.active ? t('shareOff') : t('shareOn')}
                </Button>
              )}
            </div>
            {track.active && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <div>{t('sent', { sent: track.sent, queued: track.queued })}</div>
                {track.last && lastAgo !== null && (
                  <div className="flex items-center gap-1" dir="ltr">
                    <LocateFixed className="size-3" />
                    {t('lastFix', { ago: lastAgo, acc: track.last.accuracyM ?? '?' })} · {track.last.latitude.toFixed(5)}, {track.last.longitude.toFixed(5)}
                  </div>
                )}
                {track.wakeLock && <div>{t('wakeLock')}</div>}
                <div>{t('keepOpen')}</div>
              </div>
            )}
            {track.error === 'PERMISSION_DENIED' && <p className="text-xs text-destructive">{t('permissionDenied')}</p>}
            {track.error === 'GEOLOCATION_UNSUPPORTED' && <p className="text-xs text-destructive">{t('gpsUnavailable')}</p>}
            {track.error && track.error !== 'PERMISSION_DENIED' && track.error !== 'GEOLOCATION_UNSUPPORTED' && <p className="text-xs text-destructive">{track.error}</p>}
          </CardContent>
        </Card>
      )}

      {/* status buttons — exactly what the API allows */}
      {terminal ? (
        <p className="text-sm text-muted-foreground">{trip.status === 'COMPLETED' ? t('done') : t('cancelled')}</p>
      ) : pending ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="font-medium">{t(`action.${pending}` as 'action.COMPLETED')}</div>
            {needsOdometer && (
              <div className="space-y-1">
                <Label htmlFor="odo">{t('odometerPrompt')}</Label>
                <Input id="odo" inputMode="numeric" dir="ltr" value={odometer} onChange={(e) => { setOdometer(e.target.value.replace(/[^\d]/g, '')); }} />
                <p className="text-xs text-muted-foreground">{t('odometerHint', { km: trip.startOdometerKm ?? '—' })}</p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="note">{t('noteLabel')}</Label>
              <Input id="note" value={note} onChange={(e) => { setNote(e.target.value); }} />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" size="lg" disabled={busy || (needsOdometer && !odometer)} onClick={() => void move(pending)}>
                {busy && <Loader2 className="animate-spin" />}
                {t('confirm')}
              </Button>
              <Button variant="outline" size="lg" disabled={busy} onClick={() => { setPending(null); }}>
                {tc('cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {nextStatuses.map((s) => (
            <Button key={s} size="lg" variant={s === 'EXCEPTION' ? 'outline' : 'default'} className="h-14 text-base" onClick={() => { setPending(s); }}>
              {t(`action.${s}` as 'action.COMPLETED')}
            </Button>
          ))}
        </div>
      )}
      <p className="text-center text-[10px] text-muted-foreground" dir="ltr">
        ping {PING_INTERVAL_MS / 1000}s
      </p>
    </div>
  );
}
