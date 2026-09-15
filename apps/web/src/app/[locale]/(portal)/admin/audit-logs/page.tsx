import { setRequestLocale } from 'next-intl/server';
import { AdminAuditLogsPage } from '@/components/portal/admin/audit-logs';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminAuditLogsPage />;
}
