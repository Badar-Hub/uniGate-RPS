'use client';

import { useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Gavel, Loader2, UserX } from 'lucide-react';
import type { BookingDisputeResultDto, BookingDto, CancelBookingResultDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const select = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';
const CATEGORIES = ['SERVICE_QUALITY', 'SAFETY', 'DRIVER_BEHAVIOUR', 'VEHICLE_CONDITION', 'DELAY', 'DAMAGE_OR_LOSS', 'BILLING', 'OTHER'];

/**
 * Disputes and no-show (api.md §8.15): a party disputes an in-progress / completed booking
 * (a linked complaint opens); staff resolve it (service stands, or a refund request); ops
 * record a customer or owner no-show with the policy charge and an optional fee override.
 */
export function BookingOpsActions({ booking, onChanged }: { booking: BookingDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal.bookings.ops');
  const tc = useTranslations('common');
  const { can } = useSession();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dispute, setDispute] = useState({ category: 'SERVICE_QUALITY', subject: '', description: '' });
  const [resolve, setResolve] = useState({ outcome: 'COMPLETED', resolution: '', refundAmount: '' });
  const [noShow, setNoShow] = useState({ party: 'CUSTOMER', reasonText: '', feeValue: '', feeReason: '' });

  const canDispute = can('complaints.create') && (booking.status === 'IN_PROGRESS' || booking.status === 'COMPLETED');
  const canResolve = can('complaints.manage') && booking.status === 'DISPUTED';
  const canNoShow = can('bookings.manage') && ['CONFIRMED', 'DRIVER_ASSIGNED', 'READY'].includes(booking.status);
  if (!canDispute && !canResolve && !canNoShow) return null;

  async function run<T>(fn: () => Promise<{ ok: boolean; error?: ApiError; data?: T }>, done: (d: T) => string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fn();
    setBusy(false);
    if (res.ok && res.data !== undefined) {
      setNotice(done(res.data));
      await onChanged();
    } else if (!res.ok && res.error) setError(res.error);
  }
  const submitDispute = (e: SyntheticEvent) => {
    e.preventDefault();
    void run(() => api<BookingDisputeResultDto>(`/bookings/${booking.id}/dispute`, { method: 'POST', body: dispute }), (d) => t('disputed', { number: d.complaint.complaintNumber }));
  };
  const submitResolve = (e: SyntheticEvent) => {
    e.preventDefault();
    void run(() => api<BookingDisputeResultDto>(`/bookings/${booking.id}/resolve-dispute`, { method: 'POST', body: { outcome: resolve.outcome, resolution: resolve.resolution, ...(resolve.outcome === 'REFUND' && resolve.refundAmount ? { refundAmount: resolve.refundAmount } : {}) } }), (d) => (d.refund ? t('resolvedRefund', { number: d.refund.refundNumber }) : t('resolvedCompleted')));
  };
  const submitNoShow = (e: SyntheticEvent) => {
    e.preventDefault();
    void run(() => api<CancelBookingResultDto>(`/bookings/${booking.id}/no-show`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { party: noShow.party, ...(noShow.reasonText ? { reasonText: noShow.reasonText } : {}), ...(noShow.feeValue ? { feeOverride: { type: 'FIXED', value: noShow.feeValue, reason: noShow.feeReason || 'No-show penalty' } } : {}) } }), (d) => t('noShowRecorded', { fee: d.cancellation.cancellationFeeAmount, refund: d.cancellation.refundAmount }));
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
        )}
        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
        {canDispute && (
          <form className="grid gap-2 sm:grid-cols-3" onSubmit={submitDispute}>
            <div className="space-y-1">
              <Label htmlFor="dp-cat">{t('category')}</Label>
              <select id="dp-cat" className={select} value={dispute.category} onChange={(e) => { setDispute({ ...dispute, category: e.target.value }); }}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="dp-subject">{t('subject')}</Label><Input id="dp-subject" required value={dispute.subject} onChange={(e) => { setDispute({ ...dispute, subject: e.target.value }); }} /></div>
            <div className="space-y-1 sm:col-span-3"><Label htmlFor="dp-desc">{t('description')}</Label><Input id="dp-desc" required value={dispute.description} onChange={(e) => { setDispute({ ...dispute, description: e.target.value }); }} /></div>
            <div><Button type="submit" variant="outline" disabled={busy || dispute.subject.length < 3 || dispute.description.length < 10}>{busy ? <Loader2 className="animate-spin" /> : <Gavel className="size-4" />}{t('dispute')}</Button></div>
          </form>
        )}
        {canResolve && (
          <form className="grid gap-2 sm:grid-cols-4" onSubmit={submitResolve}>
            <div className="space-y-1">
              <Label htmlFor="rs-outcome">{t('outcome')}</Label>
              <select id="rs-outcome" className={select} value={resolve.outcome} onChange={(e) => { setResolve({ ...resolve, outcome: e.target.value }); }}>
                <option value="COMPLETED">{t('outcomes.COMPLETED')}</option>
                <option value="REFUND">{t('outcomes.REFUND')}</option>
              </select>
            </div>
            {resolve.outcome === 'REFUND' && <div className="space-y-1"><Label htmlFor="rs-amount">{t('refundAmount')}</Label><Input id="rs-amount" dir="ltr" placeholder={booking.totalAmount} value={resolve.refundAmount} onChange={(e) => { setResolve({ ...resolve, refundAmount: e.target.value }); }} /></div>}
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="rs-res">{t('resolution')}</Label><Input id="rs-res" required value={resolve.resolution} onChange={(e) => { setResolve({ ...resolve, resolution: e.target.value }); }} /></div>
            <div><Button type="submit" disabled={busy || resolve.resolution.length < 3}>{busy ? <Loader2 className="animate-spin" /> : <Gavel className="size-4" />}{t('resolve')}</Button></div>
          </form>
        )}
        {canNoShow && (
          <form className="grid gap-2 sm:grid-cols-4" onSubmit={submitNoShow}>
            <div className="space-y-1">
              <Label htmlFor="ns-party">{t('party')}</Label>
              <select id="ns-party" className={select} value={noShow.party} onChange={(e) => { setNoShow({ ...noShow, party: e.target.value }); }}>
                <option value="CUSTOMER">{t('parties.CUSTOMER')}</option>
                <option value="OWNER">{t('parties.OWNER')}</option>
              </select>
            </div>
            <div className="space-y-1"><Label htmlFor="ns-reason">{t('reasonText')}</Label><Input id="ns-reason" value={noShow.reasonText} onChange={(e) => { setNoShow({ ...noShow, reasonText: e.target.value }); }} /></div>
            <div className="space-y-1"><Label htmlFor="ns-fee">{t('feeOverride')}</Label><Input id="ns-fee" dir="ltr" placeholder="0.00" value={noShow.feeValue} onChange={(e) => { setNoShow({ ...noShow, feeValue: e.target.value }); }} /></div>
            <div className="space-y-1"><Label htmlFor="ns-fee-reason">{t('feeReason')}</Label><Input id="ns-fee-reason" value={noShow.feeReason} onChange={(e) => { setNoShow({ ...noShow, feeReason: e.target.value }); }} /></div>
            <div className="sm:col-span-4"><Button type="submit" variant="destructive" disabled={busy || (Boolean(noShow.feeValue) && noShow.feeReason.length < 3)}>{busy ? <Loader2 className="animate-spin" /> : <UserX className="size-4" />}{t('recordNoShow')}</Button></div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
