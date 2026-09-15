import { setRequestLocale } from 'next-intl/server';
import { BookingDetail } from '@/components/portal/booking-detail';

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <BookingDetail id={id} />;
}
