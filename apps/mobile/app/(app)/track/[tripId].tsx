import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import type { TrackingHistoryPointDto, TrackingPositionDto, TripTrackingDto } from '@unigate/types';
import { TripMap, useAgeSeconds } from '@/components/trip-map';
import { Button, Card, Muted, QueryState, Row, Screen, StatusBadge, Title } from '@/components/ui';
import { useI18n } from '@/i18n';
import { apiErrorOf, fetchOrThrow } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { keys } from '@/lib/queries';
import { joinRoom, leaveRoom, realtime, type TripLocationEvent, type TripStatusEvent } from '@/lib/realtime';
import { statusLabel, toneFor } from '@/lib/status';

const POLL_MS = 15_000;
const TRAIL_MAX = 500;

/**
 * Live tracking (api.md §8.16 `GET /tracking/trips/{id}`, §9). The HTTP read is the source of
 * truth and is polled every 15 s as the fallback; the socket (`trip:{id}` room, Bearer token in
 * `auth`) only moves the dot and refreshes status. The recent trail comes from
 * `GET /tracking/trips/{id}/history` and is extended by each live event.
 */
export default function TrackScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = typeof tripId === 'string' ? tripId : '';
  const { t, has, locale, errorMessage } = useI18n();
  const qc = useQueryClient();
  // Socket updates layered over the HTTP read: the newest sample wins, the trail is history + live.
  const [livePosition, setLivePosition] = useState<TrackingPositionDto | null>(null);
  const [livePoints, setLivePoints] = useState<{ latitude: number; longitude: number }[]>([]);
  const [live, setLive] = useState(false);

  const q = useQuery({
    queryKey: keys.tracking(id),
    queryFn: () => fetchOrThrow<TripTrackingDto>(`/tracking/trips/${id}`),
    enabled: id.length > 0,
    refetchInterval: POLL_MS,
  });
  const history = useQuery({
    queryKey: keys.trackingHistory(id),
    queryFn: () => fetchOrThrow<TrackingHistoryPointDto[]>(`/tracking/trips/${id}/history`, { query: { limit: TRAIL_MAX } }),
    enabled: id.length > 0,
    staleTime: 60_000,
  });

  const position = useMemo(() => {
    const fetched = q.data?.position ?? null;
    if (!livePosition) return fetched;
    if (!fetched) return livePosition;
    return new Date(livePosition.recordedAt).getTime() >= new Date(fetched.recordedAt).getTime() ? livePosition : fetched;
  }, [q.data, livePosition]);
  const trail = useMemo(
    () => [...(history.data ?? []).map((p) => ({ latitude: p.latitude, longitude: p.longitude })), ...livePoints].slice(-TRAIL_MAX),
    [history.data, livePoints],
  );

  const reload = useCallback(() => qc.invalidateQueries({ queryKey: keys.tracking(id) }), [qc, id]);

  useEffect(() => {
    if (!id) return;
    const room = `trip:${id}`;
    const s = realtime();
    const onLoc = (e: TripLocationEvent) => {
      if (e.tripId !== id) return;
      setLivePosition({ latitude: e.latitude, longitude: e.longitude, headingDeg: e.headingDeg, speedKmh: e.speedKmh, accuracyM: e.accuracyM, recordedAt: e.recordedAt, ageSeconds: 0, stale: e.stale });
      setLivePoints((tr) => [...tr.slice(-(TRAIL_MAX - 1)), { latitude: e.latitude, longitude: e.longitude }]);
    };
    const onStatus = (e: TripStatusEvent) => {
      if (e.tripId === id) void reload();
    };
    const onConnect = () => {
      void joinRoom(room).then((ack) => {
        setLive(ack.ok);
      });
    };
    const onDisconnect = () => {
      setLive(false);
    };
    s.on('trip.location', onLoc);
    s.on('trip.status', onStatus);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    if (s.connected) onConnect();
    else s.connect();
    return () => {
      s.off('trip.location', onLoc);
      s.off('trip.status', onStatus);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      leaveRoom(room);
    };
  }, [id, reload]);

  const ago = useAgeSeconds(position?.recordedAt);
  const stale = ago !== null && ago > 120;
  const data = q.data;
  const etaLabel = data?.eta ? `${formatTime(data.eta.arrivalAt, locale)} · ${t('tracking.remaining', { km: data.eta.remainingDistanceKm })}` : null;

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {data ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title ltr>{data.bookingNumber}</Title>
                <Muted>{t('tracking.subtitle')}</Muted>
              </View>
              <View className="items-end gap-1">
                <StatusBadge label={statusLabel({ t, has }, 'trip', data.tripStatus)} tone={toneFor('trip', data.tripStatus)} />
                <StatusBadge label={live ? t('tracking.live') : t('tracking.reconnecting')} tone={live ? 'success' : 'neutral'} />
              </View>
            </View>

            <View className="mt-4">
              <TripMap position={position} pickup={data.pickup} destination={data.destination} trail={trail} etaLabel={etaLabel} />
            </View>

            <Card>
              {position ? (
                <>
                  <Muted ltr>
                    {t('tracking.lastSeen', { ago: ago ?? 0 })}
                    {position.speedKmh !== null ? ` · ${position.speedKmh} km/h` : ''}
                  </Muted>
                  {stale ? <Text className="mt-1 text-sm text-amber-700 text-start">{t('tracking.stale')}</Text> : null}
                </>
              ) : (
                <Muted>{t('tracking.noPosition')}</Muted>
              )}
              {data.eta ? <Row label={t('tracking.eta')} value={etaLabel ?? '—'} ltr /> : null}
            </Card>

            <Card>
              <Row label={t('tracking.vehicle')} value={`${data.vehicle.plateNumberEn} · ${data.vehicle.description}`} ltr />
              {data.driver ? <Row label={t('tracking.driver')} value={`${data.driver.fullNameEn} · ★ ${data.driver.ratingAvg}`} ltr /> : null}
              {data.driver?.phoneE164 ? (
                <View className="mt-2">
                  <Button
                    title={t('tracking.call')}
                    variant="secondary"
                    onPress={() => {
                      void Linking.openURL(`tel:${data.driver?.phoneE164 ?? ''}`);
                    }}
                  />
                </View>
              ) : null}
            </Card>
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
