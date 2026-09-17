import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import Ionicons from '@expo/vector-icons/Ionicons';
import { palette } from '@/theme/tokens';

export type IconName = keyof typeof Ionicons.glyphMap;

/** Resolved hex palette for native props (placeholderTextColor, tab bar) that cannot take classNames. */
export function usePalette() {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark' ? palette.dark : palette.light;
}

export function Screen({
  children,
  padded = true,
  header = false,
}: {
  children: ReactNode;
  padded?: boolean;
  /** True on stack screens that show a navigation header (the header already covers the top inset). */
  header?: boolean;
}) {
  return (
    <SafeAreaView
      edges={header ? ['left', 'right'] : ['top', 'left', 'right']}
      className="flex-1 bg-background"
    >
      <View className={padded ? 'flex-1 px-4' : 'flex-1'}>{children}</View>
    </SafeAreaView>
  );
}

/** A scrolling form / detail screen: keyboard-avoiding, taps dismiss the keyboard, room for the last button. */
export function FormScreen({ children, header = true }: { children: ReactNode; header?: boolean }) {
  return (
    <Screen header={header}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
        keyboardVerticalOffset={header ? 88 : 0}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="py-4 pb-12">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export function Title({ children, ltr = false }: { children: ReactNode; ltr?: boolean }) {
  return (
    <Text
      className="text-2xl font-bold text-foreground text-start"
      style={ltr ? { writingDirection: 'ltr' } : undefined}
    >
      {children}
    </Text>
  );
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

export function TextArea({ error, ...props }: TextInputProps & { error?: string | undefined }) {
  const colors = usePalette();
  return (
    <View className="mb-3">
      <TextInput
        multiline
        textAlignVertical="top"
        placeholderTextColor={colors.mutedForeground}
        className={`min-h-24 rounded-md border bg-background px-3 py-2 text-base text-foreground text-start ${error ? 'border-destructive' : 'border-input'}`}
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

/** A non-error notice (success / info / warning), the counterpart of ErrorBanner. */
export function Notice({
  message,
  tone = 'success',
}: {
  message: string | null | undefined;
  tone?: 'success' | 'info' | 'warning';
}) {
  if (!message) return null;
  const box = {
    success: 'border-primary/40 bg-primary/10',
    info: 'border-border bg-muted',
    warning: 'border-amber-500/50 bg-amber-500/10',
  }[tone];
  const text = { success: 'text-primary', info: 'text-foreground', warning: 'text-amber-700' }[tone];
  return (
    <View accessibilityRole="text" className={`mb-3 rounded-md border p-3 ${box}`}>
      <Text className={`text-sm text-start ${text}`}>{message}</Text>
    </View>
  );
}

export function Loading() {
  const colors = usePalette();
  return (
    <View className="flex-1 items-center justify-center py-12">
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

/** Status badge with a tone: neutral by default; success / warning / danger for the decisive states. */
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const box = {
    neutral: 'bg-secondary',
    success: 'bg-primary/15',
    warning: 'bg-amber-500/15',
    danger: 'bg-destructive/15',
    info: 'bg-sky-500/15',
  }[tone];
  const text = {
    neutral: 'text-secondary-foreground',
    success: 'text-primary',
    warning: 'text-amber-700',
    danger: 'text-destructive',
    info: 'text-sky-700',
  }[tone];
  return (
    <View className={`rounded-full px-2 py-0.5 ${box}`}>
      <Text className={`text-xs font-medium ${text}`}>{label}</Text>
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View className="mb-3 rounded-lg border border-border bg-card p-4">{children}</View>;
}

/** Label / value line inside a Card. Identifiers, amounts and timestamps are shown LTR. */
export function Row({ label, value, ltr = false }: { label: string; value: ReactNode; ltr?: boolean }) {
  return (
    <View className="flex-row items-start justify-between gap-3 py-1.5">
      <Text className="text-sm text-muted-foreground text-start">{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text
          className="flex-1 text-end text-sm font-medium text-card-foreground"
          style={ltr ? { writingDirection: 'ltr' } : undefined}
        >
          {value}
        </Text>
      ) : (
        <View className="flex-1 items-end">{value}</View>
      )}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text className="mb-2 mt-4 text-base font-semibold text-foreground text-start">{children}</Text>
  );
}

export function Muted({ children, ltr = false }: { children: ReactNode; ltr?: boolean }) {
  return (
    <Text
      className="text-sm text-muted-foreground text-start"
      style={ltr ? { writingDirection: 'ltr' } : undefined}
    >
      {children}
    </Text>
  );
}

/** Selectable pill — filters and small option sets. */
export function Chip({
  label,
  active = false,
  onPress,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress?: (() => void) | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      className={`me-2 mb-2 h-9 justify-center rounded-full border px-3 ${active ? 'border-primary bg-primary' : 'border-border bg-card'} ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={`text-sm font-medium ${active ? 'text-primary-foreground' : 'text-card-foreground'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Two-to-four way toggle (vertical, direction). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="mb-3 flex-row overflow-hidden rounded-md border border-border">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => {
              onChange(o.value);
            }}
            className={`h-11 flex-1 items-center justify-center ${active ? 'bg-primary' : 'bg-card'}`}
          >
            <Text className={`text-sm font-medium ${active ? 'text-primary-foreground' : 'text-card-foreground'}`}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A labelled checkbox row. */
export function CheckRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const colors = usePalette();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => {
        onChange(!value);
      }}
      className="mb-2 flex-row items-center gap-3 py-1"
    >
      <Ionicons
        name={value ? 'checkbox' : 'square-outline'}
        size={22}
        color={value ? colors.primary : colors.mutedForeground}
      />
      <Text className="flex-1 text-base text-foreground text-start">{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
}) {
  const colors = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`h-10 w-10 items-center justify-center rounded-full ${disabled ? 'opacity-40' : 'active:bg-muted'}`}
    >
      <Ionicons name={icon} size={22} color={colors.foreground} />
    </Pressable>
  );
}

/** Pressable card row with a trailing chevron (mirrored under RTL). */
export function LinkRow({
  title,
  subtitle,
  icon,
  onPress,
  rtl = false,
  trailing,
}: {
  title: string;
  subtitle?: string | undefined;
  icon?: IconName | undefined;
  onPress: () => void;
  rtl?: boolean;
  trailing?: ReactNode;
}) {
  const colors = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="active:opacity-80">
      <Card>
        <View className="flex-row items-center gap-3">
          {icon ? <Ionicons name={icon} size={22} color={colors.primary} /> : null}
          <View className="flex-1">
            <Text className="text-base font-medium text-card-foreground text-start">{title}</Text>
            {subtitle ? (
              <Text className="mt-0.5 text-sm text-muted-foreground text-start">{subtitle}</Text>
            ) : null}
          </View>
          {trailing}
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.mutedForeground}
            style={{ transform: [{ scaleX: rtl ? -1 : 1 }] }}
          />
        </View>
      </Card>
    </Pressable>
  );
}

/** 1–5 star picker. */
export function Stars({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} className="flex-row items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === n }}
          accessibilityLabel={String(n)}
          onPress={() => {
            onChange(n);
          }}
          className="p-1"
        >
          <Ionicons
            name={n <= value ? 'star' : 'star-outline'}
            size={28}
            color={n <= value ? '#f59e0b' : '#9ca3af'}
          />
        </Pressable>
      ))}
    </View>
  );
}

