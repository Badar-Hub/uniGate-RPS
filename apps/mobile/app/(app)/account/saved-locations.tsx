import { useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { SavedLocationDto } from '@unigate/types';
import { SelectField } from '@/components/select-field';
import { Button, Empty, ErrorBanner, Field, IconButton, Label, Loading, Muted, usePalette, Screen } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { keys, useCities, useInvalidate, useSavedLocations } from '@/lib/queries';

const FIELDS = ['label', 'addressLine', 'cityId', 'latitude', 'longitude'];

interface Draft {
  id: string | null;
  label: string;
  addressLine: string;
  cityId: string;
}

/**
 * The customer's address book (`GET/POST/PATCH/DELETE /me/saved-locations`, api.md §8.2). A
 * saved location carries coordinates; without a maps picker (M2) they are the city centre, the
 * same default the request form uses.
 */
export default function SavedLocationsScreen() {
  const { t, locale, errorMessage } = useI18n();
  const colors = usePalette();
  const invalidate = useInvalidate();
  const q = useSavedLocations();
  const cities = useCities();
  const action = useAction(FIELDS);
  const [draft, setDraft] = useState<Draft | null>(null);

  const cityName = (id: string) => {
    const c = cities.data?.find((x) => x.id === id);
    return c ? (locale === 'ar' ? c.nameAr : c.nameEn) : '';
  };

  const save = async () => {
    if (!draft) return;
    const city = cities.data?.find((x) => x.id === draft.cityId);
    const body = {
      label: draft.label.trim(),
      addressLine: draft.addressLine.trim(),
      cityId: draft.cityId,
      latitude: city?.latitude ?? 0,
      longitude: city?.longitude ?? 0,
    };
    const res = await action.run(() =>
      draft.id
        ? api<SavedLocationDto>(`/me/saved-locations/${draft.id}`, { method: 'PATCH', body })
        : api<SavedLocationDto>('/me/saved-locations', { method: 'POST', body }),
    );
    if (!res) return;
    setDraft(null);
    await invalidate(keys.savedLocations);
  };

  const remove = (s: SavedLocationDto) => {
    Alert.alert(t('savedLocations.delete'), t('savedLocations.deleteConfirm', { label: s.label }), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('savedLocations.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const res = await action.run(() => api(`/me/saved-locations/${s.id}`, { method: 'DELETE' }));
            if (res !== null) await invalidate(keys.savedLocations);
          })();
        },
      },
    ]);
  };

  return (
    <Screen header>
      <View className="flex-row items-center justify-between py-3">
        <Muted>{t('savedLocations.subtitle')}</Muted>
        <IconButton
          icon="add-circle"
          label={t('savedLocations.add')}
          onPress={() => {
            action.clear();
            setDraft({ id: null, label: '', addressLine: '', cityId: '' });
          }}
        />
      </View>
      {!draft ? <ErrorBanner message={action.banner} /> : null}
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <View>
          <ErrorBanner message={errorMessage(apiErrorOf(q.error))} />
          <Button title={t('common.retry')} variant="secondary" onPress={() => void q.refetch()} />
        </View>
      ) : (
        <FlatList
          data={q.data}
          keyExtractor={(s) => s.id}
          ListEmptyComponent={<Empty text={t('savedLocations.empty')} />}
          contentContainerClassName="pb-6"
          renderItem={({ item: s }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                action.clear();
                setDraft({ id: s.id, label: s.label, addressLine: s.addressLine, cityId: s.cityId });
              }}
              className="mb-3 flex-row items-center gap-3 rounded-lg border border-border bg-card p-4 active:opacity-80"
            >
              <Ionicons name="location" size={22} color={colors.primary} />
              <View className="flex-1">
                <Text className="text-base font-medium text-card-foreground text-start">{s.label}</Text>
                <Text className="text-sm text-muted-foreground text-start">
                  {s.addressLine}
                  {cityName(s.cityId) ? ` · ${cityName(s.cityId)}` : ''}
                </Text>
              </View>
              <IconButton icon="trash-outline" label={t('savedLocations.delete')} onPress={() => { remove(s); }} disabled={action.busy} />
            </Pressable>
          )}
        />
      )}

      <Modal visible={draft !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setDraft(null); }}>
        <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="p-4 pb-12">
            <Text className="mb-3 text-xl font-bold text-foreground text-start">
              {draft?.id ? t('savedLocations.edit') : t('savedLocations.add')}
            </Text>
            <ErrorBanner message={action.banner} />
            <Label>{t('savedLocations.label')}</Label>
            <Field value={draft?.label ?? ''} onChangeText={(v) => { setDraft((d) => (d ? { ...d, label: v } : d)); }} error={action.fields['label']} placeholder={t('savedLocations.labelHint')} />
            <Label>{t('savedLocations.address')}</Label>
            <Field value={draft?.addressLine ?? ''} onChangeText={(v) => { setDraft((d) => (d ? { ...d, addressLine: v } : d)); }} error={action.fields['addressLine']} />
            <SelectField
              label={t('savedLocations.city')}
              value={draft?.cityId ?? ''}
              options={(cities.data ?? []).map((c) => ({ value: c.id, label: locale === 'ar' ? c.nameAr : c.nameEn }))}
              onChange={(v) => { setDraft((d) => (d ? { ...d, cityId: v } : d)); }}
              placeholder={cities.isPending ? t('common.loading') : t('common.choose')}
              error={action.fields['cityId']}
            />
            <Muted>{t('savedLocations.coordinatesHint')}</Muted>
            <View className="mt-4 gap-3">
              <Button
                title={t('common.save')}
                loading={action.busy}
                disabled={!draft || draft.label.trim().length < 1 || draft.addressLine.trim().length < 3 || !draft.cityId}
                onPress={() => void save()}
              />
              <Button title={t('common.cancel')} variant="ghost" onPress={() => { setDraft(null); }} />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}
