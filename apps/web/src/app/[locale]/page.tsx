import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/lib/i18n/routing';
import { Button } from '@/components/ui/button';
import { PlatformStatus } from '@/components/platform-status';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const tc = await getTranslations('common');

  return (
    <main className="container flex min-h-dvh flex-col items-center justify-center gap-8 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          {tc('appName')}
        </span>
        <h1 className="text-4xl font-bold tracking-tight">{t('title')}</h1>
        <p className="max-w-prose text-muted-foreground">{t('subtitle')}</p>
      </div>

      <PlatformStatus
        labels={{
          status: t('status'),
          healthy: t('apiHealthy'),
          down: t('apiDown'),
          checking: t('checking'),
        }}
      />

      <nav aria-label={tc('language')} className="flex gap-2">
        <Button asChild variant={locale === 'ar' ? 'default' : 'outline'} size="sm">
          <Link href="/" locale="ar">
            {tc('arabic')}
          </Link>
        </Button>
        <Button asChild variant={locale === 'en' ? 'default' : 'outline'} size="sm">
          <Link href="/" locale="en">
            {tc('english')}
          </Link>
        </Button>
      </nav>
    </main>
  );
}
