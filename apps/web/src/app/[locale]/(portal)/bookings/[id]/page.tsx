import { setRequestLocale } from 'next-intl/server';
import { BookingDetail } from '@/components/portal/booking-detail';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ payment?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { payment } = await searchParams;
  return <BookingDetail id={id} returnedPaymentId={payment ?? null} />;
}
