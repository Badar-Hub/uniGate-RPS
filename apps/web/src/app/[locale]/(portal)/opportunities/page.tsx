import { setRequestLocale } from 'next-intl/server';
import { Opportunities } from '@/components/portal/opportunities';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Opportunities />;
}
