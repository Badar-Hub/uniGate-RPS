import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { idempotencyKey } from '@unigate/api-client';
import type { PaymentConfigDto, PaymentDto } from '@unigate/types';
import { DateTimeField } from '@/components/date-time-field';
import { Button, Card, ErrorBanner, Field, Label, Muted, Notice, ProgressBar, Row, SectionTitle } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { formatBytes, pickDocumentFile, type PickSource } from '@/lib/documents/pick';
import { uploadDocument, type PickedFile, type UploadProgress } from '@/lib/documents/upload';
import { formatDateTime, formatMoney } from '@/lib/format';

export const BANK_TRANSFER_PROVIDER = 'bank_transfer';
const RECEIPT_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const STAGE_KEYS = {
  hashing: 'documents.stage.hashing',
  requesting: 'documents.stage.requesting',
  uploading: 'documents.stage.uploading',
  confirming: 'documents.stage.confirming',
} as const;

type BankConfig = NonNullable<PaymentConfigDto['bankTransfer']>;

/** The account the customer transfers to (GET /payments/config — printed on invoices, never a secret). */
export function BankAccountDetails({ bt, amount, currency, reference }: { bt: BankConfig; amount: string; currency: string; reference: string | null }) {
  const { t, locale } = useI18n();
  return (
    <Card>
      <Row label={t('payments.bank.bankName')} value={bt.bankName} />
      <Row label={t('payments.bank.accountName')} value={bt.accountName} />
      <Row
        label={t('payments.bank.iban')}
        value={
          <Text selectable className="font-mono text-sm text-card-foreground" style={{ writingDirection: 'ltr' }}>
            {bt.iban}
          </Text>
        }
      />
      <Row label={t('payments.bank.amount')} value={formatMoney(amount, currency)} ltr />
      {reference ? (
        <Row
          label={t('payments.bank.reference')}
          value={
            <Text selectable className="font-mono text-sm text-card-foreground" style={{ writingDirection: 'ltr' }}>
              {reference}
            </Text>
          }
        />
      ) : null}
      <View className="mt-2">
        <Muted>{locale === 'ar' ? bt.instructionsAr : bt.instructionsEn}</Muted>
      </View>
    </Card>
  );
}

/**
 * A PENDING bank-transfer (IBFT) payment: the account to transfer to, then the receipt
 * (a document on target PAYMENT/{id} → POST /payments/{id}/receipt). Once the receipt is in the
 * payment reads "awaiting verification"; only finance turns it into PAID (api.md §8.17), so the
 * screen never claims success on its own — "Check status" re-reads the payment.
 */
