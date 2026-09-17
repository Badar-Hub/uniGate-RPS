import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { CustomerStatementDto } from '@unigate/types';
import { SelectField } from '@/components/select-field';
import { Button, Card, ErrorBanner, Loading, Muted, Row, Screen, SectionTitle } from '@/components/ui';
import { useI18n } from '@/i18n';
import { apiErrorOf, fetchOrThrow } from '@/lib/api';
import { formatDate, formatMoney, isoDay } from '@/lib/format';
import { keys } from '@/lib/queries';
import { useSession } from '@/lib/session';

/** The last twelve calendar months as statement periods (`periodStart` / `periodEnd`, api.md §8.4). */
function monthOptions(locale: 'ar' | 'en'): { value: string; label: string; start: string; end: string }[] {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const end = i === 0 ? now : last;
    const label = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { month: 'long', year: 'numeric' }).format(first);
    out.push({ value: isoDay(first), label, start: isoDay(first), end: isoDay(end) });
  }
  return out;
}

/** Accounts-receivable statement for a month (`GET /customers/{id}/statement?periodStart&periodEnd`, api.md §8.4). */
export default function StatementScreen() {
  const { t, locale, errorMessage } = useI18n();
  const { me } = useSession();
  const customerId = me?.profiles.customer?.id ?? '';
  const months = monthOptions(locale);
  const [month, setMonth] = useState(months[0]?.value ?? '');
  const period = months.find((m) => m.value === month) ?? months[0];

  const q = useQuery({
    queryKey: keys.statement(customerId, period?.start ?? '', period?.end ?? ''),
    queryFn: () =>
      fetchOrThrow<CustomerStatementDto>(`/customers/${customerId}/statement`, {
        query: { periodStart: period?.start, periodEnd: period?.end },
      }),
    enabled: customerId.length > 0 && Boolean(period),
  });
  const st = q.data;

  return (
    <Screen header>
      <ScrollView contentContainerClassName="py-4 pb-12">
        <SelectField label={t('statement.month')} value={month} options={months} onChange={setMonth} />
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <View>
            <ErrorBanner message={errorMessage(apiErrorOf(q.error))} />
            <Button title={t('common.retry')} variant="secondary" onPress={() => void q.refetch()} />
          </View>
        ) : st ? (
          <View>
            <Muted ltr>
              {formatDate(st.periodStart, locale)} – {formatDate(st.periodEnd, locale)}
            </Muted>
            <Card>
              <Row label={t('statement.openingBalance')} value={formatMoney(st.openingBalance, st.currency)} ltr />
              <Row label={t('statement.invoicedAmount')} value={formatMoney(st.invoicedAmount, st.currency)} ltr />
              <Row label={t('statement.paymentsAmount')} value={formatMoney(st.paymentsAmount, st.currency)} ltr />
              <Row label={t('statement.creditsAmount')} value={formatMoney(st.creditsAmount, st.currency)} ltr />
              <Row label={t('statement.closingBalance')} value={<Text className="text-base font-bold text-card-foreground" style={{ writingDirection: 'ltr' }}>{formatMoney(st.closingBalance, st.currency)}</Text>} />
            </Card>

            <SectionTitle>{t('statement.ageingTitle')}</SectionTitle>
            <Card>
              <Row label={t('statement.ageing.current')} value={formatMoney(st.ageing.current)} ltr />
              <Row label={t('statement.ageing.d1to30')} value={formatMoney(st.ageing.d1to30)} ltr />
              <Row label={t('statement.ageing.d31to60')} value={formatMoney(st.ageing.d31to60)} ltr />
              <Row label={t('statement.ageing.d61to90')} value={formatMoney(st.ageing.d61to90)} ltr />
              <Row label={t('statement.ageing.over90')} value={formatMoney(st.ageing.over90)} ltr />
            </Card>

            <SectionTitle>{t('statement.movements')}</SectionTitle>
            {st.movements.length === 0 ? (
              <Muted>{t('statement.noMovements')}</Muted>
            ) : (
              st.movements.map((m, i) => (
                <Card key={i}>
                  <Text className="text-sm text-card-foreground text-start">{m.description}</Text>
                  <Muted ltr>
                    {formatDate(m.occurredAt, locale)}
                    {m.reference ? ` · ${m.reference}` : ''}
                  </Muted>
                  <View className="mt-1 flex-row justify-between">
                    <Muted ltr>
                      {t('statement.debit')} {formatMoney(m.debit)}
                    </Muted>
                    <Muted ltr>
                      {t('statement.credit')} {formatMoney(m.credit)}
                    </Muted>
                  </View>
                </Card>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
