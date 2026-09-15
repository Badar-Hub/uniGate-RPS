import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { SessionProvider } from '@/lib/auth/session-provider';
import { DriverShell } from '@/components/driver/driver-shell';

/**
 * The driver app: an installable, mobile-first PWA served from the same Next.js app. Its own
 * manifest, theme colour and service worker; no portal chrome. Sessions come from the same
 * cookie-mode API client as the portal.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driver' });
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    manifest: '/driver.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: t('appName') },
    icons: { icon: '/icons/driver-192.png', apple: '/icons/driver-192.png' },
  };
}

export const viewport: Viewport = { themeColor: '#0f766e', width: 'device-width', initialScale: 1, maximumScale: 1, viewportFit: 'cover' };

export default function DriverLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <DriverShell>{children}</DriverShell>
    </SessionProvider>
  );
}
