'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { BookingDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const BOOKING_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING_PAYMENT: 'secondary', CONFIRMED: 'default', DRIVER_ASSIGNED: 'default', READY: 'default', IN_PROGRESS: 'default', COMPLETED: 'outline', CANCELLED: 'destructive', DISPUTED: 'destructive', REFUNDED: 'outline',
};

/** Bookings the actor is a party to (customer, owner, assigned driver); staff with bookings.read_any see all. */
export function BookingsList() {
  const t = useTranslations('portal.bookings');
  const tc = useTranslations('common');
  const [rows, setRows] = useState<BookingDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    void api<BookingDto[]>('/bookings', { query: { pageSize: 100 } }).then((res) => {
      if (res.ok) setRows(res.data);
      else setError(res.error);
    });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('number')}</TableHead>
                <TableHead>{t('vehicle')}</TableHead>
                <TableHead>{t('when')}</TableHead>
                <TableHead>{t('total')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
                <TableHead>{t('payment')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="inline size-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/bookings/${b.id}`} className="font-medium text-primary underline-offset-4 hover:underline" dir="ltr">
                        {b.bookingNumber}
                      </Link>
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {b.requestNumber} · {t('wave', { n: b.fulfilmentSequence })}
                      </div>
                    </TableCell>
                    <TableCell dir="ltr">
                      {b.vehiclePlateSnapshot}
                      <div className="text-xs text-muted-foreground">{b.vehicleDescriptionSnapshot}</div>
                    </TableCell>
                    <TableCell className="text-sm" dir="ltr">
                      {new Date(b.scheduledStartAt).toLocaleString()}
                    </TableCell>
                    <TableCell dir="ltr">
                      {b.totalAmount} {b.currency}
                    </TableCell>
                    <TableCell>
                      <Badge variant={BOOKING_TONE[b.status] ?? 'outline'}>{t(`status.${b.status}` as 'status.CONFIRMED')}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`paymentStatus.${b.paymentStatus}` as 'paymentStatus.UNPAID')}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
