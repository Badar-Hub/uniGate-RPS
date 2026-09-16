import type { TripRequestDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { useI18n } from '@/i18n';

/** Customer: own trip requests (`GET /trip-requests`, api.md §8.12). */
export default function RequestsScreen() {
  const { t, locale } = useI18n();
  return (
    <ListScreen<TripRequestDto>
      title={t('lists.requests')}
      queryKey={['trip-requests', { page: 1 }]}
      path="/trip-requests"
      query={{ page: 1, pageSize: 20 }}
      toRow={(r) => ({
        id: r.id,
        title: r.requestNumber,
        subtitle: `${locale === 'ar' ? (r.vehicleCategory?.nameAr ?? '') : (r.vehicleCategory?.nameEn ?? '')} · ${t('lists.vehicles', { count: r.vehiclesRequired })} · ${r.biddingOpen ? t('lists.biddingOpen') : t('lists.biddingClosed')}`,
        status: r.status,
        date: r.pickupAt,
        dateLabel: t('lists.pickupAt'),
      })}
    />
  );
}
