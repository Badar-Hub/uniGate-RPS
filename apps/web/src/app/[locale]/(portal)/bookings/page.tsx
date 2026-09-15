import { setRequestLocale } from 'next-intl/server';
import { BookingsList } from '@/components/portal/bookings-list';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <BookingsList />;
}
