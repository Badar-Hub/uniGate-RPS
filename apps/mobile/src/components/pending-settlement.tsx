import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SettlementPreviewDto } from '@unigate/types';
import { Card, Muted, Row } from '@/components/ui';
import { useI18n } from '@/i18n';
import { fetchOrThrow } from '@/lib/api';
import { formatMoney } from '@/lib/format';

/** The last-30-days preview card: eligible / held bookings and the net payable (owner scope needs no ownerProfileId). */
export function PendingSettlementCard() {
  const { t } = useI18n();
  // The window is fixed when the card mounts (a re-render must not move the query key).
  const [range] = useState(() => {
    const start = new Date(Date.now() - 30 * 86_400_000);
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setMinutes(0, 0, 0);
    return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
  });
  const q = useQuery({
    queryKey: ['settlements', 'preview', range.periodStart, range.periodEnd] as const,
    queryFn: () => fetchOrThrow<SettlementPreviewDto>('/settlements/preview', { query: range }),
  });
  const p = q.data;
  if (!p) return null;
  return (
    <Card>
      <Muted>{t('settlements.pending')}</Muted>
      <Row label={t('settlements.gross')} value={formatMoney(p.grossAmount, p.currency)} ltr />
      <Row label={t('settlements.deductions')} value={formatMoney(p.commissionAmount, p.currency)} ltr />
      <Row label={t('settlements.adjustments')} value={formatMoney(p.adjustmentsAmount, p.currency)} ltr />
      <Row label={t('settlements.net')} value={formatMoney(p.netPayableAmount, p.currency)} ltr />
      <Row label={t('settlements.heldCount')} value={String(p.held.length)} ltr />
      {p.belowMinimum ? <Muted>{t('settlements.belowMinimum', { min: formatMoney(p.minimumPayoutAmount, p.currency) })}</Muted> : null}
      {p.eligible.length === 0 && p.held.length === 0 ? <Muted>{t('settlements.nothingPending')}</Muted> : null}
    </Card>
  );
}