/** Determinate (0–1) or indeterminate progress line, used by the document upload sheet. */
export function ProgressBar({ fraction, label }: { fraction: number | null; label?: string | undefined }) {
  const pct = fraction === null ? null : Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <View className="mb-3" accessibilityRole="progressbar" accessibilityValue={pct === null ? {} : { min: 0, max: 100, now: Math.round(pct) }}>
      {label ? <Text className="mb-1 text-xs text-muted-foreground text-start">{label}</Text> : null}
      <View className="h-2 overflow-hidden rounded-full bg-muted">
        <View className={`h-2 rounded-full bg-primary ${pct === null ? 'w-1/3 opacity-60' : ''}`} style={pct === null ? undefined : { width: `${pct}%` }} />
      </View>
    </View>
  );
}

/** Small stat tile for the Home summaries (count + caption), tappable. */
export function StatTile({ value, label, onPress, tone = 'neutral' }: { value: string; label: string; onPress?: (() => void) | undefined; tone?: Tone }) {
  const text = { neutral: 'text-card-foreground', success: 'text-primary', warning: 'text-amber-700', danger: 'text-destructive', info: 'text-sky-700' }[tone];
  return (
    <Pressable accessibilityRole={onPress ? 'button' : 'text'} onPress={onPress} disabled={!onPress} className="min-w-[45%] flex-1 active:opacity-80">
      <View className="rounded-lg border border-border bg-card p-3">
        <Text className={`text-2xl font-bold ${text}`} style={{ writingDirection: 'ltr' }}>
          {value}
        </Text>
        <Text className="mt-1 text-xs text-muted-foreground text-start">{label}</Text>
      </View>
    </Pressable>
  );
}

/** Loading / error / content switch shared by the detail screens. */
export function QueryState({
  pending,
  error,
  retryLabel,
  onRetry,
  children,
}: {
  pending: boolean;
  error: string | null;
  retryLabel: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (pending) return <Loading />;
  if (error) {
    return (
      <View className="py-4">
        <ErrorBanner message={error} />
        <Button title={retryLabel} variant="secondary" onPress={onRetry} />
      </View>
    );
  }
  return <>{children}</>;
}
