import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { TripDto } from '@unigate/types';
import { StatusBadge, usePalette } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { statusLabel, toneFor } from '@/lib/status';

/** One trip row for the driver's lists and Home: number · status, pickup, scheduled time · plate. */
export function TripCard({ trip, onPress, highlight = false }: { trip: TripDto; onPress: () => void; highlight?: boolean }) {
  const { t, has, locale, isRTL } = useI18n();
  const colors = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="active:opacity-80">
      <View className={`mb-3 rounded-lg border bg-card p-4 ${highlight ? 'border-primary' : 'border-border'}`}>
        <View className="flex-row items-center gap-3">
          <Ionicons name="navigate-outline" size={22} color={colors.primary} />
          <View className="flex-1">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-base font-semibold text-card-foreground" style={{ writingDirection: 'ltr', textAlign: isRTL ? 'right' : 'left' }}>
                {trip.tripNumber}
              </Text>
              <StatusBadge label={statusLabel({ t, has }, 'trip', trip.status)} tone={toneFor('trip', trip.status)} />
            </View>
            <Text className="mt-1 text-sm text-muted-foreground text-start" numberOfLines={1}>
              {trip.pickup.addressLine}
            </Text>
            <Text className="mt-0.5 text-xs text-muted-foreground text-start" style={{ writingDirection: 'ltr' }}>
              {formatDateTime(trip.scheduledStartAt, locale)} · {trip.vehicle.plateNumberEn}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />
        </View>
      </View>
    </Pressable>
  );
}
