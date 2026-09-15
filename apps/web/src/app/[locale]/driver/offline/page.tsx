import { getTranslations, setRequestLocale } from 'next-intl/server';

/** Served by the service worker when the network is gone. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'driver' });
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">{t('offlineTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('offline')}</p>
    </div>
  );
}
