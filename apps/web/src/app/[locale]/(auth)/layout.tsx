import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/routing';
import { LanguageSwitch } from '@/components/language-switch';

/** Centred card layout for sign-in, registration and password reset. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const tc = await getTranslations('common');
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="container flex items-center justify-between py-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/brand/logo-mark.png" alt="" className="size-8" />
          {tc('appName')}
        </Link>
        <LanguageSwitch />
      </header>
      <main className="container flex flex-1 items-start justify-center py-8">
        <div className="w-full max-w-md">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/brand/logo-full.png" alt={tc('appName')} className="mx-auto mb-6 h-40 w-auto" />
          {children}
        </div>
      </main>
    </div>
  );
}
