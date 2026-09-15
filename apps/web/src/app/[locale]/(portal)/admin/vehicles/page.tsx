import { setRequestLocale } from 'next-intl/server';
import { AdminVehicles } from '@/components/portal/admin-vehicles';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminVehicles />;
}
