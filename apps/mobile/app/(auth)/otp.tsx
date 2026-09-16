import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  fieldErrors,
  isThrottled,
  requestOtp,
  verifyOtpLogin,
  type ApiError,
} from '@unigate/api-client';
import { phoneE164 } from '@unigate/validation';
import { Button, ErrorBanner, Field, Label, Screen, Subtitle, Title } from '@/components/ui';
import { useCooldown } from '@/hooks/use-cooldown';
import { useI18n } from '@/i18n';
import { apiErrorOf, client } from '@/lib/api';
import { deviceInfo } from '@/lib/auth/device';
import { useSession } from '@/lib/session';
import { platformClientType } from '@/config';

const CODE = /^\d{4,8}$/;

/**
 * Phone OTP login (api.md §8.1): `POST /auth/otp/request { channel: 'SMS', destination, purpose: 'LOGIN' }`
 * then `POST /auth/otp/verify { …, code, clientType, deviceId, deviceName }`, which opens a session.
 */
export default function OtpScreen() {
  const { t, errorMessage } = useI18n();
  const { signIn } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ destination?: string }>();
  const cooldown = useCooldown();

  const [phone, setPhone] = useState(params.destination ?? '');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showError = (error: ApiError) => {
    setFields(fieldErrors(error));
    if (isThrottled(error)) {
      const wait = error.retryAfterSeconds ?? 60;
      cooldown.start(wait);
      setBanner(
        error.code === 'AUTH_OTP_MAX_ATTEMPTS'
          ? errorMessage(error)
          : t('errors.throttled', { seconds: wait }),
      );
      return;
    }
    setBanner(errorMessage(error));
  };

  const send = async () => {
    const destination = phone.trim();
    setBanner(null);
    if (!phoneE164.safeParse(destination).success) {
      setFields({ destination: t('auth.phoneInvalid') });
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const r = await requestOtp(client, { channel: 'SMS', destination, purpose: 'LOGIN' });
      if (!r.ok) {
        showError(r.error);
        return;
      }
      setSentTo(r.data.sentTo);
      cooldown.start(r.data.resendAfterSeconds);
      setStep('code');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const destination = phone.trim();
    setBanner(null);
    if (!CODE.test(code)) {
      setFields({ code: t('auth.codeInvalid') });
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const device = await deviceInfo();
      const r = await verifyOtpLogin(client, {
        channel: 'SMS',
        destination,
        purpose: 'LOGIN',
        code,
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
            <Title>{t('auth.otpTab')}</Title>
            <Subtitle>
              {step === 'code' && sentTo
                ? t('auth.codeSentTo', { destination: sentTo })
                : t('auth.signInSubtitle')}
            </Subtitle>
          </View>

          <ErrorBanner message={banner} />

          {step === 'phone' ? (
            <>
              <Label>{t('auth.phone')}</Label>
              <Field
                value={phone}
                onChangeText={setPhone}
                placeholder={t('auth.phonePlaceholder')}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                onSubmitEditing={() => void send()}
                returnKeyType="send"
                error={fields['destination']}
              />
              <Button
                title={
                  cooldown.active
                    ? t('auth.resendIn', { seconds: cooldown.seconds })
                    : t('auth.sendCode')
                }
                loading={busy}
                disabled={cooldown.active}
                onPress={() => void send()}
              />
            </>
          ) : (
            <>
              <Label>{t('auth.code')}</Label>
              <Field
                value={code}
                onChangeText={(v) => {
                  setCode(v.replace(/\D/g, '').slice(0, 8));
                }}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={8}
                onSubmitEditing={() => void verify()}
                returnKeyType="done"
                error={fields['code']}
              />
              <Button title={t('auth.verify')} loading={busy} onPress={() => void verify()} />
              <View className="mt-3 flex-row justify-between">
                <Button
                  title={t('auth.changeNumber')}
                  variant="ghost"
                  onPress={() => {
                    setStep('phone');
                  }}
                />
                <Button
                  title={
                    cooldown.active
                      ? t('auth.resendIn', { seconds: cooldown.seconds })
                      : t('auth.resendCode')
                  }
                  variant="ghost"
                  disabled={cooldown.active}
                  onPress={() => void send()}
                />
              </View>
            </>
          )}

          <View className="mt-6">
            <Button
              title={t('auth.passwordTab')}
              variant="ghost"
              onPress={() => {
                router.replace('/(auth)/login');
              }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
