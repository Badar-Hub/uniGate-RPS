import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { TripDto } from '@unigate/types';
import { TripCard } from '@/components/driver/trip-card';
import { Button, ErrorBanner, Loading, Muted, SectionTitle } from '@/components/ui';
import { useTracker } from '@/hooks/use-tracker';
import { useI18n } from '@/i18n';
import { apiErrorOf, fetchOrThrow } from '@/lib/api';
import { tracker } from '@/lib/driver/tracker';
import { nextTrips, UPCOMING_STATUSES } from '@/lib/driver/transitions';
import { keys, useActiveTrips } from '@/lib/queries';

/**
 * The driver's Home (the Active tab, and the top of Home for a driver with other profiles): the
 * active trip's card with the location agent's state when there is one — `GET /trips/active` —
 * else the next upcoming trips (`GET /trips?status=BOOKED,DRIVER_ASSIGNED`), soonest first.
 * Also the safety net for the agent: if it is still streaming for a trip that is no longer
 * active (ops cancelled it while the app was closed), it is stopped here.
 */
export function DriverHome({ compact = false }: { compact?: boolean }) {
  const { t, errorMessage } = useI18n();
  const router = useRouter();
  const s = useTracker();
  const active = useActiveTrips();
  const upcoming = useQuery({
    queryKey: [...keys.trips, 'upcoming', 'home'] as const,
    queryFn: () => fetchOrThrow<TripDto[]>('/trips', { query: { page: 1, pageSize: 10, status: UPCOMING_STATUSES.join(',') } }),
    enabled: active.isSuccess && active.data.length === 0,
  });

  useEffect(() => {
    if (!active.isSuccess || !s.active || !s.tripId) return;
    if (!active.data.some((x) => x.id === s.tripId)) void tracker().stop();
  }, [active.isSuccess, active.data, s.active, s.tripId]);

  if (active.isPending) return <Loading />;
  if (active.isError) {
    return (
      <View className="py-2">
        <ErrorBanner message={errorMessage(apiErrorOf(active.error))} />
        <Button title={t('common.retry')} variant="secondary" onPress={() => void active.refetch()} />
      </View>
    );
  }

  const current = active.data[0] ?? null;
  if (current) {
    return (
      <View>
        <SectionTitle>{t('driver.home.activeTrip')}</SectionTitle>
        <TripCard trip={current} highlight onPress={() => { router.push(`/trips/${current.id}`); }} />
        <Text className="text-sm text-muted-foreground text-start">
          {s.active && s.tripId === current.id
            ? t('driver.location.summary', { sent: s.sent, queued: s.queued })
            : t('driver.home.notSharing')}
        </Text>
        {active.data.length > 1 ? <Muted>{t('driver.home.moreActive', { count: active.data.length - 1 })}</Muted> : null}
      </View>
    );
  }

  const next = nextTrips(upcoming.data ?? [], compact ? 2 : 5);
  return (
    <View>
      <SectionTitle>{t('driver.home.nextTrips')}</SectionTitle>
      {upcoming.isPending ? (
        <Loading />
      ) : upcoming.isError ? (
        <ErrorBanner message={errorMessage(apiErrorOf(upcoming.error))} />
      ) : next.length ? (
        next.map((trip) => <TripCard key={trip.id} trip={trip} onPress={() => { router.push(`/trips/${trip.id}`); }} />)
      ) : (
        <Muted>{t('driver.home.empty')}</Muted>
      )}
      {s.queued > 0 && !s.active ? <Muted>{t('driver.location.queuedOnly', { queued: s.queued })}</Muted> : null}
    </View>
  );
}
