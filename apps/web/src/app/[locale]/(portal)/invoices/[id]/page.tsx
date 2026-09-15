import { setRequestLocale } from 'next-intl/server';
import { InvoiceDetail } from '@/components/portal/finance/invoices';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ payment?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { payment } = await searchParams;
  return <InvoiceDetail id={id} returnedPaymentId={payment ?? null} />;
}
