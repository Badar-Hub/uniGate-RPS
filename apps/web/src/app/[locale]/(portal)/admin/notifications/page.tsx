import { setRequestLocale } from 'next-intl/server';
import { AdminNotificationsPage } from '@/components/portal/notifications/admin-notifications';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminNotificationsPage />;
}
