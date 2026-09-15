'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { InvitationDto, TripRequestDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { useRouter } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { REQUEST_TONE } from './requests-list';
import { PlatformAssign } from './platform-assign';
import { RequestBids } from './request-bids';

/** One request: status, counters, estimate, the detail block, lifecycle actions, and (staff) the invitation list. */
export function RequestDetail({ id, created }: { id: string; created?: string | undefined }) {
  const t = useTranslations('portal.requests');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { can, me } = useSession();
  const [r, setR] = useState<TripRequestDto | null>(null);
  const [invitations, setInvitations] = useState<InvitationDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<TripRequestDto>(`/trip-requests/${id}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setR(res.data);
    if (created === 'published') setNotice(t('form.published', { count: res.data.invitedOwnerCount }));
    else if (created === 'draft') setNotice(t('form.created'));
    if (can('trip_requests.read_any')) {
      const inv = await api<InvitationDto[]>(`/trip-requests/${id}/invitations`);
      if (inv.ok) setInvitations(inv.data);
    }
  }, [id, created, can, t]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await api<TripRequestDto>(`/trip-requests/${id}/${path}`, { method: 'POST', body: body ?? {} });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setR(res.data);
    if (path === 'publish') setNotice(t('form.published', { count: res.data.invitedOwnerCount }));
    if (can('trip_requests.read_any')) {
      const inv = await api<InvitationDto[]>(`/trip-requests/${id}/invitations`);
      if (inv.ok) setInvitations(inv.data);
    }
  }
  async function remove() {
    const res = await api(`/trip-requests/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.replace('/requests');
  }

  if (!r) {
    return error ? (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
      </Alert>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    );
  }
  const p = r.passengerDetails;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" dir="ltr">
            {r.requestNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {r.vehicleCategory ? (locale === 'ar' ? r.vehicleCategory.nameAr : r.vehicleCategory.nameEn) : ''} · {r.vehiclesAwarded}/{r.vehiclesRequired} {t('vehicles').toLowerCase()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={REQUEST_TONE[r.status] ?? 'outline'}>{t(`status.${r.status}` as 'status.DRAFT')}</Badge>
          <Badge variant={r.biddingOpen ? 'default' : 'outline'}>{r.biddingOpen ? t('open') : t('closed')}</Badge>
        </div>
      </div>
      {notice && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('route')}</CardTitle>
            <CardDescription dir="ltr">{new Date(r.pickupAt).toLocaleString()}{r.returnAt ? ` → ${new Date(r.returnAt).toLocaleString()}` : ''}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">{t('pickup')}: </span>
              {r.pickup.addressLine}
            </div>
            <div>
              <span className="text-muted-foreground">→ </span>
              {r.dropoff.addressLine}
            </div>
            {r.estimatedDistanceKm && (
              <div className="text-muted-foreground">
                {t('detail.estimate')}: {t('detail.distance', { km: r.estimatedDistanceKm })} · {t('detail.duration', { min: r.estimatedDurationMinutes ?? 0 })}
              </div>
            )}
            <div className="text-muted-foreground" dir="ltr">
              {t('detail.deadline')}: {new Date(r.biddingClosesAt).toLocaleString()}
            </div>
            {r.specialInstructions && <div className="rounded-md bg-muted p-2">{r.specialInstructions}</div>}
          </CardContent>
        </Card>
        {p && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('form.passengers')}</CardTitle>
              <CardDescription>{t(`purpose.${p.tripPurpose}` as 'purpose.OTHER')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">{p.passengerCount} 👤</Badge>
              <Badge variant="outline">{t('form.luggage')}: {p.luggageCount}</Badge>
              {p.requiresWheelchairAccess && <Badge variant="outline">{t('form.wheelchair')}</Badge>}
              {p.requiresFemaleDriver && <Badge variant="outline">{t('form.femaleDriver')}</Badge>}
              {p.childSeatsRequired > 0 && <Badge variant="outline">{t('form.childSeats')}: {p.childSeatsRequired}</Badge>}
            </CardContent>
          </Card>
        )}
      </div>

      {!r.redacted && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            {r.status === 'DRAFT' && (
              <>
                <Button disabled={busy} onClick={() => void act('publish')}>
                  {busy && <Loader2 className="animate-spin" />}
                  {t('detail.publish')}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void remove()}>
                  {t('detail.delete')}
                </Button>
              </>
            )}
            {['DRAFT', 'PUBLISHED', 'PARTIALLY_AWARDED'].includes(r.status) && r.vehiclesAwarded === 0 && (
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="reason">{t('detail.cancelReason')}</Label>
                  <Input id="reason" value={reason} onChange={(e) => { setReason(e.target.value); }} />
                </div>
                <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => void act('cancel', { reason: reason.trim() })}>
                  {t('detail.cancel')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!r.redacted && ['PUBLISHED', 'PARTIALLY_AWARDED', 'FULLY_AWARDED', 'CLOSED_PARTIAL'].includes(r.status) && (
        <RequestBids request={r} canAccept={can('bids.accept') && (r.customerProfileId === me?.profiles.customer?.id || can('trip_requests.read_any'))} onChanged={setR} />
      )}

      {!r.redacted && can('bookings.manage') && ['PUBLISHED', 'PARTIALLY_AWARDED'].includes(r.status) && <PlatformAssign request={r} onChanged={setR} />}

      {invitations && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detail.invitations')}</CardTitle>
            <CardDescription>{t('invited', { count: r.invitedOwnerCount })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {invitations.length === 0 && <p className="text-muted-foreground">{t('detail.noInvitations')}</p>}
            {invitations.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <div>
                  <span className="font-medium">{i.ownerName}</span>
                  <span className="ms-2 text-muted-foreground" dir="ltr">
                    {i.vehiclePlate}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{i.matchScore}</Badge>
                  {i.viewedAt && <Badge variant="secondary">viewed</Badge>}
                  {i.dismissedAt && <Badge variant="destructive">dismissed</Badge>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
