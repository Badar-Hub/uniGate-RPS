import { setRequestLocale } from 'next-intl/server';
import { InboxPage } from '@/components/portal/notifications/inbox';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <InboxPage />;
}
