import { setRequestLocale } from 'next-intl/server';
import { RequestDetail } from '@/components/portal/request-detail';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { created } = await searchParams;
  return <RequestDetail id={id} created={created} />;
}
