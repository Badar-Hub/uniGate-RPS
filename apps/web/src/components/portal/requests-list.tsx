'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2, Plus } from 'lucide-react';
import type { TripRequestDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const REQUEST_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'outline', PUBLISHED: 'secondary', PARTIALLY_AWARDED: 'secondary', FULLY_AWARDED: 'default', CLOSED_PARTIAL: 'outline', COMPLETED: 'default', CANCELLED: 'destructive', EXPIRED: 'destructive',
};

/** The customer's requests (staff with trip_requests.read_any see all). */
export function RequestsList() {
  const t = useTranslations('portal.requests');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [rows, setRows] = useState<TripRequestDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    void api<TripRequestDto[]>('/trip-requests', { query: { pageSize: 100 } }).then((res) => {
      if (res.ok) setRows(res.data);
      else setError(res.error);
    });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/requests/new">
            <Plus />
            {t('newRequest')}
          </Link>
        </Button>
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
                <TableHead>{t('route')}</TableHead>
                <TableHead>{t('pickup')}</TableHead>
                <TableHead>{t('vehicles')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('bidding')}</TableHead>
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
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/requests/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline" dir="ltr">
                        {r.requestNumber}
                      </Link>
                      <div className="text-xs text-muted-foreground">{r.vehicleCategory ? (locale === 'ar' ? r.vehicleCategory.nameAr : r.vehicleCategory.nameEn) : ''}</div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm">
                      {r.pickup.addressLine} → {r.dropoff.addressLine}
                    </TableCell>
                    <TableCell className="text-sm" dir="ltr">
                      {new Date(r.pickupAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {r.vehiclesAwarded}/{r.vehiclesRequired}
                    </TableCell>
                    <TableCell>
                      <Badge variant={REQUEST_TONE[r.status] ?? 'outline'}>{t(`status.${r.status}` as 'status.DRAFT')}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.biddingOpen ? 'default' : 'outline'}>{r.biddingOpen ? t('open') : t('closed')}</Badge>
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
