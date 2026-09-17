import { ScrollView, View } from 'react-native';
import { Redirect, useRouter, type Href } from 'expo-router';
import { DriverHome } from '@/components/driver/driver-home';
import { Badge, LinkRow, Screen, SectionTitle, Subtitle, Title, type IconName } from '@/components/ui';
import { VendorHome } from '@/components/vendor-home';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';

interface Shortcut {
  key: string;
  icon: IconName;
  href: Href;
}

export default function HomeScreen() {
  const { t, locale, isRTL } = useI18n();
  const { me, audience } = useSession();
  const router = useRouter();
  if (!me) return null;
  // A driver-only account's home is the Active tab (Home is not in its tab set).
  if (audience.driver && !audience.customer && !audience.vendor) return <Redirect href="/(app)/(tabs)/active" />;

  const name = locale === 'ar' && me.fullNameAr ? me.fullNameAr : me.fullNameEn;
  const shortcuts: Shortcut[] = [
    ...(audience.customer
      ? [
          { key: 'home.quickNewRequest', icon: 'add-circle-outline' as const, href: '/requests/new' },
          { key: 'home.quickRequests', icon: 'clipboard-outline' as const, href: '/(app)/(tabs)/requests' },
        ]
      : []),
    ...(audience.vendor
      ? [{ key: 'home.quickOpportunities', icon: 'megaphone-outline' as const, href: '/(app)/(tabs)/opportunities' }]
      : []),
    ...(audience.customer || audience.vendor
      ? [{ key: 'home.quickBookings', icon: 'calendar-outline' as const, href: '/(app)/(tabs)/bookings' }]
      : []),
    ...(audience.vendor
      ? [
          { key: 'home.quickFleet', icon: 'bus-outline' as const, href: '/(app)/(tabs)/fleet' },
          { key: 'home.quickBids', icon: 'pricetags-outline' as const, href: '/bids' as const },
          { key: 'home.quickDrivers', icon: 'people-outline' as const, href: '/drivers' as const },
          { key: 'home.quickSettlements', icon: 'wallet-outline' as const, href: '/settlements' as const },
        ]
      : []),
    ...(audience.customer
      ? [{ key: 'home.quickComplaints', icon: 'chatbox-ellipses-outline' as const, href: '/complaints' }]
      : []),
    ...(audience.driver
      ? [
          { key: 'home.quickTrips', icon: 'navigate-outline' as const, href: '/(app)/(tabs)/trips' as const },
          { key: 'home.quickDriverAccount', icon: 'car-outline' as const, href: '/account/driver' as const },
        ]
      : []),
  ];

  return (
    <Screen>
      <ScrollView contentContainerClassName="py-4">
        <Title>{t('home.welcome', { name })}</Title>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {audience.customer ? <Badge>{t('home.customer')}</Badge> : null}
          {audience.vendor ? <Badge>{t('home.vendor')}</Badge> : null}
          {audience.driver ? <Badge>{t('home.driver')}</Badge> : null}
          {!audience.customer && !audience.vendor && !audience.driver
            ? me.roles.map((r) => <Badge key={r}>{r}</Badge>)
            : null}
        </View>

        {!audience.customer && !audience.vendor && !audience.driver ? (
          <View className="mt-6">
            <Subtitle>{t('home.noPortal')}</Subtitle>
          </View>
        ) : null}

        {audience.driver ? (
          <View className="mt-2">
            <DriverHome compact />
          </View>
        ) : null}
        {audience.vendor ? <VendorHome /> : null}

        <View className="mt-6">
          {audience.vendor || audience.driver ? <SectionTitle>{t('home.shortcuts')}</SectionTitle> : null}
          {shortcuts.map((s) => (
            <LinkRow
              key={s.key}
              title={t(s.key)}
              icon={s.icon}
              rtl={isRTL}
              onPress={() => {
                router.push(s.href);
              }}
            />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
