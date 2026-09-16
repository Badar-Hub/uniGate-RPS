import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Badge, Card, Screen, Subtitle, Title, usePalette } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';

interface Shortcut {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
}

export default function HomeScreen() {
  const { t, locale } = useI18n();
  const { me, audience } = useSession();
  const router = useRouter();
  const colors = usePalette();
  if (!me) return null;

  const name = locale === 'ar' && me.fullNameAr ? me.fullNameAr : me.fullNameEn;
  const shortcuts: Shortcut[] = [
    ...(audience.customer
      ? [
          {
            key: 'home.quickRequests',
            icon: 'clipboard-outline' as const,
            href: '/(app)/requests' as Href,
          },
        ]
      : []),
    ...(audience.vendor
      ? [
          {
            key: 'home.quickOpportunities',
            icon: 'megaphone-outline' as const,
            href: '/(app)/opportunities' as Href,
          },
        ]
      : []),
    ...(audience.customer || audience.vendor
      ? [
          {
            key: 'home.quickBookings',
            icon: 'calendar-outline' as const,
            href: '/(app)/bookings' as Href,
          },
        ]
      : []),
    ...(audience.vendor
      ? [{ key: 'home.quickFleet', icon: 'bus-outline' as const, href: '/(app)/fleet' as Href }]
      : []),
  ];

  return (
    <Screen>
      <ScrollView contentContainerClassName="py-4">
        <Title>{t('home.welcome', { name })}</Title>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {audience.customer ? <Badge>{t('home.customer')}</Badge> : null}
          {audience.vendor ? <Badge>{t('home.vendor')}</Badge> : null}
          {!audience.customer && !audience.vendor
            ? me.roles.map((r) => <Badge key={r}>{r}</Badge>)
            : null}
        </View>

        {!audience.customer && !audience.vendor ? (
          <View className="mt-6">
            <Subtitle>{t('home.noPortal')}</Subtitle>
          </View>
        ) : null}

        <View className="mt-6">
          {shortcuts.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => {
                router.push(s.href);
              }}
              className="active:opacity-80"
            >
              <Card>
                <View className="flex-row items-center gap-3">
                  <Ionicons name={s.icon} size={22} color={colors.primary} />
                  <Text className="flex-1 text-base font-medium text-card-foreground text-start">
                    {t(s.key)}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.mutedForeground}
                    style={{ transform: [{ scaleX: locale === 'ar' ? -1 : 1 }] }}
                  />
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
