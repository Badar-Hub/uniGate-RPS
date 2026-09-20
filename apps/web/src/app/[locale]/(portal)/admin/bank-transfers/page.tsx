import { setRequestLocale } from 'next-intl/server';
import { AdminBankTransfersPage } from '@/components/portal/admin/bank-transfers';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminBankTransfersPage />;
}
