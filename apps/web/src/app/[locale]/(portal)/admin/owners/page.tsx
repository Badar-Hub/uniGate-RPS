import { setRequestLocale } from 'next-intl/server';
import { AdminOwners } from '@/components/portal/admin-owners';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminOwners />;
}
