import { useState } from 'react';
import { useRouter } from 'expo-router';
import { BOOKING_STATUS, type BookingDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { useI18n } from '@/i18n';
import { formatMoney } from '@/lib/format';
import { keys } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

/** Both audiences: bookings scoped to the caller (`GET /bookings`, api.md §6.5 / §8.14), status filter, tap → detail. */
export default function BookingsScreen() {
  const { t, has } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState('');
  return (
    <ListScreen<BookingDto>
      title={t('lists.bookings')}
      queryKey={keys.bookings}
      path="/bookings"
      query={status ? { status } : {}}
      filters={[
        { value: '', label: t('common.all') },
        ...BOOKING_STATUS.map((s) => ({ value: s, label: statusLabel({ t, has }, 'booking', s) })),
      ]}
      filter={status}
      onFilter={setStatus}
      onPress={(b) => {
        router.push(`/bookings/${b.id}`);
      }}
      toRow={(b) => ({
        id: b.id,
        title: b.bookingNumber,
        subtitle: `${b.vehicleDescriptionSnapshot} · ${b.vehiclePlateSnapshot}`,
        status: statusLabel({ t, has }, 'booking', b.status),
        tone: toneFor('booking', b.status),
        date: b.scheduledStartAt,
        dateLabel: t('lists.scheduledAt'),
        trailing: formatMoney(b.totalAmount, b.currency),
      })}
    />
  );
}
