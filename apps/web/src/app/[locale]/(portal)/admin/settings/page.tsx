import { setRequestLocale } from 'next-intl/server';
import { AdminSettingsPage } from '@/components/portal/admin/settings';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminSettingsPage />;
}
