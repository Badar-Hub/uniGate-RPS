import { useState } from 'react';
import { useRouter } from 'expo-router';
import type { TripDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { useI18n } from '@/i18n';
import { TERMINAL_STATUSES, UPCOMING_STATUSES } from '@/lib/driver/transitions';
import { keys } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

type Section = 'upcoming' | 'active' | 'done';

/**
 * My trips (driver scope: `GET /trips` returns only the signed-in driver's trips, api.md §8.15)
 * in three sections — upcoming (`status=BOOKED,DRIVER_ASSIGNED`), active (`GET /trips/active`)
 * and done (`status=COMPLETED,CANCELLED`) — with pull-to-refresh and load-more; tap → the trip.
 */
export default function TripsScreen() {
  const { t, has } = useI18n();
  const router = useRouter();
  const [section, setSection] = useState<Section>('active');
  const path = section === 'active' ? '/trips/active' : '/trips';
  const query = section === 'upcoming' ? { status: UPCOMING_STATUSES.join(',') } : section === 'done' ? { status: TERMINAL_STATUSES.join(',') } : {};

  return (
    <ListScreen<TripDto>
      title={t('driver.trips.title')}
      queryKey={section === 'active' ? keys.activeTrips : keys.trips}
      path={path}
      query={query}
      filters={[
        { value: 'active', label: t('driver.trips.active') },
        { value: 'upcoming', label: t('driver.trips.upcoming') },
        { value: 'done', label: t('driver.trips.done') },
      ]}
      filter={section}
      onFilter={(v) => {
        setSection(v as Section);
      }}
      onPress={(trip) => {
        router.push(`/trips/${trip.id}`);
      }}
      toRow={(trip) => ({
        id: trip.id,
        title: trip.tripNumber,
        subtitle: `${trip.pickup.addressLine} → ${trip.dropoff.addressLine}`,
        status: statusLabel({ t, has }, 'trip', trip.status),
        tone: toneFor('trip', trip.status),
        date: trip.scheduledStartAt,
        dateLabel: t('lists.scheduledAt'),
        trailing: trip.vehicle.plateNumberEn,
      })}
      pageSize={section === 'done' ? 20 : 50}
    />
  );
}
