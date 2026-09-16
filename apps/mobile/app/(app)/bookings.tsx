import type { BookingDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { useI18n } from '@/i18n';

/** Both audiences: bookings scoped to the caller (`GET /bookings`, api.md §6.5 / §8.14). */
export default function BookingsScreen() {
  const { t } = useI18n();
  return (
    <ListScreen<BookingDto>
      title={t('lists.bookings')}
      queryKey={['bookings', { page: 1 }]}
      path="/bookings"
      query={{ page: 1, pageSize: 20 }}
      toRow={(b) => ({
        id: b.id,
        title: b.bookingNumber,
        subtitle: `${b.vehicleDescriptionSnapshot} · ${b.vehiclePlateSnapshot}`,
        status: b.status,
        date: b.scheduledStartAt,
        dateLabel: t('lists.scheduledAt'),
      })}
    />
  );
}
