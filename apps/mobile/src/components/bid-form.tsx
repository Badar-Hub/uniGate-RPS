import { Text, View } from 'react-native';
import { DateTimeField } from '@/components/date-time-field';
import { SelectField, type SelectOption } from '@/components/select-field';
import { Button, Field, IconButton, Label, Muted, SectionTitle, TextArea } from '@/components/ui';
import { useI18n } from '@/i18n';
import { MAX_EXTRAS, newExtra, previewExtrasTotal, type BidFormState } from '@/lib/bid-body';
import { formatDateTime } from '@/lib/format';
import { useDrivers, useVehicleDrivers } from '@/lib/queries';

/**
 * The bid inputs shared by "place a bid" and "revise": vehicle (from the opportunity's eligible
 * list; locked on a revision), driver (approved drivers with an open assignment on that
 * vehicle — the same join the booking's assign-driver picker needs), base amount, up to 20
 * extras with a bilingual label, estimated duration, validity and notes. Totals are never
 * typed: the API computes extras, VAT and the total (api.md §8.13).
 */
export function BidFormFields({
  form,
  onChange,
  vehicles,
  vehicleLocked = false,
  fields,
  deadline,
}: {
  form: BidFormState;
  onChange: (next: BidFormState) => void;
  vehicles: SelectOption[];
  vehicleLocked?: boolean;
  /** Field errors: client-side (already translated) merged with the API's. */
  fields: Record<string, string | undefined>;
  deadline?: string | null | undefined;
}) {
  const { t, locale } = useI18n();
  const drivers = useEligibleDrivers(form.vehicleId, t('fleet.detail.primary'));
  const set = <K extends keyof BidFormState>(k: K, v: BidFormState[K]) => {
    onChange({ ...form, [k]: v });
  };
  const setExtra = (key: string, patch: Partial<BidFormState['extras'][number]>) => {
    set(
      'extras',
      form.extras.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    );
  };

  return (
    <View>
      <SelectField
        label={t('bidForm.vehicle')}
        value={form.vehicleId}
        options={vehicles}
        onChange={(v) => {
          onChange({ ...form, vehicleId: v, driverProfileId: '' });
        }}
        placeholder={t('common.choose')}
        disabled={vehicleLocked}
        error={fields['vehicleId']}
      />
      <SelectField
        label={t('bidForm.driver')}
        value={form.driverProfileId}
        options={drivers.options}
        onChange={(v) => {
          set('driverProfileId', v);
        }}
        placeholder={!form.vehicleId ? t('bidForm.driverPickVehicle') : drivers.loading ? t('common.loading') : drivers.options.length ? t('bidForm.driverLater') : t('bidForm.noDrivers')}
        disabled={!form.vehicleId || drivers.options.length === 0}
        clearable
        error={fields['driverProfileId']}
      />

      <Label>{t('bidForm.baseAmount')}</Label>
      <Field
        value={form.baseAmount}
        onChangeText={(v) => {
          set('baseAmount', v);
        }}
        keyboardType="decimal-pad"
        placeholder="1250.00"
        error={fields['baseAmount']}
      />

      <SectionTitle>{t('bidForm.extras')}</SectionTitle>
      <Muted>{t('bidForm.extrasHint')}</Muted>
      {fields['extrasBreakdown'] ? <Text className="mt-1 text-xs text-destructive text-start">{fields['extrasBreakdown']}</Text> : null}
      {form.extras.map((x, i) => (
        <View key={x.key} className="mt-3 rounded-md border border-border p-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-foreground text-start">{t('bidForm.extraN', { n: i + 1 })}</Text>
            <IconButton
              icon="trash-outline"
              label={t('bidForm.removeExtra')}
              onPress={() => {
                set(
                  'extras',
                  form.extras.filter((e) => e.key !== x.key),
                );
              }}
            />
          </View>
          <Label>{t('bidForm.extraLabelEn')}</Label>
          <Field
            value={x.labelEn}
            onChangeText={(v) => {
              setExtra(x.key, { labelEn: v });
            }}
            error={fields[`extrasBreakdown.${i}.labelEn`]}
          />
          <Label>{t('bidForm.extraLabelAr')}</Label>
          <Field
            value={x.labelAr}
            onChangeText={(v) => {
              setExtra(x.key, { labelAr: v });
            }}
            error={fields[`extrasBreakdown.${i}.labelAr`]}
          />
          <Label>{t('bidForm.extraAmount')}</Label>
          <Field
            value={x.amount}
            onChangeText={(v) => {
              setExtra(x.key, { amount: v });
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            error={fields[`extrasBreakdown.${i}.amount`]}
          />
        </View>
      ))}
      <View className="mt-3 flex-row items-center justify-between">
        <Button
          title={t('bidForm.addExtra')}
          variant="secondary"
          disabled={form.extras.length >= MAX_EXTRAS}
          onPress={() => {
            set('extras', [...form.extras, newExtra()]);
          }}
        />
        {form.extras.length ? (
          <Text className="text-sm text-muted-foreground" style={{ writingDirection: 'ltr' }}>
            {t('bidForm.extrasTotal', { total: previewExtrasTotal(form.extras) })}
          </Text>
        ) : null}
      </View>

      <SectionTitle>{t('bidForm.timing')}</SectionTitle>
      <Label>{t('bidForm.duration')}</Label>
      <Field
        value={form.estimatedDurationMinutes}
        onChangeText={(v) => {
          set('estimatedDurationMinutes', v.replace(/[^0-9]/g, ''));
        }}
        keyboardType="number-pad"
        error={fields['estimatedDurationMinutes']}
      />
      <DateTimeField
        label={t('bidForm.validUntil')}
        value={form.validUntil}
        onChange={(d) => {
          set('validUntil', d);
        }}
        minimumDate={new Date()}
        error={fields['validUntil']}
        doneLabel={t('common.done')}
      />
      <Muted>{deadline ? t('bidForm.validUntilHint', { deadline: formatDateTime(deadline, locale) }) : t('bidForm.validUntilDefault')}</Muted>

      <SectionTitle>{t('bidForm.notes')}</SectionTitle>
      <TextArea
        value={form.notes}
        onChangeText={(v) => {
          set('notes', v);
        }}
        error={fields['ownerNotes']}
      />
    </View>
  );
}

/** Approved drivers of the owner with an open assignment on the vehicle (`GET /vehicles/{id}/drivers` ∩ `GET /drivers?approvalStatus=APPROVED`). */
export function useEligibleDrivers(vehicleId: string, primaryLabel: string): { options: SelectOption[]; loading: boolean } {
  const assignments = useVehicleDrivers(vehicleId, vehicleId.length > 0);
  const approved = useDrivers('APPROVED', vehicleId.length > 0);
  const approvedIds = new Set((approved.data ?? []).map((d) => d.id));
  const options = (assignments.data ?? [])
    .filter((a) => !a.assignedTo && (approved.data === undefined || approvedIds.has(a.driverProfileId)))
    .map((a) => ({ value: a.driverProfileId, label: a.driverName, hint: a.isPrimary ? primaryLabel : undefined }));
  const unique = options.filter((o, i) => options.findIndex((x) => x.value === o.value) === i);
  return { options: unique, loading: assignments.isPending || approved.isPending };
}
