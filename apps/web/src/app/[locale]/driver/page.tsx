import { setRequestLocale } from 'next-intl/server';
import { DriverTrips } from '@/components/driver/driver-trips';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DriverTrips />;
}
