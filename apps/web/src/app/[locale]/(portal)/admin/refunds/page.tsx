import { setRequestLocale } from 'next-intl/server';
import { AdminRefundsPage } from '@/components/portal/admin/refunds';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminRefundsPage />;
}
