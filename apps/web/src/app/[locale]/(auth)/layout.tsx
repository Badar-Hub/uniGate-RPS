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
        <Link href="/" className="text-lg font-semibold tracking-tight">
          {tc('appName')}
        </Link>
        <LanguageSwitch />
      </header>
      <main className="container flex flex-1 items-start justify-center py-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
