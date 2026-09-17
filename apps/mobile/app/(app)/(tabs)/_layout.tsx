import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Loading, usePalette } from '@/components/ui';
import { useUnreadCount } from '@/hooks/use-unread-count';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { tabsFor, TAB_NAMES, type TabName } from '@/lib/tabs';

type IconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<TabName, { focused: IconName; idle: IconName }> = {
  index: { focused: 'home', idle: 'home-outline' },
  requests: { focused: 'clipboard', idle: 'clipboard-outline' },
  opportunities: { focused: 'megaphone', idle: 'megaphone-outline' },
  bookings: { focused: 'calendar', idle: 'calendar-outline' },
  fleet: { focused: 'bus', idle: 'bus-outline' },
  notifications: { focused: 'notifications', idle: 'notifications-outline' },
  account: { focused: 'person', idle: 'person-outline' },
};

const TITLE_KEYS: Record<TabName, string> = {
  index: 'tabs.home',
  requests: 'tabs.requests',
  opportunities: 'tabs.opportunities',
  bookings: 'tabs.bookings',
  fleet: 'tabs.fleet',
  notifications: 'tabs.notifications',
  account: 'tabs.account',
};

/**
 * Role-aware tab bar: the visible set comes from `tabsFor(audience)`; every other route stays
 * registered but hidden (`href: null`) so deep links and typed routes keep working. The
 * Notifications tab carries the unread badge (polled every 60 s while foregrounded).
 */
export default function TabsLayout() {
  const { status, me, audience } = useSession();
  const { t } = useI18n();
  const colors = usePalette();
  const unread = useUnreadCount(status === 'signedIn');

  if (!me) return <Loading />;

  const visible = new Set<TabName>(tabsFor(audience));

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {TAB_NAMES.map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(TITLE_KEYS[name]),
            ...(visible.has(name) ? {} : { href: null }),
            ...(name === 'notifications' && unread > 0
              ? { tabBarBadge: unread > 99 ? '99+' : unread, tabBarBadgeStyle: { backgroundColor: colors.destructive } }
              : {}),
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? ICONS[name].focused : ICONS[name].idle}
                color={color}
                size={size}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
