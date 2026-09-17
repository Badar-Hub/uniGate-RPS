import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Label, usePalette } from '@/components/ui';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string | undefined;
}

/**
 * A native-feeling select: a field that opens a full-screen modal list. Used for cities,
 * categories, purposes, reasons and saved locations — anything the web renders as `<select>`.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = '—',
  error,
  disabled,
  clearable = false,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string | undefined;
  disabled?: boolean | undefined;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const colors = usePalette();
  const current = options.find((o) => o.value === value);

  return (
    <View className="mb-3">
      <Label>{label}</Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? placeholder }}
        disabled={disabled}
        onPress={() => {
          setOpen(true);
        }}
        className={`h-12 flex-row items-center justify-between rounded-md border bg-background px-3 ${error ? 'border-destructive' : 'border-input'} ${disabled ? 'opacity-50' : ''}`}
      >
        <Text
          className={`flex-1 text-base text-start ${current ? 'text-foreground' : 'text-muted-foreground'}`}
          numberOfLines={1}
        >
          {current?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>
      {error ? <Text className="mt-1 text-xs text-destructive text-start">{error}</Text> : null}

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setOpen(false);
        }}
      >
        <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
            <Text className="text-lg font-semibold text-foreground text-start">{label}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setOpen(false);
              }}
              className="p-1"
            >
              <Ionicons name="close" size={24} color={colors.foreground} />
            </Pressable>
          </View>
          <FlatList
            data={clearable ? [{ value: '', label: placeholder }, ...options] : options}
            keyExtractor={(o) => o.value || '__none'}
            renderItem={({ item }) => {
              const active = item.value === value;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  className={`flex-row items-center justify-between border-b border-border px-4 py-3 ${active ? 'bg-muted' : ''}`}
                >
                  <View className="flex-1">
                    <Text className="text-base text-foreground text-start">{item.label}</Text>
                    {item.hint ? (
                      <Text className="mt-0.5 text-xs text-muted-foreground text-start">{item.hint}</Text>
                    ) : null}
                  </View>
                  {active ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
