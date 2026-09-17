import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { DownloadUrlDto, InvoiceLineDto } from '@unigate/types';
import { Button, Card, ErrorBanner, Loading, Muted, Notice, QueryState, Row, Screen, SectionTitle, StatusBadge, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf, fetchOrThrow } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { keys, useInvoice } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { enumLabel, PAYABLE_INVOICE_STATUSES, statusLabel, toneFor } from '@/lib/status';

/**
 * One invoice (api.md §8.19): header, lines (`GET /invoices/{id}/lines`), totals, the PDF
 * (`GET /invoices/{id}/pdf-url` → opened in the browser) and, for the buyer, paying the
 * outstanding balance.
 */
export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const { me } = useSession();
  const router = useRouter();
  const pdf = useAction();
  const q = useInvoice(invoiceId);
  const lines = useQuery({
    queryKey: keys.invoiceLines(invoiceId),
    queryFn: () => fetchOrThrow<InvoiceLineDto[]>(`/invoices/${invoiceId}/lines`, { query: { pageSize: 100 } }),
    enabled: invoiceId.length > 0,
  });
  const inv = q.data;
  const isBuyer = Boolean(inv && me?.profiles.customer?.id === inv.issuedToCustomerProfileId);
  const payable = Boolean(inv && PAYABLE_INVOICE_STATUSES.includes(inv.status) && Number(inv.outstandingAmount) > 0);
  const undeliverable = inv ? ['PENDING_CLEARANCE', 'CLEARANCE_FAILED', 'DRAFT'].includes(inv.status) : false;

  const openPdf = async () => {
    const res = await pdf.run(() => api<DownloadUrlDto>(`/invoices/${invoiceId}/pdf-url`));
    if (res?.url) await WebBrowser.openBrowserAsync(res.url);
  };

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {inv ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title ltr>{inv.invoiceNumber}</Title>
                <Muted>
                  {enumLabel({ t, has }, 'invoiceType', inv.invoiceType)}
                  {inv.correctsInvoiceNumber ? ` · ${t('invoices.corrects', { number: inv.correctsInvoiceNumber })}` : ''}
                </Muted>
              </View>
              <StatusBadge label={statusLabel({ t, has }, 'invoice', inv.status)} tone={toneFor('invoice', inv.status)} />
            </View>

            <View className="mt-4">
              {undeliverable ? <Notice tone="warning" message={inv.status === 'CLEARANCE_FAILED' ? t('invoices.clearanceFailed') : t('invoices.pendingClearance')} /> : null}
              <Card>
                <Row label={t('invoices.issued')} value={formatDate(inv.issueDate, locale)} ltr />
                <Row label={t('invoices.supply')} value={formatDate(inv.supplyDate, locale)} ltr />
                <Row label={t('invoices.due')} value={formatDate(inv.dueDate, locale)} ltr />
                {inv.billingPeriodStart ? <Row label={t('invoices.period')} value={`${formatDate(inv.billingPeriodStart, locale)} – ${formatDate(inv.billingPeriodEnd, locale)}`} ltr /> : null}
                <Row label={t('invoices.buyer')} value={inv.buyerName ?? '—'} />
                {inv.buyerVatNumber ? <Row label={t('invoices.buyerVat')} value={inv.buyerVatNumber} ltr /> : null}
                <Row label={t('invoices.sellerVat')} value={inv.sellerVatNumber} ltr />
              </Card>
            </View>

            <SectionTitle>{t('invoices.lines')}</SectionTitle>
            <Card>
              {lines.isPending ? (
                <Loading />
              ) : lines.isError ? (
                <ErrorBanner message={errorMessage(apiErrorOf(lines.error))} />
              ) : (
                (lines.data ?? []).map((l, i) => (
                  <View key={l.id} className={`py-2 ${i > 0 ? 'border-t border-border' : ''}`}>
                    <Text className="text-sm text-card-foreground text-start">{locale === 'ar' ? l.descriptionAr : l.descriptionEn}</Text>
                    <View className="mt-1 flex-row justify-between">
                      <Muted ltr>
                        {t('invoices.net')} {formatMoney(l.netAmount)} + {t('invoices.vatAmount')} {formatMoney(l.vatAmount)} ({(Number(l.vatRate) * 100).toFixed(0)}%)
                      </Muted>
                      <Text className="text-sm font-medium text-card-foreground" style={{ writingDirection: 'ltr' }}>{formatMoney(l.totalAmount)}</Text>
                    </View>
                  </View>
                ))
              )}
            </Card>

            <SectionTitle>{t('invoices.totals')}</SectionTitle>
            <Card>
              <Row label={t('invoices.subtotal')} value={formatMoney(inv.subtotalAmount, inv.currency)} ltr />
              <Row label={t('invoices.vatAmount')} value={formatMoney(inv.vatAmount, inv.currency)} ltr />
              <Row label={t('invoices.total')} value={<Text className="text-base font-bold text-card-foreground" style={{ writingDirection: 'ltr' }}>{formatMoney(inv.totalAmount, inv.currency)}</Text>} />
              <Row label={t('invoices.paid')} value={formatMoney(inv.paidAmount, inv.currency)} ltr />
              <Row label={t('invoices.outstanding')} value={<Text className="text-base font-bold text-card-foreground" style={{ writingDirection: 'ltr' }}>{formatMoney(inv.outstandingAmount, inv.currency)}</Text>} />
              {inv.einvoice.clearanceStatus !== 'NOT_REQUIRED' ? (
                <Muted ltr>
                  ICV {inv.einvoice.icv ?? 0} · {inv.einvoice.clearanceStatus}
                </Muted>
              ) : null}
            </Card>

            <ErrorBanner message={pdf.banner} />
            <View className="gap-3">
              {!undeliverable ? <Button title={t('invoices.openPdf')} variant="secondary" loading={pdf.busy} onPress={() => void openPdf()} /> : null}
              {isBuyer && payable ? (
                <Button
                  title={t('payments.pay', { amount: formatMoney(inv.outstandingAmount, inv.currency) })}
                  onPress={() => {
                    router.push(`/pay/invoice/${inv.id}`);
                  }}
                />
              ) : null}
            </View>
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
