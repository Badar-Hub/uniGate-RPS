import * as SecureStore from 'expo-secure-store';
import { DevSettings, I18nManager, Platform } from 'react-native';
import type { Locale } from './locale';

export function isRtlLocale(locale: Locale): boolean {
  return locale === 'ar';
}

/**
 * Aligns the native layout direction with the locale. React Native decides direction once, at
 * startup, from `I18nManager`; changing it takes effect only after the JS bundle reloads —
 * `forceRTL` persists the choice natively, and the caller restarts. Returns whether a restart
 * is needed.
 *
 * Expo Go resets RTL preferences whenever it opens a project, so in Expo Go the switch may
 * not stick between launches; development builds and store builds behave correctly
 * (docs/mobile-app.md → RTL).
 */
export function applyLayoutDirection(locale: Locale): 'unchanged' | 'restart-required' {
  const rtl = isRtlLocale(locale);
  if (Platform.OS === 'web' || I18nManager.isRTL === rtl) return 'unchanged';
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return 'restart-required';
}

/**
 * Reloads the JS bundle so the new direction applies. In development `DevSettings.reload()`
 * works in Expo Go and dev clients; store builds get in-app reload via expo-updates in M1 —
 * until then the caller shows a "restart the app" notice and returns false.
 */
export function reloadApp(): boolean {
  if (__DEV__) {
    DevSettings.reload();
    return true;
  }
  return false;
}

const RELOAD_MARK_KEY = 'unigate.rtlReloadAt';
const RELOAD_LOOP_WINDOW_MS = 15_000;

/**
 * Loop breaker for the start-up direction fix: if the native direction refuses to stick (Expo Go
 * resets it per launch), a reload every start would spin forever. One automatic reload per
 * 15 s window; after that the app renders in whatever direction the shell allows.
 */
export async function shouldAutoReload(): Promise<boolean> {
  const last = Number((await SecureStore.getItemAsync(RELOAD_MARK_KEY).catch(() => null)) ?? 0);
  if (Number.isFinite(last) && Date.now() - last < RELOAD_LOOP_WINDOW_MS) return false;
  await SecureStore.setItemAsync(RELOAD_MARK_KEY, String(Date.now())).catch(() => undefined);
  return true;
}
