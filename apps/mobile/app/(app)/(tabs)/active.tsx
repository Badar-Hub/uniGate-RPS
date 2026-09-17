import { RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { DriverHome } from '@/components/driver/driver-home';
import { Badge, LinkRow, Screen, Subtitle, Title, usePalette } from '@/components/ui';
import { useI18n } from '@/i18n';
import { keys, useInvalidate } from '@/lib/queries';
import { useSession } from '@/lib/session';

/** The driver's home: the active trip (with the agent's state) or the next trips, plus shortcuts. */
export default function ActiveTripScreen() {
  const { t, locale, isRTL } = useI18n();
  const { me } = useSession();
  const router = useRouter();
  const colors = usePalette();
  const invalidate = useInvalidate();
  if (!me) return null;
  const name = locale === 'ar' && me.fullNameAr ? me.fullNameAr : me.fullNameEn;

  return (
    <Screen>
      <ScrollView
        contentContainerClassName="py-4"
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void invalidate(keys.activeTrips, keys.trips)} tintColor={colors.primary} />}
      >
        <Title>{t('home.welcome', { name })}</Title>
        <View className="mt-2 flex-row flex-wrap gap-2">
          <Badge>{t('home.driver')}</Badge>
        </View>
        <View className="mt-2">
          <Subtitle>{t('driver.home.subtitle')}</Subtitle>
        </View>
        <DriverHome />
        <View className="mt-6">
          <LinkRow title={t('driver.trips.title')} subtitle={t('driver.trips.subtitle')} icon="navigate-outline" rtl={isRTL} onPress={() => { router.push('/(app)/(tabs)/trips'); }} />
          <LinkRow title={t('driver.account.title')} subtitle={t('driver.account.subtitle')} icon="car-outline" rtl={isRTL} onPress={() => { router.push('/account/driver'); }} />
        </View>
      </ScrollView>
    </Screen>
  );
}
