import { setRequestLocale } from 'next-intl/server';
import { ComplaintsPage } from '@/components/portal/engagement/complaints';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ComplaintsPage />;
}
