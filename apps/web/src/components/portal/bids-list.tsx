'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { BidDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const BID_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = { SUBMITTED: 'secondary', ACCEPTED: 'default', WITHDRAWN: 'outline', REJECTED: 'destructive', EXPIRED: 'outline' };

/** The owner's bids (staff with bids.read_any see all). */
export function BidsList() {
  const t = useTranslations('portal.bids');
  const tc = useTranslations('common');
  const { me } = useSession();
  const [rows, setRows] = useState<BidDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<BidDto[]>('/bids', { query: { pageSize: 100 } });
    if (res.ok) setRows(res.data);
    else setError(res.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function withdraw(b: BidDto) {
    setError(null);
    const res = await api<BidDto>(`/bids/${b.id}/withdraw`, { method: 'POST', body: {} });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(t('form.withdrawn'));
    await load();
  }

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
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('number')}</TableHead>
                <TableHead>{t('request')}</TableHead>
                <TableHead>{t('vehicle')}</TableHead>
                <TableHead>{t('total')}</TableHead>
                <TableHead>{t('validUntil')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="inline size-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell dir="ltr">
                      <span className="font-medium">{b.bidNumber}</span>
                      <div className="text-xs text-muted-foreground">{t('version', { n: b.version })}</div>
                    </TableCell>
                    <TableCell dir="ltr">
                      <Link href={`/requests/${b.tripRequestId}`} className="text-primary underline-offset-4 hover:underline">
                        {b.requestNumber}
                      </Link>
                    </TableCell>
                    <TableCell dir="ltr">
                      {b.vehicle.plateNumberEn}
                      <div className="text-xs text-muted-foreground">{b.vehicle.description}</div>
                    </TableCell>
                    <TableCell dir="ltr">
                      {b.totalAmount} {b.currency}
                      {b.effectiveCommission && b.effectiveCommission.type !== 'NONE' && (
                        <div className="text-xs text-muted-foreground">
                          −{b.effectiveCommission.type === 'PERCENTAGE' ? `${b.effectiveCommission.value ?? ''}%` : b.effectiveCommission.value}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm" dir="ltr">
                      {new Date(b.validUntil).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={BID_TONE[b.status] ?? 'outline'}>{t(`status.${b.status}` as 'status.SUBMITTED')}</Badge>
                    </TableCell>
                    <TableCell>
                      {b.status === 'SUBMITTED' && b.ownerProfileId === me?.profiles.owner?.id && (
                        <Button size="sm" variant="ghost" onClick={() => void withdraw(b)}>
                          {t('form.withdraw')}
                        </Button>
                      )}
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
