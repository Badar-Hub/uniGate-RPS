import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, LinkRow, Row, Screen, SectionTitle, Title } from '@/components/ui';
import { config } from '@/config';
import { useI18n, type Locale } from '@/i18n';
import { useSession } from '@/lib/session';

export default function AccountScreen() {
  const { t, locale, setLocale, isRTL } = useI18n();
  const { me, audience, signOut } = useSession();
  const router = useRouter();
  if (!me) return null;

  const name = locale === 'ar' && me.fullNameAr ? me.fullNameAr : me.fullNameEn;
  const corporate = me.profiles.customer?.customerType === 'CORPORATE';
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
            <Row label={t('account.phone')} value={me.phoneE164 ?? '—'} ltr />
            <Row label={t('account.email')} value={me.email ?? '—'} ltr />
            <Row label={t('account.roles')} value={me.roles.join(', ') || '—'} />
          </Card>

          {audience.customer ? (
            <>
              <SectionTitle>{t('account.customerSection')}</SectionTitle>
              <LinkRow
                title={t('savedLocations.title')}
                subtitle={t('savedLocations.subtitle')}
                icon="location-outline"
                rtl={isRTL}
                onPress={() => {
                  router.push('/account/saved-locations');
                }}
              />
              <LinkRow
                title={t('complaints.title')}
                subtitle={t('complaints.subtitle')}
                icon="chatbox-ellipses-outline"
                rtl={isRTL}
                onPress={() => {
                  router.push('/complaints');
                }}
              />
            </>
          ) : null}

          {corporate ? (
            <>
              <SectionTitle>{t('company.section')}</SectionTitle>
              <LinkRow
                title={t('company.title')}
                subtitle={t('company.subtitle')}
                icon="business-outline"
                rtl={isRTL}
                onPress={() => {
                  router.push('/account/company');
                }}
              />
              <LinkRow
                title={t('invoices.title')}
                subtitle={t('invoices.subtitle')}
                icon="document-text-outline"
                rtl={isRTL}
                onPress={() => {
                  router.push('/invoices');
                }}
              />
              <LinkRow
                title={t('statement.title')}
                subtitle={t('statement.subtitle')}
                icon="reader-outline"
                rtl={isRTL}
                onPress={() => {
                  router.push('/account/statement');
                }}
              />
            </>
          ) : null}

          <SectionTitle>{t('account.language')}</SectionTitle>
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
