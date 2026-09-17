import { useState } from 'react';
import { useRouter } from 'expo-router';
import { TRIP_REQUEST_STATUS, type TripRequestDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { IconButton } from '@/components/ui';
import { useI18n } from '@/i18n';
import { keys } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

/** Customer: own trip requests (`GET /trip-requests`, api.md §8.11) with a status filter; tap → detail, + → new. */
export default function RequestsScreen() {
  const { t, has, locale } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState('');

  return (
    <ListScreen<TripRequestDto>
      title={t('lists.requests')}
      queryKey={keys.requests}
      path="/trip-requests"
      query={status ? { status } : {}}
      filters={[
        { value: '', label: t('common.all') },
        ...TRIP_REQUEST_STATUS.map((s) => ({ value: s, label: statusLabel({ t, has }, 'request', s) })),
      ]}
      filter={status}
      onFilter={setStatus}
      action={
        <IconButton
          icon="add-circle"
          label={t('requests.newRequest')}
          onPress={() => {
            router.push('/requests/new');
          }}
        />
      }
      onPress={(r) => {
        router.push(`/requests/${r.id}`);
      }}
      toRow={(r) => ({
        id: r.id,
        title: r.requestNumber,
        subtitle: `${locale === 'ar' ? (r.vehicleCategory?.nameAr ?? '') : (r.vehicleCategory?.nameEn ?? '')} · ${t('lists.vehicles', { count: r.vehiclesRequired })} · ${r.biddingOpen ? t('lists.biddingOpen') : t('lists.biddingClosed')}`,
        status: statusLabel({ t, has }, 'request', r.status),
        tone: toneFor('request', r.status),
        date: r.pickupAt,
        dateLabel: t('lists.pickupAt'),
      })}
    />
  );
}
