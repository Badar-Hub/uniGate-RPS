'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, LogOut, WifiOff } from 'lucide-react';
import { useSession } from '@/lib/auth/session-provider';
import { Link, usePathname, useRouter } from '@/lib/i18n/routing';
import { LanguageSwitch } from '@/components/language-switch';
import { Button } from '@/components/ui/button';

/**
 * Mobile shell for the driver app: registers the service worker, shows the offline banner and the
 * install hint, guards for a signed-in driver profile. The offline page is exempt from the guard so
 * the service worker can serve it without a session.
 */
export function DriverShell({ children }: { children: ReactNode }) {
  const t = useTranslations('driver');
  const locale = useLocale();
  const tc = useTranslations('common');
  const { me, loading, signOut } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [standalone, setStandalone] = useState(true);
  const offlinePage = pathname.endsWith('/driver/offline');

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => { setOnline(true); };
    const down = () => { setOnline(false); };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    setStandalone(window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    // Scope limited to the driver pages: the portal never runs behind the worker.
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/driver-sw.js', { scope: `/${locale}/driver/` }).catch(() => undefined);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [locale]);
  useEffect(() => {
    if (!offlinePage && !loading && !me) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, me, router, pathname, offlinePage]);

  if (!offlinePage && (loading || !me)) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="ms-2 text-sm">{tc('loading')}</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-4 py-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <Link href="/driver" className="text-base font-semibold tracking-tight">
          {t('appName')}
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitch />
          {me && (
            <Button variant="ghost" size="sm" aria-label={tc('signOut')} onClick={() => { void signOut().then(() => { router.replace('/login'); }); }}>
              <LogOut className="size-4" />
            </Button>
          )}
        </div>
      </header>
      {!online && (
        <div className="flex items-start gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900">
          <WifiOff className="mt-0.5 size-4 shrink-0" />
          {t('offline')}
        </div>
      )}
      <main className="flex-1 px-4 py-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {me && !me.profiles.driver && !offlinePage ? <p className="text-sm text-destructive">{t('noDriverProfile')}</p> : children}
      </main>
      {!standalone && <p className="px-4 pb-4 text-center text-xs text-muted-foreground">{t('install')}</p>}
    </div>
  );
}
