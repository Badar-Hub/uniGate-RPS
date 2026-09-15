import { setRequestLocale } from 'next-intl/server';
import { VehicleForm } from '@/components/portal/vehicle-form';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <VehicleForm />;
}
