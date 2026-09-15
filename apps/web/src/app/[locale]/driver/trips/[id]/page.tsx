import { setRequestLocale } from 'next-intl/server';
import { DriverTrip } from '@/components/driver/driver-trip';

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <DriverTrip id={id} />;
}
