import { getRequestConfig } from 'next-intl/server';
import type { AbstractIntlMessages } from 'next-intl';
import { isAppLocale, routing } from './routing';

// `requestLocale` is the Next 15 mechanism; next-intl 4.14 deprecates it in favour of Next 16 root params.
// eslint-disable-next-line @typescript-eslint/no-deprecated
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isAppLocale(requested) ? requested : routing.defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)) as { default: AbstractIntlMessages };
  return { locale, messages: messages.default, timeZone: 'Asia/Riyadh' };
});
