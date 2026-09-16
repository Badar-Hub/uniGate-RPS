import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { palette } from '@/theme/tokens';

/** Resolved hex palette for native props (placeholderTextColor, tab bar) that cannot take classNames. */
export function usePalette() {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark' ? palette.dark : palette.light;
}

export function Screen({ children, padded = true }: { children: ReactNode; padded?: boolean }) {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-background">
      <View className={padded ? 'flex-1 px-4' : 'flex-1'}>{children}</View>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-2xl font-bold text-foreground text-start">{children}</Text>;
}

export function Subtitle({ children }: { children: ReactNode }) {
  return <Text className="text-base text-muted-foreground text-start">{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text className="mb-1 text-sm font-medium text-foreground text-start">{children}</Text>;
}

export function Field({ error, ...props }: TextInputProps & { error?: string | undefined }) {
  const colors = usePalette();
  return (
    <View className="mb-3">
      <TextInput
        placeholderTextColor={colors.mutedForeground}
        className={`h-12 rounded-md border bg-background px-3 text-base text-foreground text-start ${error ? 'border-destructive' : 'border-input'}`}
        {...props}
      />
      {error ? <Text className="mt-1 text-xs text-destructive text-start">{error}</Text> : null}
    </View>
  );
}

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  ...props
}: Omit<PressableProps, 'children'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  loading?: boolean;
}) {
  const colors = usePalette();
  const bg = {
    primary: 'bg-primary',
    secondary: 'bg-secondary',
    ghost: 'bg-transparent',
    destructive: 'bg-destructive',
  }[variant];
  const fg = {
    primary: 'text-primary-foreground',
    secondary: 'text-secondary-foreground',
    ghost: 'text-primary',
    destructive: 'text-destructive-foreground',
  }[variant];
  const isDisabled = Boolean(disabled) || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      className={`h-12 flex-row items-center justify-center rounded-md px-4 ${bg} ${isDisabled ? 'opacity-60' : 'active:opacity-80'}`}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'ghost' ? colors.primary : colors.background} />
      ) : (
        <Text className={`text-base font-semibold ${fg}`}>{title}</Text>
      )}
    </Pressable>
  );
}

export function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3"
    >
      <Text className="text-sm text-destructive text-start">{message}</Text>
    </View>
  );
}

export function Loading() {
  const colors = usePalette();
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View className="flex-1 items-center justify-center p-8">
      <Text className="text-center text-muted-foreground">{text}</Text>
    </View>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <View className="rounded-full bg-secondary px-2 py-0.5">
      <Text className="text-xs font-medium text-secondary-foreground">{children}</Text>
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View className="mb-3 rounded-lg border border-border bg-card p-4">{children}</View>;
}
