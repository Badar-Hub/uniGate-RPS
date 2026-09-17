import { useState } from 'react';
import { useRouter } from 'expo-router';
import { SETTLEMENT_STATUS, type SettlementDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { PendingSettlementCard } from '@/components/pending-settlement';
import { useI18n } from '@/i18n';
import { formatDate, formatMoney } from '@/lib/format';
import { keys } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

/**
 * The owner's settlements (`GET /settlements?status`, api.md §8.21) with the "pending settlement"
 * preview for the last 30 days (`GET /settlements/preview`, the dry run the web shows owners as
 * their pending earnings). Tap → detail with the lines.
 */
export default function SettlementsScreen() {
  const { t, has, locale } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState('');
  return (
    <ListScreen<SettlementDto>
      header
      title={t('settlements.title')}
      queryKey={keys.settlements}
      path="/settlements"
      query={status ? { status } : {}}
      filters={[{ value: '', label: t('common.all') }, ...SETTLEMENT_STATUS.map((s) => ({ value: s, label: statusLabel({ t, has }, 'settlement', s) }))]}
      filter={status}
      onFilter={setStatus}
      above={<PendingSettlementCard />}
      onPress={(s) => {
        router.push(`/settlements/${s.id}`);
      }}
      toRow={(s) => ({
        id: s.id,
        title: s.settlementNumber,
        subtitle: `${formatDate(s.periodStart, locale)} – ${formatDate(s.periodEnd, locale)} · ${t('settlements.lines', { count: s.lineCount })}`,
        status: statusLabel({ t, has }, 'settlement', s.status),
        tone: toneFor('settlement', s.status),
        date: s.paidAt ?? s.updatedAt,
        dateLabel: s.paidAt ? t('settlements.paidAt') : undefined,
        trailing: formatMoney(s.netPayableAmount, s.currency),
      })}
    />
  );
}
