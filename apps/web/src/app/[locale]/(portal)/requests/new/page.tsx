import { setRequestLocale } from 'next-intl/server';
import { RequestForm } from '@/components/portal/request-form';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RequestForm />;
}
