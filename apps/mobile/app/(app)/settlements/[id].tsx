import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, ErrorBanner, Loading, Muted, QueryState, Row, Screen, SectionTitle, StatusBadge, Title } from '@/components/ui';
import { useI18n } from '@/i18n';
import { apiErrorOf } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { useSettlement, useSettlementLines } from '@/lib/queries';
import { enumLabel, statusLabel, toneFor } from '@/lib/status';

/**
 * One settlement (`GET /settlements/{id}` + `…/lines`, api.md §8.21): period, gross / deductions /
 * adjustments / net payable, the payout account (IBAN last 4) and reference once paid, and every
 * line with its type and booking. The owner's view is read-only — the web exposes no dispute
 * route on a settlement; adjustments and approvals are finance-staff actions.
 */
export default function SettlementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const settlementId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const router = useRouter();
  const q = useSettlement(settlementId);
  const lines = useSettlementLines(settlementId);
  const s = q.data;

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {s ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title ltr>{s.settlementNumber}</Title>
                <Muted ltr>
                  {formatDate(s.periodStart, locale)} – {formatDate(s.periodEnd, locale)}
                </Muted>
              </View>
              <StatusBadge label={statusLabel({ t, has }, 'settlement', s.status)} tone={toneFor('settlement', s.status)} />
            </View>

            <SectionTitle>{t('settlements.totals')}</SectionTitle>
            <Card>
              <Row label={t('settlements.gross')} value={formatMoney(s.grossAmount, s.currency)} ltr />
              <Row label={t('settlements.deductions')} value={formatMoney(s.commissionAmount, s.currency)} ltr />
              <Row label={t('settlements.adjustments')} value={formatMoney(s.adjustmentsAmount, s.currency)} ltr />
              <Row
                label={t('settlements.net')}
                value={
                  <Text className="text-base font-bold text-card-foreground" style={{ writingDirection: 'ltr' }}>
                    {formatMoney(s.netPayableAmount, s.currency)}
                  </Text>
                }
              />
            </Card>

            {s.bankAccount || s.paymentReference || s.paidAt ? (
              <>
                <SectionTitle>{t('settlements.payout')}</SectionTitle>
                <Card>
                  {s.bankAccount ? <Row label={t('settlements.paidTo')} value={`${s.bankAccount.bankName} ····${s.bankAccount.ibanLast4}`} ltr /> : null}
                  {s.paymentReference ? <Row label={t('settlements.paymentReference')} value={s.paymentReference} ltr /> : null}
                  {s.paidAt ? <Row label={t('settlements.paidAt')} value={formatDateTime(s.paidAt, locale)} ltr /> : null}
                </Card>
              </>
            ) : null}
            {s.notes ? <Muted>{s.notes}</Muted> : null}

            <SectionTitle>{t('settlements.linesTitle')}</SectionTitle>
            {lines.isPending ? (
              <Loading />
            ) : lines.isError ? (
              <ErrorBanner message={errorMessage(apiErrorOf(lines.error))} />
            ) : lines.data.length === 0 ? (
              <Muted>{t('common.empty')}</Muted>
            ) : (
              lines.data.map((l) => (
                <Card key={l.id}>
                  <View className="flex-row items-center justify-between gap-2">
                    <StatusBadge label={enumLabel({ t, has }, 'settlementLine', l.lineType)} tone={l.lineType === 'BOOKING_EARNING' ? 'success' : l.lineType === 'PENALTY' || l.lineType === 'REFUND_CLAWBACK' ? 'danger' : 'neutral'} />
                    <Text className="text-base font-semibold text-card-foreground" style={{ writingDirection: 'ltr' }}>
                      {formatMoney(l.amount, l.currency)}
                    </Text>
                  </View>
                  {l.description ? <Muted>{l.description}</Muted> : null}
                  {l.holdReason && l.holdReason !== 'NONE' ? <Muted>{enumLabel({ t, has }, 'holdReason', l.holdReason)}</Muted> : null}
                  {l.bookingId ? (
                    <View className="mt-2">
                      <Button
                        title={l.bookingNumber ?? t('bookings.detailTitle')}
                        variant="ghost"
                        onPress={() => {
                          router.push(`/bookings/${l.bookingId ?? ''}`);
                        }}
                      />
                    </View>
                  ) : null}
                </Card>
              ))
            )}
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
