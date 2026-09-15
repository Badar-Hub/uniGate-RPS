import { setRequestLocale } from 'next-intl/server';
import { AdminRolesPage } from '@/components/portal/admin/roles';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminRolesPage />;
}
