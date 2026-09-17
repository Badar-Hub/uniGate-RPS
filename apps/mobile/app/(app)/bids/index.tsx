import { useState } from 'react';
import { useRouter } from 'expo-router';
import { BID_STATUS, type BidDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { useI18n } from '@/i18n';
import { formatMoney } from '@/lib/format';
import { keys } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

/** The owner's bids (`GET /bids?status`, api.md §8.13): number · request · vehicle · total · validity, tap → detail. */
export default function BidsScreen() {
  const { t, has } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState('');
  return (
    <ListScreen<BidDto>
      header
      title={t('myBids.title')}
      queryKey={keys.bids}
      path="/bids"
      query={status ? { status } : {}}
      filters={[{ value: '', label: t('common.all') }, ...BID_STATUS.map((s) => ({ value: s, label: statusLabel({ t, has }, 'bid', s) }))]}
      filter={status}
      onFilter={setStatus}
      onPress={(b) => {
        router.push(`/bids/${b.id}`);
      }}
      toRow={(b) => ({
        id: b.id,
        title: b.bidNumber,
        subtitle: `${b.requestNumber} · ${b.vehicle.plateNumberEn} · ${t('myBids.version', { n: b.version })}`,
        status: statusLabel({ t, has }, 'bid', b.status),
        tone: toneFor('bid', b.status),
        date: b.validUntil,
        dateLabel: t('bids.validUntil'),
        trailing: formatMoney(b.totalAmount, b.currency),
      })}
    />
  );
}
