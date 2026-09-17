import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { fieldErrors, isThrottled, login, type ApiError } from '@unigate/api-client';
import { identifier as identifierSchema, phoneE164 } from '@unigate/validation';
import { Button, ErrorBanner, Field, Label, Screen, Subtitle, Title } from '@/components/ui';
import { useCooldown } from '@/hooks/use-cooldown';
import { useI18n } from '@/i18n';
import { apiErrorOf, client } from '@/lib/api';
import { deviceInfo } from '@/lib/auth/device';
import { useSession } from '@/lib/session';
import { platformClientType } from '@/config';

/** Codes after which the OTP path is the way forward (new device / step-up / unverified phone). */
const OTP_NEXT_CODES = [
  'AUTH_NEW_DEVICE',
  'AUTH_STEP_UP_REQUIRED',
  'AUTH_PHONE_NOT_VERIFIED',
  'AUTH_ACCOUNT_NOT_VERIFIED',
];

export default function LoginScreen() {
  const { t, errorMessage } = useI18n();
  const { signIn } = useSession();
  const router = useRouter();
  const cooldown = useCooldown();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [offerOtp, setOfferOtp] = useState(false);
  const [busy, setBusy] = useState(false);

  const showError = (error: ApiError) => {
    setFields(fieldErrors(error));
    if (isThrottled(error)) {
      const wait = error.retryAfterSeconds ?? 60;
      cooldown.start(wait);
      setBanner(t('errors.throttled', { seconds: wait }));
      return;
    }
    setBanner(errorMessage(error));
    setOfferOtp(
      OTP_NEXT_CODES.includes(error.code) && phoneE164.safeParse(identifier.trim()).success,
    );
  };

  const submit = async () => {
    const id = identifier.trim();
    const next: Record<string, string> = {};
    if (!identifierSchema.safeParse(id).success) next['identifier'] = t('auth.identifierInvalid');
    if (!password) next['password'] = t('auth.passwordRequired');
    setFields(next);
    setBanner(null);
    setOfferOtp(false);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const device = await deviceInfo();
      const r = await login(client, {
        identifier: id,
        password,
        clientType: platformClientType(),
        ...device,
      });
      if (!r.ok) {
        showError(r.error);
        return;
      }
      await signIn(r.data);
      router.replace('/(app)');
    } catch (e) {
      const err = apiErrorOf(e);
      if (err) showError(err);
      else setBanner(errorMessage(null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="flex-grow justify-center py-8"
        >
          <View className="mb-8">
            <Text className="mb-2 text-sm font-semibold uppercase tracking-wide text-primary text-start">
              {t('common.appName')}
            </Text>
            <Title>{t('auth.signIn')}</Title>
            <Subtitle>{t('auth.signInSubtitle')}</Subtitle>
          </View>

          <ErrorBanner message={banner} />

          <Label>{t('auth.identifier')}</Label>
          <Field
            value={identifier}
            onChangeText={setIdentifier}
            placeholder={t('auth.identifierPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="username"
            error={fields['identifier']}
          />

          <Label>{t('auth.password')}</Label>
          <Field
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textContentType="password"
            autoComplete="password"
            onSubmitEditing={() => void submit()}
            returnKeyType="go"
            error={fields['password']}
          />

          <Button
            title={
              cooldown.active ? t('auth.resendIn', { seconds: cooldown.seconds }) : t('auth.signIn')
            }
            loading={busy}
            disabled={cooldown.active}
            onPress={() => void submit()}
          />

          {offerOtp ? (
            <View className="mt-3">
              <Button
                title={t('auth.otpTab')}
                variant="secondary"
                onPress={() => {
                  router.push({
                    pathname: '/(auth)/otp',
                    params: { destination: identifier.trim() },
                  });
                }}
              />
            </View>
          ) : null}

          <View className="mt-6">
            <Button
              title={t('auth.otpTab')}
              variant="ghost"
              onPress={() => {
                router.push('/(auth)/otp');
              }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
