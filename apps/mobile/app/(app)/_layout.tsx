import { useEffect, useRef } from 'react';
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
  const { status, me, audience } = useSession();
  const { t } = useI18n();
  const colors = usePalette();
  const router = useRouter();
  // A tapped `tripId` opens the driver's trip screen for a driver, the tracking view otherwise;
  // read through a ref so the subscription is not re-created when the profile loads.
  const isDriver = useRef(audience.driver);
  useEffect(() => {
    isDriver.current = audience.driver;
  }, [audience.driver]);

  // Push: register the device with the API (api.md §8.26) and route tapped notifications.
  useEffect(() => {
    if (status !== 'signedIn') return;
    void syncPushRegistration();
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void watchNotificationTaps(
      (route) => {
        router.push(route.path);
      },
      () => ({ driver: isDriver.current }),
    ).then((off) => {
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
      {/* Vendor (M2) */}
      <Stack.Screen name="opportunities/[id]" options={{ title: t('opportunities.detailTitle') }} />
      <Stack.Screen name="bids/new" options={{ title: t('bidForm.screenTitle') }} />
      <Stack.Screen name="bids/index" options={{ title: t('myBids.title') }} />
      <Stack.Screen name="bids/[id]" options={{ title: t('myBids.detailTitle') }} />
      <Stack.Screen name="fleet/new" options={{ title: t('fleet.form.title') }} />
      <Stack.Screen name="fleet/[id]" options={{ title: t('fleet.detailTitle') }} />
      <Stack.Screen name="drivers/index" options={{ title: t('drivers.title') }} />
      <Stack.Screen name="drivers/new" options={{ title: t('drivers.form.title') }} />
      <Stack.Screen name="drivers/[id]" options={{ title: t('drivers.detailTitle') }} />
      <Stack.Screen name="account/owner-profile" options={{ title: t('owner.title') }} />
      <Stack.Screen name="account/documents" options={{ title: t('documents.title') }} />
      <Stack.Screen name="settlements/index" options={{ title: t('settlements.title') }} />
      <Stack.Screen name="settlements/[id]" options={{ title: t('settlements.detailTitle') }} />
      <Stack.Screen name="expenses/index" options={{ title: t('expenses.title') }} />
      <Stack.Screen name="expenses/new" options={{ title: t('expenses.record') }} />
      <Stack.Screen name="expenses/[id]" options={{ title: t('expenses.detailTitle') }} />
      <Stack.Screen name="maintenance/index" options={{ title: t('maintenance.title') }} />
      <Stack.Screen name="maintenance/new" options={{ title: t('maintenance.record') }} />
      <Stack.Screen name="maintenance/[id]" options={{ title: t('maintenance.detailTitle') }} />
      {/* Driver (M3) */}
      <Stack.Screen name="trips/[id]" options={{ title: t('driver.trip.title') }} />
      <Stack.Screen name="account/driver" options={{ title: t('driver.account.title') }} />
    </Stack>
  );
}
