import { setRequestLocale } from 'next-intl/server';
import { SettlementsList } from '@/components/portal/finance/settlements';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SettlementsList />;
}
