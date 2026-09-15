import { setRequestLocale } from 'next-intl/server';
import { CommissionRulesPage } from '@/components/portal/finance/commission-rules';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CommissionRulesPage />;
}
