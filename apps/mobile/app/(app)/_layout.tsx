import { useEffect } from 'react';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Loading, usePalette } from '@/components/ui';
import { useI18n } from '@/i18n';
import { syncPushRegistration, watchNotificationTaps } from '@/lib/push';
import { useSession } from '@/lib/session';

/**
 * The signed-in shell: a stack whose first screen is the role-aware tab bar and whose other
 * screens are the details reached from a tab, a notification or a `unigate://` link. Detail
 * screens show the native header (back button, title); the tab screens draw their own titles.
 */
export default function AppLayout() {
  const { status, me } = useSession();
  const { t } = useI18n();
  const colors = usePalette();
  const router = useRouter();

  // Push: register the device with the API (api.md §8.26) and route tapped notifications.
  useEffect(() => {
    if (status !== 'signedIn') return;
    void syncPushRegistration();
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void watchNotificationTaps((route) => {
      router.push(route.path);
    }).then((off) => {
      if (cancelled) off();
      else unsubscribe = off;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [status, router]);

  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') return <Redirect href="/(auth)/login" />;
  if (!me) return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.foreground },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="requests/new" options={{ title: t('requests.form.title') }} />
      <Stack.Screen name="requests/[id]/index" options={{ title: t('requests.detailTitle') }} />
      <Stack.Screen name="requests/[id]/bids" options={{ title: t('bids.title') }} />
      <Stack.Screen name="bookings/[id]" options={{ title: t('bookings.detailTitle') }} />
      <Stack.Screen name="pay/[bookingId]" options={{ title: t('payments.payNow') }} />
      <Stack.Screen name="pay/invoice/[invoiceId]" options={{ title: t('payments.payNow') }} />
      <Stack.Screen name="pay/return" options={{ title: t('payments.returnTitle'), headerBackVisible: false }} />
      <Stack.Screen name="track/[tripId]" options={{ title: t('tracking.title') }} />
      <Stack.Screen name="complaints/index" options={{ title: t('complaints.title') }} />
      <Stack.Screen name="complaints/new" options={{ title: t('complaints.raise') }} />
      <Stack.Screen name="complaints/[id]" options={{ title: t('complaints.detailTitle') }} />
      <Stack.Screen name="account/saved-locations" options={{ title: t('savedLocations.title') }} />
      <Stack.Screen name="account/company" options={{ title: t('company.title') }} />
      <Stack.Screen name="account/statement" options={{ title: t('statement.title') }} />
      <Stack.Screen name="invoices/index" options={{ title: t('invoices.title') }} />
      <Stack.Screen name="invoices/[id]" options={{ title: t('invoices.detailTitle') }} />
    </Stack>
  );
}
