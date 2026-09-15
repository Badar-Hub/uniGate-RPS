import { setRequestLocale } from 'next-intl/server';
import { SettlementDetail } from '@/components/portal/finance/settlements';

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <SettlementDetail id={id} />;
}
