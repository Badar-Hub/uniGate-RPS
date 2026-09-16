import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Screen, Title } from '@/components/ui';
import { config } from '@/config';
import { useI18n, type Locale } from '@/i18n';
import { useSession } from '@/lib/session';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className="text-sm text-muted-foreground text-start">{label}</Text>
      <Text className="ms-4 flex-1 text-end text-sm font-medium text-card-foreground">{value}</Text>
    </View>
  );
}

export default function AccountScreen() {
  const { t, locale, setLocale } = useI18n();
  const { me, signOut } = useSession();
  if (!me) return null;

  const name = locale === 'ar' && me.fullNameAr ? me.fullNameAr : me.fullNameEn;
  const choices: { value: Locale; label: string }[] = [
    { value: 'ar', label: t('common.arabic') },
    { value: 'en', label: t('common.english') },
  ];

  const confirmSignOut = () => {
    Alert.alert(t('common.signOut'), t('account.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <Screen>
      <ScrollView contentContainerClassName="py-4">
        <Title>{t('account.title')}</Title>

        <View className="mt-4">
          <Card>
            <Row label={t('account.name')} value={name} />
            <Row label={t('account.phone')} value={me.phoneE164 ?? '—'} />
            <Row label={t('account.email')} value={me.email ?? '—'} />
            <Row label={t('account.roles')} value={me.roles.join(', ') || '—'} />
          </Card>

          <Text className="mb-2 mt-2 text-sm font-medium text-foreground text-start">
            {t('account.language')}
          </Text>
          <View className="mb-4 flex-row gap-2">
            {choices.map((c) => {
              const active = c.value === locale;
              return (
                <Pressable
                  key={c.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => void setLocale(c.value)}
                  className={`h-11 flex-1 items-center justify-center rounded-md border ${active ? 'border-primary bg-primary' : 'border-border bg-card'}`}
                >
                  <Text
                    className={`text-base font-medium ${active ? 'text-primary-foreground' : 'text-card-foreground'}`}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Button title={t('common.signOut')} variant="destructive" onPress={confirmSignOut} />

          <View className="mt-8">
            <Text className="text-center text-xs text-muted-foreground">
              {t('account.version', { version: config.appVersion })}
            </Text>
            <Text className="text-center text-xs text-muted-foreground">
              {t('account.api')}: {config.apiUrl}
            </Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
