import { setRequestLocale } from 'next-intl/server';
import { DriversPage } from '@/components/portal/drivers';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DriversPage />;
}
