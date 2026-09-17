import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { OwnerDto } from '@unigate/types';
import { Sheet } from '@/components/sheet';
import { Button, Card, CheckRow, ErrorBanner, Field, Label, LinkRow, Muted, Notice, QueryState, Row, Screen, SectionTitle, Segmented, StatusBadge, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { keys, settingValue, stringList, useCities, useInvalidate, useOwner, usePublicSettings } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { OWNER_SUBMITTABLE_STATUSES, statusLabel, toneFor } from '@/lib/status';

const PATCH_FIELDS = ['ownerType', 'businessNameEn', 'businessNameAr', 'crNumber', 'vatNumber', 'isVatRegistered', 'transportTypes', 'privacySettings'];

/**
 * The owner's company / profile (api.md §8.5): onboarding status with submit-for-review
 * (`POST /owners/{id}/submit-for-review`, refused with `OWNER_DOCUMENTS_INCOMPLETE` + the missing
 * codes until the mandatory documents are uploaded), business details and VAT (`PATCH
 * /owners/{id}` — editing after APPROVED moves the profile to UNDER_REVIEW), vertical
 * applications, service areas (`PUT /owners/{id}/service-areas { cityIds }`) and the privacy
 * switches counterparties see through. Documents live on their own screen.
 */
export default function OwnerProfileScreen() {
  const { t, has, locale, isRTL, errorMessage } = useI18n();
  const { me } = useSession();
  const router = useRouter();
  const invalidate = useInvalidate();
  const ownerId = me?.profiles.owner?.id ?? null;
  const q = useOwner(ownerId);
  const cities = useCities();
  const action = useAction(PATCH_FIELDS);
  const [editing, setEditing] = useState<'details' | 'areas' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const o = q.data;
  const missing = (action.error?.details as { missing?: string[] } | undefined)?.missing;
  const refresh = () => invalidate(keys.owner(ownerId ?? ''));
  const cityName = (id: string) => {
    const c = cities.data?.find((x) => x.id === id);
    return c ? (locale === 'ar' ? c.nameAr : c.nameEn) : id;
  };

  const submitForReview = async () => {
    setNotice(null);
    const res = await action.run(() => api<OwnerDto>(`/owners/${ownerId ?? ''}/submit-for-review`, { method: 'POST', body: {} }));
    if (!res) return;
    await refresh();
    setNotice(t('owner.submitted'));
  };

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {o ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title>{(locale === 'ar' ? o.businessNameAr : o.businessNameEn) ?? o.businessNameEn ?? o.fullNameEn}</Title>
                <Muted>{t(`owner.type.${o.ownerType}`)}</Muted>
              </View>
              <StatusBadge label={statusLabel({ t, has }, 'onboarding', o.onboardingStatus)} tone={toneFor('onboarding', o.onboardingStatus)} />
            </View>

            <View className="mt-4">
              <Notice message={notice} />
              <ErrorBanner message={action.banner ? `${action.banner}${missing?.length ? ` — ${t('owner.missing', { codes: missing.join(', ') })}` : ''}` : null} />
              {o.rejectionReason && o.onboardingStatus !== 'APPROVED' ? <ErrorBanner message={o.rejectionReason} /> : null}
            </View>

            <Card>
              <Muted>{t(`owner.onboarding.${o.onboardingStatus}`)}</Muted>
              {OWNER_SUBMITTABLE_STATUSES.includes(o.onboardingStatus) ? (
                <View className="mt-3">
                  <Button title={t('owner.submit')} loading={action.busy} onPress={() => void submitForReview()} />
                </View>
              ) : null}
            </Card>

            <LinkRow
              title={t('documents.title')}
              subtitle={t('documents.subtitle')}
              icon="document-attach-outline"
              rtl={isRTL}
              onPress={() => {
                router.push('/account/documents');
              }}
            />

            <SectionTitle>{t('owner.details')}</SectionTitle>
            <Card>
              <Row label={t('owner.businessNameEn')} value={o.businessNameEn ?? '—'} />
              <Row label={t('owner.businessNameAr')} value={o.businessNameAr ?? '—'} />
              <Row label={t('owner.crNumber')} value={o.crNumber ?? '—'} ltr />
              <Row label={t('owner.vatNumber')} value={o.vatNumber ?? '—'} ltr />
              <Row label={t('owner.isVatRegistered')} value={o.isVatRegistered ? t('common.yes') : t('common.no')} />
              {o.nationalIdLast4 ? <Row label={t('drivers.form.nationalId')} value={`···· ${o.nationalIdLast4}`} ltr /> : null}
              <Row label={t('fleet.spec.rating')} value={o.ratingCount > 0 ? `${o.ratingAvg} (${o.ratingCount})` : '—'} ltr />
              {o.approvedAt ? <Row label={t('owner.approvedAt')} value={formatDateTime(o.approvedAt, locale)} ltr /> : null}
              <View className="mt-3">
                <Button
                  title={t('owner.edit')}
                  variant="secondary"
                  onPress={() => {
                    setEditing('details');
                  }}
                />
              </View>
            </Card>

            <SectionTitle>{t('owner.verticals')}</SectionTitle>
            <Card>
              {o.verticals.map((v) => (
                <Row key={v.transportType} label={t(`requests.form.vertical.${v.transportType}`)} value={<StatusBadge label={statusLabel({ t, has }, 'vertical', v.status)} tone={toneFor('vertical', v.status)} />} />
              ))}
              <VerticalApply owner={o} onChanged={() => void refresh()} />
            </Card>

            <SectionTitle>{t('owner.serviceAreas')}</SectionTitle>
            <Card>
              <Muted>{t('owner.serviceAreasHint')}</Muted>
              <View className="mt-2">
                {o.serviceAreaCityIds.length === 0 ? <Muted>{t('owner.noServiceAreas')}</Muted> : <Row label={t('owner.cities')} value={o.serviceAreaCityIds.map(cityName).join('، ')} />}
              </View>
              <View className="mt-3">
                <Button
                  title={t('owner.editServiceAreas')}
                  variant="secondary"
                  onPress={() => {
                    setEditing('areas');
                  }}
                />
              </View>
            </Card>

            <SectionTitle>{t('owner.privacy')}</SectionTitle>
            <Card>
              <PrivacySwitches owner={o} onChanged={() => void refresh()} />
            </Card>

            {editing === 'details' ? (
              <DetailsSheet
                owner={o}
                onClose={() => {
                  setEditing(null);
                }}
                onSaved={() => {
                  setNotice(t('owner.saved'));
                  void refresh();
                }}
              />
            ) : null}
            {editing === 'areas' ? (
              <ServiceAreasSheet
                owner={o}
                onClose={() => {
                  setEditing(null);
                }}
                onSaved={() => {
                  setNotice(t('owner.saved'));
                  void refresh();
                }}
              />
            ) : null}
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}

/** `PATCH /owners/{id}` — business names, CR, VAT and owner type; only the changed keys are sent (strict schema, at least one). */
function DetailsSheet({ owner, onClose, onSaved }: { owner: OwnerDto; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const action = useAction(PATCH_FIELDS);
  const [form, setForm] = useState({
    ownerType: owner.ownerType === 'COMPANY' ? 'COMPANY' : 'INDIVIDUAL',
    businessNameEn: owner.businessNameEn ?? '',
    businessNameAr: owner.businessNameAr ?? '',
    crNumber: owner.crNumber ?? '',
    vatNumber: owner.vatNumber ?? '',
    isVatRegistered: owner.isVatRegistered,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  const submit = async () => {
    const body: Record<string, unknown> = {};
    if (form.ownerType !== owner.ownerType) body['ownerType'] = form.ownerType;
    const str = (k: 'businessNameEn' | 'businessNameAr' | 'crNumber' | 'vatNumber') => {
      const v = form[k].trim() || null;
      if (v !== (owner[k] ?? null)) body[k] = v;
    };
    str('businessNameEn');
    str('businessNameAr');
    str('crNumber');
    str('vatNumber');
    if (form.isVatRegistered !== owner.isVatRegistered) body['isVatRegistered'] = form.isVatRegistered;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    const res = await action.run(() => api<OwnerDto>(`/owners/${owner.id}`, { method: 'PATCH', body }));
    if (!res) return;
    onSaved();
    onClose();
  };

  return (
    <Sheet title={t('owner.edit')} onClose={onClose}>
      {owner.onboardingStatus === 'APPROVED' ? <Notice tone="warning" message={t('owner.editApprovedHint')} /> : null}
      <ErrorBanner message={action.banner} />
      <Label>{t('owner.ownerType')}</Label>
      <Segmented
        options={[
          { value: 'INDIVIDUAL', label: t('owner.type.INDIVIDUAL') },
          { value: 'COMPANY', label: t('owner.type.COMPANY') },
        ]}
        value={form.ownerType}
        onChange={(v) => { set('ownerType', v); }}
      />
      <Label>{t('owner.businessNameEn')}</Label>
      <Field value={form.businessNameEn} onChangeText={(v) => { set('businessNameEn', v); }} error={action.fields['businessNameEn']} />
      <Label>{t('owner.businessNameAr')}</Label>
      <Field value={form.businessNameAr} onChangeText={(v) => { set('businessNameAr', v); }} error={action.fields['businessNameAr']} />
      <Label>{t('owner.crNumber')}</Label>
      <Field value={form.crNumber} onChangeText={(v) => { set('crNumber', v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" error={action.fields['crNumber']} style={{ writingDirection: 'ltr' }} />
      <CheckRow label={t('owner.isVatRegistered')} value={form.isVatRegistered} onChange={(v) => { set('isVatRegistered', v); }} />
      {form.isVatRegistered ? (
        <>
          <Label>{t('owner.vatNumber')}</Label>
          <Field value={form.vatNumber} onChangeText={(v) => { set('vatNumber', v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" maxLength={15} error={action.fields['vatNumber']} style={{ writingDirection: 'ltr' }} />
        </>
      ) : null}
      <Button title={t('common.save')} loading={action.busy} onPress={() => void submit()} />
    </Sheet>
  );
}

/** Apply for the other vertical: `PATCH /owners/{id} { transportTypes }` (approval is per vertical, by staff). */
function VerticalApply({ owner, onChanged }: { owner: OwnerDto; onChanged: () => void }) {
  const { t } = useI18n();
  const action = useAction(['transportTypes']);
  const settings = usePublicSettings();
  const enabled = useMemo(() => {
    const v = stringList(settingValue(settings.data, 'platform.verticals_enabled'));
    return v.length ? v : ['PASSENGER'];
  }, [settings.data]);
  const applied = owner.verticals.map((v) => v.transportType);
  const missing = enabled.filter((v) => !applied.includes(v));
  if (missing.length === 0) return null;
  const apply = async (v: string) => {
    const res = await action.run(() => api<OwnerDto>(`/owners/${owner.id}`, { method: 'PATCH', body: { transportTypes: [...applied, v] } }));
    if (!res) return;
    onChanged();
  };
  return (
    <View className="mt-2">
      <ErrorBanner message={action.banner} />
      {missing.map((v) => (
        <View key={v} className="mt-2">
          <Button title={t('owner.applyVertical', { vertical: t(`requests.form.vertical.${v}`) })} variant="secondary" loading={action.busy} onPress={() => void apply(v)} />
        </View>
      ))}
    </View>
  );
}

const PRIVACY_KEYS = ['showBusinessName', 'showRating', 'showFleetSize', 'showCity', 'showContactPhone'] as const;

/** `PATCH /owners/{id} { privacySettings: { key: bool } }` per switch (BRIEF-§28). */
function PrivacySwitches({ owner, onChanged }: { owner: OwnerDto; onChanged: () => void }) {
  const { t } = useI18n();
  const action = useAction(['privacySettings']);
  const toggle = async (key: (typeof PRIVACY_KEYS)[number], value: boolean) => {
    const res = await action.run(() => api<OwnerDto>(`/owners/${owner.id}`, { method: 'PATCH', body: { privacySettings: { [key]: value } } }));
    if (!res) return;
    onChanged();
  };
  return (
    <View>
      <ErrorBanner message={action.banner} />
      {PRIVACY_KEYS.map((k) => (
        <CheckRow key={k} label={t(`owner.privacyKeys.${k}`)} value={Boolean(owner.privacySettings[k])} onChange={(v) => void toggle(k, v)} />
      ))}
    </View>
  );
}

/** `PUT /owners/{id}/service-areas { cityIds }` — replaces the set; drives opportunity matching. */
function ServiceAreasSheet({ owner, onClose, onSaved }: { owner: OwnerDto; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const cities = useCities();
  const action = useAction(['cityIds']);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(owner.serviceAreaCityIds));

  const submit = async () => {
    const res = await action.run(() => api(`/owners/${owner.id}/service-areas`, { method: 'PUT', body: { cityIds: [...selected] } }));
    if (res === null) return;
    onSaved();
    onClose();
  };

  return (
    <Sheet title={t('owner.editServiceAreas')} onClose={onClose}>
      <Muted>{t('owner.serviceAreasHint')}</Muted>
      <View className="mt-3">
        <ErrorBanner message={action.banner} />
      </View>
      {(cities.data ?? [])
        .filter((c) => c.isActive)
        .map((c) => (
          <CheckRow
            key={c.id}
            label={locale === 'ar' ? c.nameAr : c.nameEn}
            value={selected.has(c.id)}
            onChange={(v) => {
              setSelected((s) => {
                const n = new Set(s);
                if (v) n.add(c.id);
                else n.delete(c.id);
                return n;
              });
            }}
          />
        ))}
      <Button title={t('common.save')} loading={action.busy} disabled={selected.size === 0 || selected.size > 50} onPress={() => void submit()} />
    </Sheet>
  );
}