export function BankTransferPanel({ payment, bt, onChange, onCancelled }: {
  payment: PaymentDto;
  bt: BankConfig;
  onChange: (p: PaymentDto) => void;
  onCancelled: () => void;
}) {
  const { t, locale, errorMessage } = useI18n();
  const action = useAction(['documentId', 'transferReference', 'transferredAt']);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [reference, setReference] = useState(payment.bankTransfer?.transferReference ?? '');
  const [transferredAt, setTransferredAt] = useState<Date | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [replacing, setReplacing] = useState(false);

  const awaiting = payment.bankTransfer?.awaitingVerification ?? false;
  const showForm = payment.status === 'PENDING' && (!awaiting || replacing);

  const pick = async (source: PickSource) => {
    setPickError(null);
    setPicking(true);
    const res = await pickDocumentFile(source, RECEIPT_MIME);
    setPicking(false);
    if (!res.ok) {
      if (res.reason === 'permission') setPickError(t('documents.pick.permission'));
      else if (res.reason === 'too_large') setPickError(t('documents.pick.tooLarge'));
      else if (res.reason === 'failed') setPickError(res.message ?? errorMessage(null));
      return;
    }
    if (!RECEIPT_MIME.includes(res.file.mimeType)) {
      setPickError(t('documents.pick.typeNotAllowed', { types: 'PDF, JPG, PNG' }));
      return;
    }
    setFile(res.file);
  };

  const submit = async () => {
    if (!file) return;
    setProgress({ stage: 'hashing', fraction: 0 });
    const doc = await action.run(() =>
      uploadDocument({ documentTypeCode: 'PAYMENT_RECEIPT', target: { kind: 'PAYMENT', id: payment.id }, file, visibility: 'INTERNAL', onProgress: setProgress }),
    );
    setProgress(null);
    if (!doc) return;
    const res = await action.run(() =>
      api<PaymentDto>(`/payments/${payment.id}/receipt`, {
        method: 'POST',
        body: {
          documentId: doc.id,
          ...(reference.trim() ? { transferReference: reference.trim() } : {}),
          ...(transferredAt ? { transferredAt: transferredAt.toISOString() } : {}),
        },
        headers: { 'Idempotency-Key': idempotencyKey() },
      }),
    );
    if (!res) return;
    setFile(null);
    setReplacing(false);
    onChange(res);
  };

  const check = async () => {
    const res = await action.run(() => api<PaymentDto>(`/payments/${payment.id}`));
    if (res) onChange(res);
  };

  const cancel = () => {
    Alert.alert(t('payments.bank.chooseAnother'), t('payments.bank.cancelConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.yes'),
        style: 'destructive',
        onPress: () => {
          void action
            .run(() => api(`/payments/${payment.id}/cancel`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': idempotencyKey() } }))
            .then((r) => { if (r !== null) onCancelled(); });
        },
      },
    ]);
  };

  if (payment.status === 'PAID') {
    return <Notice message={t('payments.bank.verified', { at: payment.bankTransfer?.verifiedAt ? formatDateTime(payment.bankTransfer.verifiedAt, locale) : '' })} />;
  }
  if (payment.status !== 'PENDING') {
    return (
      <Notice
        tone="warning"
        message={
          payment.failureCode === 'TRANSFER_REJECTED'
            ? t('payments.bank.rejected', { reason: payment.bankTransfer?.verificationNotes ?? '' })
            : t('payments.bank.closed', { status: payment.status })
        }
      />
    );
  }

  return (
    <View>
      <Muted>{t('payments.bank.intro')}</Muted>
      <View className="my-3">
        <BankAccountDetails bt={bt} amount={payment.amount} currency={payment.currency} reference={payment.paymentNumber} />
      </View>
      <ErrorBanner message={action.banner ?? pickError} />
      {awaiting ? (
        <View className="mb-3">
          <Notice message={t('payments.bank.awaiting', { at: payment.bankTransfer?.receiptSubmittedAt ? formatDateTime(payment.bankTransfer.receiptSubmittedAt, locale) : '' })} />
          <View className="mt-2 flex-row gap-2">
            <View className="flex-1">
              <Button title={t('payments.bank.checkStatus')} variant="secondary" loading={action.busy && !progress} onPress={() => void check()} />
            </View>
            {!replacing ? (
              <View className="flex-1">
                <Button title={t('payments.bank.replaceReceipt')} variant="ghost" disabled={action.busy} onPress={() => { setReplacing(true); }} />
              </View>
            ) : null}
          </View>
        </View>
      ) : payment.expiresAt ? (
        <View className="mb-3">
          <Muted>{t('payments.bank.receiptDeadline', { at: formatDateTime(payment.expiresAt, locale) })}</Muted>
        </View>
      ) : null}

      {showForm ? (
        <View>
          <SectionTitle>{t('payments.bank.receiptTitle')}</SectionTitle>
          <Label>{t('payments.bank.transferReference')}</Label>
          <Field value={reference} onChangeText={setReference} maxLength={64} autoCapitalize="characters" placeholder={t('payments.bank.transferReferenceHint')} error={action.fields['transferReference']} />
          <DateTimeField label={t('payments.bank.transferredAt')} value={transferredAt} onChange={setTransferredAt} error={action.fields['transferredAt']} doneLabel={t('common.done')} />

          <View className="mb-3 mt-2 flex-row gap-2">
            <View className="flex-1">
              <Button title={t('documents.pick.camera')} variant="secondary" disabled={picking || Boolean(progress)} onPress={() => void pick('camera')} />
            </View>
            <View className="flex-1">
              <Button title={t('documents.pick.gallery')} variant="secondary" disabled={picking || Boolean(progress)} onPress={() => void pick('gallery')} />
            </View>
          </View>
          <Button title={t('documents.pick.file')} variant="secondary" disabled={picking || Boolean(progress)} onPress={() => void pick('file')} />
          <View className="my-3 rounded-md border border-border bg-muted p-3">
            {file ? (
              <>
                <Text className="text-sm font-medium text-foreground" style={{ writingDirection: 'ltr' }} numberOfLines={1}>
                  {file.name}
                </Text>
                <Muted ltr>
                  {file.mimeType}
                  {file.size !== null ? ` · ${formatBytes(file.size)}` : ''}
                </Muted>
              </>
            ) : (
              <Muted>{picking ? t('common.loading') : t('documents.pick.none')}</Muted>
            )}
          </View>
          {progress ? <ProgressBar fraction={progress.fraction} label={t(STAGE_KEYS[progress.stage])} /> : null}
          <Button title={progress ? t('documents.uploading') : t('payments.bank.submitReceipt')} loading={action.busy} disabled={!file || action.busy} onPress={() => void submit()} />
          <View className="mt-2 gap-2">
            {replacing ? <Button title={t('common.cancel')} variant="ghost" disabled={action.busy} onPress={() => { setReplacing(false); }} /> : null}
            {!awaiting ? <Button title={t('payments.bank.chooseAnother')} variant="ghost" disabled={action.busy} onPress={cancel} /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
