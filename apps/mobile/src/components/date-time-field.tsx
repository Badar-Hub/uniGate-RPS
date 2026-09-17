import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Label, usePalette } from '@/components/ui';
import { clampToMinimum } from '@/lib/date-clamp';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';

/**
 * Date + time picker field. Android has no combined mode: the imperative dialog opens the date
 * picker, then the time picker. iOS shows the inline `datetime` spinner in a sheet with a Done
 * button. The value is a `Date`; the form serialises it with `toISOString()` like the web.
 */
export function DateTimeField({
  label,
  value,
  onChange,
  error,
  hint,
  minimumDate,
  doneLabel,
}: {
  label: string;
  value: Date | null;
  onChange: (value: Date) => void;
  error?: string | undefined;
  /** Shown under the field when there is no error (e.g. the minimum lead time). */
  hint?: string | undefined;
  minimumDate?: Date | undefined;
  doneLabel: string;
}) {
  const { locale } = useI18n();
  const colors = usePalette();
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(value ?? defaultStart());

  const openAndroid = () => {
    const start = clampToMinimum(value ?? defaultStart(), minimumDate);
    DateTimePickerAndroid.open({
      value: start,
      mode: 'date',
      ...(minimumDate ? { minimumDate } : {}),
      onValueChange: (_e: DateTimePickerChangeEvent, day: Date) => {
        DateTimePickerAndroid.open({
          value: start,
          mode: 'time',
          is24Hour: true,
          onValueChange: (_e2: DateTimePickerChangeEvent, time: Date) => {
            const next = new Date(day);
            next.setHours(time.getHours(), time.getMinutes(), 0, 0);
            onChange(clampToMinimum(next, minimumDate));
          },
        });
      },
    });
  };

  const open = () => {
    if (Platform.OS === 'android') openAndroid();
    else {
      setDraft(value ?? defaultStart());
      setIosOpen(true);
    }
  };

  return (
    <View className="mb-3">
      <Label>{label}</Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={open}
        className={`h-12 flex-row items-center justify-between rounded-md border bg-background px-3 ${error ? 'border-destructive' : 'border-input'}`}
      >
        <Text
          className={`flex-1 text-base text-start ${value ? 'text-foreground' : 'text-muted-foreground'}`}
          style={{ writingDirection: 'ltr' }}
        >
          {value ? formatDateTime(value.toISOString(), locale) : '—'}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={colors.mutedForeground} />
      </Pressable>
      {error ? (
        <Text className="mt-1 text-xs text-destructive text-start">{error}</Text>
      ) : hint ? (
        <Text className="mt-1 text-xs text-muted-foreground text-start">{hint}</Text>
      ) : null}

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
                mode="datetime"
                display="spinner"
                locale={locale === 'ar' ? 'ar-SA' : 'en-GB'}
                {...(minimumDate ? { minimumDate } : {})}
                onValueChange={(_e: DateTimePickerChangeEvent, d: Date) => {
                  setDraft(d);
                }}
              />
              <Button
                title={doneLabel}
                onPress={() => {
                  onChange(clampToMinimum(draft, minimumDate));
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

/** Next full hour at least one hour ahead — a sensible starting point for a pickup time. */
function defaultStart(): Date {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
