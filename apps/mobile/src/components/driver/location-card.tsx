import { Linking, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAgeSeconds } from '@/components/trip-map';
import { Button, usePalette } from '@/components/ui';
import { useTracker } from '@/hooks/use-tracker';
import { useI18n } from '@/i18n';
import { PING_INTERVAL_MS } from '@/lib/driver/tracker-core';

/**
 * The location agent's card on the trip screen (the PWA's "sharing" block): on / off with the
 * driver's manual override, the mode (background service, foreground only, Expo Go), sent and
 * queued counts, the last fix with its age and accuracy, the API's plausibility refusals and the
 * device-side problems (permission, location services) with the way to fix them.
 */
export function LocationCard({ tracked, manualOff, onToggle }: { tracked: boolean; manualOff: boolean; onToggle: () => void }) {
  const { t, errorMessage } = useI18n();
  const colors = usePalette();
  const s = useTracker();
  const ago = useAgeSeconds(s.last?.recordedAt);

  const modeKey = s.mode === 'background' ? 'driver.location.modeBackground' : s.mode === 'foreground' ? 'driver.location.modeForeground' : s.mode === 'expo-go' ? 'driver.location.modeExpoGo' : null;
  const deviceMessage = s.deviceError === 'PERMISSION_DENIED' ? t('driver.location.permissionDenied') : s.deviceError === 'SERVICES_DISABLED' ? t('driver.location.servicesDisabled') : s.deviceError === 'START_FAILED' ? t('driver.location.startFailed') : null;

  return (
    <View className={`mb-3 rounded-lg border bg-card p-4 ${s.active ? 'border-primary' : 'border-border'}`}>
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1 flex-row items-center gap-2">
          <Ionicons name={s.active ? 'radio' : 'radio-outline'} size={20} color={s.active ? colors.primary : colors.mutedForeground} />
          <Text className="flex-1 text-base font-medium text-card-foreground text-start">{s.active ? t('driver.location.sharing') : t('driver.location.notSharing')}</Text>
        </View>
        {tracked ? (
          <View className="w-32">
            <Button title={manualOff ? t('driver.location.shareOn') : t('driver.location.shareOff')} variant={manualOff ? 'primary' : 'secondary'} onPress={onToggle} />
          </View>
        ) : null}
      </View>

      {s.active ? (
        <View className="mt-2 gap-1">
          {modeKey ? <Text className="text-xs text-muted-foreground text-start">{t(modeKey)}</Text> : null}
          <Text className="text-xs text-muted-foreground text-start">{t('driver.location.counts', { sent: s.sent, queued: s.queued })}</Text>
          {s.last && ago !== null ? (
            <Text className="text-xs text-muted-foreground" style={{ writingDirection: 'ltr', textAlign: 'left' }}>
              {t('driver.location.lastFix', { ago, acc: s.last.accuracyM ?? '?' })} · {s.last.latitude.toFixed(5)}, {s.last.longitude.toFixed(5)}
              {s.last.speedKmh !== undefined ? ` · ${s.last.speedKmh} km/h` : ''}
            </Text>
          ) : (
            <Text className="text-xs text-muted-foreground text-start">{t('driver.location.waitingFix')}</Text>
          )}
          {s.lastResult?.lowConfidence ? <Text className="text-xs text-amber-700 text-start">{t('driver.location.lowConfidence')}</Text> : null}
          {s.error && s.error !== s.lastRejection ? <Text className="text-xs text-destructive text-start">{errorMessage({ status: 0, code: s.error, message: s.error })}</Text> : null}
          {s.mode === 'foreground' || s.mode === 'expo-go' ? <Text className="text-xs text-muted-foreground text-start">{t('driver.location.keepOpen')}</Text> : null}
          <Text className="text-[10px] text-muted-foreground text-start" style={{ writingDirection: 'ltr' }}>
            ping {PING_INTERVAL_MS / 1000}s
          </Text>
        </View>
      ) : null}

      {s.rejected > 0 ? (
        <Text className="mt-2 text-xs text-amber-700 text-start">
          {t('driver.location.rejected', { count: s.rejected })}
          {s.lastRejection ? ` — ${errorMessage({ status: 422, code: s.lastRejection, message: s.lastRejection })}` : ''}
        </Text>
      ) : null}
      {!s.active && tracked && !manualOff && !deviceMessage && !s.lastRejection ? <Text className="mt-2 text-xs text-muted-foreground text-start">{t('driver.location.starting')}</Text> : null}
      {!s.active && s.queued > 0 ? <Text className="mt-2 text-xs text-muted-foreground text-start">{t('driver.location.queuedOnly', { queued: s.queued })}</Text> : null}

      {deviceMessage ? (
        <View className="mt-2">
          <Text className="text-xs text-destructive text-start">{deviceMessage}</Text>
          {s.deviceError === 'PERMISSION_DENIED' ? (
            <View className="mt-2">
              <Button title={t('driver.location.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
            </View>
          ) : null}
        </View>
      ) : null}
      {s.active && s.permission === 'foreground' && s.mode === 'foreground' ? (
        <View className="mt-2">
          <Text className="text-xs text-amber-700 text-start">{t('driver.location.backgroundDenied')}</Text>
          <View className="mt-2">
            <Button title={t('driver.location.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
