import { setRequestLocale } from 'next-intl/server';
import { VehicleDetail } from '@/components/portal/vehicle-detail';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { created } = await searchParams;
  return <VehicleDetail id={id} created={created === '1'} />;
}
