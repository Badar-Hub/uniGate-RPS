import { setRequestLocale } from 'next-intl/server';
import { LiveTracking } from '@/components/portal/live-tracking';

export default async function Page({ params }: { params: Promise<{ locale: string; tripId: string }> }) {
  const { locale, tripId } = await params;
  setRequestLocale(locale);
  return <LiveTracking tripId={tripId} />;
}
