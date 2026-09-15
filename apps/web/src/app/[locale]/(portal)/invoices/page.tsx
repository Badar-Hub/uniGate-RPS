import { setRequestLocale } from 'next-intl/server';
import { InvoicesList } from '@/components/portal/finance/invoices';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <InvoicesList />;
}
