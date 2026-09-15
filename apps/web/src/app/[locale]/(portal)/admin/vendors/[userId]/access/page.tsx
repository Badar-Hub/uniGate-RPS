import { setRequestLocale } from 'next-intl/server';
import { VendorAccess } from '@/components/portal/vendor-access';

export default async function Page({ params }: { params: Promise<{ locale: string; userId: string }> }) {
  const { locale, userId } = await params;
  setRequestLocale(locale);
  return <VendorAccess userId={userId} />;
}
