import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Muted, QueryState, Row, Screen, SectionTitle } from '@/components/ui';
import { useI18n } from '@/i18n';
import { apiErrorOf } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useCustomerCredit } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { enumLabel } from '@/lib/status';

/** Corporate credit position (`GET /customers/{id}/credit`, api.md §8.4): limit, outstanding (ledger-derived), available, terms, billing cycle. */
export default function CompanyScreen() {
  const { t, has, locale, errorMessage } = useI18n();
  const { me } = useSession();
  const router = useRouter();
  const customerId = me?.profiles.customer?.id ?? null;
  const q = useCustomerCredit(customerId);
  const c = q.data;

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {c ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <Text className="text-xl font-bold text-foreground text-start">{c.companyNameEn}</Text>
            <Muted>{t('company.subtitle')}</Muted>

            <SectionTitle>{t('company.credit')}</SectionTitle>
            <Card>
              <Row label={t('company.creditStatus')} value={enumLabel({ t, has }, 'creditStatus', c.creditStatus)} />
              <Row label={t('company.limit')} value={formatMoney(c.creditLimitAmount, c.currency)} ltr />
              <Row label={t('company.outstanding')} value={formatMoney(c.outstandingAmount, c.currency)} ltr />
              <Row label={t('company.available')} value={<Text className="text-base font-bold text-card-foreground" style={{ writingDirection: 'ltr' }}>{formatMoney(c.availableAmount, c.currency)}</Text>} />
              {c.headroomAmount.startsWith('-') ? <Row label={t('company.headroom')} value={formatMoney(c.headroomAmount, c.currency)} ltr /> : null}
            </Card>

            <SectionTitle>{t('company.terms')}</SectionTitle>
            <Card>
              <Row label={t('company.billingMode')} value={enumLabel({ t, has }, 'billingMode', c.defaultBillingMode)} />
              <Row label={t('company.creditTerms')} value={t('bookings.detail.days', { count: c.creditTermsDays })} />
              <Row label={t('company.billingCycle')} value={enumLabel({ t, has }, 'billingCycle', c.billingCycle)} />
              <Row label={t('company.verified')} value={c.isVerified ? t('common.yes') : t('common.no')} />
              {c.creditApprovedAt ? <Row label={t('company.approvedAt')} value={formatDateTime(c.creditApprovedAt, locale)} ltr /> : null}
              <Row label={t('company.computedAt')} value={formatDateTime(c.computedAt, locale)} ltr />
            </Card>

            <View className="mt-2 gap-3">
              <Button title={t('invoices.title')} variant="secondary" onPress={() => { router.push('/invoices'); }} />
              <Button title={t('statement.title')} variant="secondary" onPress={() => { router.push('/account/statement'); }} />
            </View>
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
