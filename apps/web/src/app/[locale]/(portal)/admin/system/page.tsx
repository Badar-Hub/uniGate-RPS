import { setRequestLocale } from 'next-intl/server';
import { AdminSystemPage } from '@/components/portal/admin/system';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminSystemPage />;
}
