import { setRequestLocale } from 'next-intl/server';
import { AdminDashboardPage } from '@/components/portal/admin/dashboard';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminDashboardPage />;
}
