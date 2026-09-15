'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2, Plus } from 'lucide-react';
import type { VehicleDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const APPROVAL_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = { DRAFT: 'outline', PENDING_APPROVAL: 'secondary', APPROVED: 'default', REJECTED: 'destructive' };

/** The owner's fleet (or, for staff, every vehicle). */
export function FleetList() {
  const t = useTranslations('portal.fleet');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [rows, setRows] = useState<VehicleDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    void api<VehicleDto[]>('/vehicles', { query: { pageSize: 100 } }).then((res) => {
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
          <Link href="/fleet/new">
            <Plus />
            {t('register')}
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
                <TableHead>{t('plate')}</TableHead>
                <TableHead>{t('category')}</TableHead>
                <TableHead>{t('year')}</TableHead>
                <TableHead>{t('approval')}</TableHead>
                <TableHead>{t('lifecycle')}</TableHead>
                <TableHead>{t('dispatchable')}</TableHead>
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
                rows.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <Link href={`/fleet/${v.id}`} className="font-medium text-primary underline-offset-4 hover:underline" dir="ltr">
                        {v.plateNumberEn}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[v.make?.name, v.model?.name].filter(Boolean).join(' ')}
                      </div>
                    </TableCell>
                    <TableCell>{locale === 'ar' ? v.category.nameAr : v.category.nameEn}</TableCell>
                    <TableCell>{v.modelYear}</TableCell>
                    <TableCell>
                      <Badge variant={APPROVAL_TONE[v.approvalStatus] ?? 'outline'}>{t(`status.${v.approvalStatus}` as 'status.DRAFT')}</Badge>
                    </TableCell>
                    <TableCell>{t(`status.${v.lifecycleStatus}` as 'status.ACTIVE')}</TableCell>
                    <TableCell>
                      <Badge variant={v.dispatchable.ok ? 'default' : 'outline'}>{v.dispatchable.ok ? t('dispatchable') : t('notDispatchable')}</Badge>
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
