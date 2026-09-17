import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Label, usePalette } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate, isoDay } from '@/lib/format';

/**
 * Calendar-day picker (document expiry, licence expiry, expense date). The value is the wire
 * form `YYYY-MM-DD` (api.md §2.3 `isoDate`) or `''`. Android opens the native date dialog; iOS
 * shows the inline spinner in a sheet with a Done button. `clearable` adds a clear affordance
 * for optional dates.
 */
export function DateField({
  label,
  value,
  onChange,
  error,
  minimumDate,
  maximumDate,
  clearable = false,
  placeholder = '—',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  minimumDate?: Date | undefined;
  maximumDate?: Date | undefined;
  clearable?: boolean;
  placeholder?: string;
}) {
  const { locale, t } = useI18n();
  const colors = usePalette();
  const [iosOpen, setIosOpen] = useState(false);
  const current = value ? new Date(`${value}T12:00:00`) : null;
  const [draft, setDraft] = useState<Date>(current ?? new Date());

  const openAndroid = () => {
    DateTimePickerAndroid.open({
      value: current ?? new Date(),
      mode: 'date',
      ...(minimumDate ? { minimumDate } : {}),
      ...(maximumDate ? { maximumDate } : {}),
      onValueChange: (_e: DateTimePickerChangeEvent, day: Date) => {
        onChange(isoDay(day));
      },
    });
  };

  const open = () => {
    if (Platform.OS === 'android') openAndroid();
    else {
      setDraft(current ?? new Date());
      setIosOpen(true);
    }
  };

  return (
    <View className="mb-3">
      <Label>{label}</Label>
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={open}
          className={`h-12 flex-1 flex-row items-center justify-between rounded-md border bg-background px-3 ${error ? 'border-destructive' : 'border-input'}`}
        >
          <Text
            className={`flex-1 text-base text-start ${value ? 'text-foreground' : 'text-muted-foreground'}`}
            style={{ writingDirection: 'ltr' }}
          >
            {value ? formatDate(`${value}T12:00:00`, locale) : placeholder}
          </Text>
          <Ionicons name="calendar-outline" size={18} color={colors.mutedForeground} />
        </Pressable>
        {clearable && value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.clear')}
            onPress={() => {
              onChange('');
            }}
            className="h-12 w-10 items-center justify-center"
          >
            <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text className="mt-1 text-xs text-destructive text-start">{error}</Text> : null}

      {Platform.OS === 'ios' ? (
        <Modal
          visible={iosOpen}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setIosOpen(false);
          }}
        >
          <View className="flex-1 justify-end bg-black/40">
            <View className="rounded-t-2xl bg-background p-4 pb-8">
              <DateTimePicker
                value={draft}
                mode="date"
                display="spinner"
                locale={locale === 'ar' ? 'ar-SA' : 'en-GB'}
                {...(minimumDate ? { minimumDate } : {})}
                {...(maximumDate ? { maximumDate } : {})}
                onValueChange={(_e: DateTimePickerChangeEvent, d: Date) => {
                  setDraft(d);
                }}
              />
              <Button
                title={t('common.done')}
                onPress={() => {
                  onChange(isoDay(draft));
                  setIosOpen(false);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
