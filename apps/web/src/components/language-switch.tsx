'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link, usePathname } from '@/lib/i18n/routing';

/** Switches locale while staying on the same route. */
export function LanguageSwitch() {
  const locale = useLocale();
  const pathname = usePathname();
  const tc = useTranslations('common');
  const other = locale === 'ar' ? 'en' : 'ar';
  return (
    <Button asChild variant="ghost" size="sm" aria-label={tc('language')}>
      <Link href={pathname} locale={other}>
        {other === 'ar' ? tc('arabic') : tc('english')}
      </Link>
    </Button>
  );
}
