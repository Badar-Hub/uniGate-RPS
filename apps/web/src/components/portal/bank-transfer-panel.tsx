'use client';

import { useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Copy, Loader2, RefreshCw } from 'lucide-react';
import type { PaymentConfigDto, PaymentDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { uploadDocument } from '@/lib/documents/upload';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const RECEIPT_ACCEPT = 'application/pdf,image/jpeg,image/png';
const fmt = (locale: string, iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** Read-only account details the customer transfers to (from GET /payments/config — never a secret, it is printed on invoices). */
export function BankAccountDetails({ bt, amount, currency, reference }: { bt: NonNullable<PaymentConfigDto['bankTransfer']>; amount: string; currency: string; reference: string | null }) {
  const t = useTranslations('portal.payments.bank');
  const locale = useLocale();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => { setCopied((c) => (c === key ? null : c)); }, 1500);
    } catch {
      /* clipboard unavailable (plain HTTP): the value is selectable */
    }
  };
  const row = (key: string, label: string, value: string, mono = true) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <span dir="ltr" className={mono ? 'select-all font-mono text-sm' : 'text-sm'}>{value}</span>
        {mono && (
          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('copy', { what: label })} onClick={() => void copy(key, value)}>
            {copied === key ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        )}
      </span>
    </div>
  );
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
      {row('bank', t('bankName'), bt.bankName, false)}
      {row('name', t('accountName'), bt.accountName, false)}
      {row('iban', t('iban'), bt.iban)}
      {row('amount', t('amount'), `${amount} ${currency}`)}
      {reference && row('ref', t('reference'), reference)}
      <p className="mt-2 text-xs text-muted-foreground">{locale === 'ar' ? bt.instructionsAr : bt.instructionsEn}</p>
    </div>
  );
}

/**
 * A PENDING bank-transfer payment from the customer's side: the account to transfer to, then the
 * receipt form (document on target PAYMENT/{id} → POST /payments/{id}/receipt). Once the receipt is
 * in, the payment shows "awaiting verification"; only finance can turn it into PAID (api.md §8.17).
 */
export function BankTransferPanel({ payment, bt, onChange, onPaid, onCancelled }: {
  payment: PaymentDto;
  bt: NonNullable<PaymentConfigDto['bankTransfer']>;
  onChange: (p: PaymentDto) => void;
  onPaid: () => void;
  onCancelled: () => void;
}) {
  const t = useTranslations('portal.payments.bank');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState(payment.bankTransfer?.transferReference ?? '');
  const [transferredAt, setTransferredAt] = useState('');
  const [stage, setStage] = useState<'hashing' | 'requesting' | 'uploading' | 'confirming' | 'submitting' | null>(null);
  const [checking, setChecking] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const awaiting = payment.bankTransfer?.awaitingVerification ?? false;
  const showForm = !awaiting || replacing;

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    const up = await uploadDocument({ documentTypeCode: 'PAYMENT_RECEIPT', target: { kind: 'PAYMENT', id: payment.id }, file, visibility: 'INTERNAL', onProgress: setStage });
    if (!up.ok) {
      setStage(null);
      setError(up.error);
      return;
    }
    setStage('submitting');
    const body = {
      documentId: up.data.id,
      ...(reference.trim() ? { transferReference: reference.trim() } : {}),
      ...(transferredAt ? { transferredAt: new Date(transferredAt).toISOString() } : {}),
    };
    const res = await api<PaymentDto>(`/payments/${payment.id}/receipt`, { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } });
    setStage(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setFile(null);
    setReplacing(false);
    onChange(res.data);
  }

  async function check() {
    setChecking(true);
    setError(null);
    const res = await api<PaymentDto>(`/payments/${payment.id}`);
    setChecking(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChange(res.data);
    if (res.data.status === 'PAID') onPaid();
  }

  async function cancel() {
    if (!window.confirm(t('cancelConfirm'))) return;
    setError(null);
    const res = await api(`/payments/${payment.id}/cancel`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': idempotencyKey() } });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCancelled();
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
        </Alert>
      )}
      {payment.status === 'PAID' ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>{t('verified', { at: payment.bankTransfer?.verifiedAt ? fmt(locale, payment.bankTransfer.verifiedAt) : '' })}</AlertDescription>
        </Alert>
      ) : payment.status !== 'PENDING' ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{payment.failureCode === 'TRANSFER_REJECTED' ? t('rejected', { reason: payment.bankTransfer?.verificationNotes ?? '' }) : t('closed', { status: payment.status })}</AlertDescription>
        </Alert>
      ) : (
        <>
          <p className="text-sm">{t('intro')}</p>
          <BankAccountDetails bt={bt} amount={payment.amount} currency={payment.currency} reference={payment.paymentNumber} />
          {awaiting && (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertDescription>
                {t('awaiting', { at: payment.bankTransfer?.receiptSubmittedAt ? fmt(locale, payment.bankTransfer.receiptSubmittedAt) : '' })}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={checking} onClick={() => void check()}>
                    {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {t('checkStatus')}
                  </Button>
                  {!replacing && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setReplacing(true); }}>{t('replaceReceipt')}</Button>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
          {!awaiting && payment.expiresAt && <p className="text-xs text-muted-foreground">{t('receiptDeadline', { at: fmt(locale, payment.expiresAt) })}</p>}
          {showForm && (
            <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">{t('receiptTitle')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="bt-ref">{t('transferReference')}</Label>
                  <Input id="bt-ref" dir="ltr" maxLength={64} value={reference} onChange={(e) => { setReference(e.target.value); }} placeholder={t('transferReferenceHint')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bt-at">{t('transferredAt')}</Label>
                  <Input id="bt-at" type="datetime-local" dir="ltr" max={new Date().toISOString().slice(0, 16)} value={transferredAt} onChange={(e) => { setTransferredAt(e.target.value); }} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="bt-file">{t('receiptFile')}</Label>
                <Input id="bt-file" type="file" accept={RECEIPT_ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] ?? null); }} />
                <p className="text-xs text-muted-foreground">{t('receiptFileHint')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!file || stage !== null}>
                  {stage !== null && <Loader2 className="animate-spin" />}
                  {stage !== null ? t(`stage.${stage}`) : t('submitReceipt')}
                </Button>
                {replacing && <Button type="button" variant="ghost" onClick={() => { setReplacing(false); }}>{tc('cancel')}</Button>}
                {!awaiting && <Button type="button" variant="ghost" onClick={() => void cancel()}>{t('chooseAnother')}</Button>}
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
