import { setRequestLocale } from 'next-intl/server';
import { AdminVendors } from '@/components/portal/admin-vendors';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminVendors />;
}
