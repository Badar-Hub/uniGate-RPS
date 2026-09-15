'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { UserPermissionsDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StepUpDialog } from '@/components/auth/step-up-dialog';

const ACTIONS = ['read', 'create', 'update', 'delete'] as const;

/**
 * Per-vendor access matrix (module × read/create/update/delete, plus the module's other codes):
 * ticks are the effective set; a change becomes a GRANT (on top of the role) or a DENY (taken from
 * the role). Saving is step-up protected like a role change and takes effect on the vendor's next request.
 */
export function VendorAccess({ userId }: { userId: string }) {
  const t = useTranslations('portal.vendors.access');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [data, setData] = useState<UserPermissionsDto | null>(null);
  const [effective, setEffective] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const res = await api<UserPermissionsDto>(`/users/${userId}/permissions`);
    if (res.ok) {
      setData(res.data);
      setEffective(new Set(res.data.effective));
    } else setError(res.error);
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);

  const modules = useMemo(() => {
    const m = new Map<string, UserPermissionsDto['catalogue']>();
    for (const p of data?.catalogue ?? []) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [data]);

  function toggle(code: string) {
    setEffective((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
    setSaved(false);
  }
  const diff = useMemo(() => {
    if (!data) return { grant: [] as string[], deny: [] as string[] };
    const roles = new Set(data.fromRoles);
    return { grant: [...effective].filter((c) => !roles.has(c)).sort(), deny: data.fromRoles.filter((c) => !effective.has(c)).sort() };
  }, [data, effective]);

  async function save(stepUpToken: string) {
    setBusy(true);
    setError(null);
    const res = await api<UserPermissionsDto>(`/users/${userId}/permissions`, { method: 'PUT', body: { grant: diff.grant, deny: diff.deny, ...(note.trim() ? { note: note.trim() } : {}) }, headers: { 'X-Step-Up-Token': stepUpToken } });
    setBusy(false);
    if (res.ok) {
      setData(res.data);
      setEffective(new Set(res.data.effective));
      setSaved(true);
    } else setError(res.error);
  }

  if (!data) {
    return error ? (
      <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
    ) : (
      <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tc('loading')}</div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle', { roles: data.roles.join(', ') })}</p>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-start">
                <th className="px-4 py-2 text-start font-medium">{t('module')}</th>
                {ACTIONS.map((a) => <th key={a} className="px-3 py-2 text-center font-medium">{t(`actions.${a}`)}</th>)}
                <th className="px-3 py-2 text-start font-medium">{t('other')}</th>
              </tr>
            </thead>
            <tbody>
              {modules.map(([module, perms]) => {
                const byAction = new Map(perms.map((p) => [p.action, p]));
                const others = perms.filter((p) => !(ACTIONS as readonly string[]).includes(p.action));
                return (
                  <tr key={module} className="border-b align-top">
                    <td className="px-4 py-2 font-medium">{module}</td>
                    {ACTIONS.map((a) => {
                      const p = byAction.get(a);
                      return (
                        <td key={a} className="px-3 py-2 text-center">
                          {p ? <input type="checkbox" aria-label={`${module} ${a}`} checked={effective.has(p.code)} onChange={() => { toggle(p.code); }} title={locale === 'ar' ? p.descriptionAr : p.descriptionEn} /> : <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {others.map((p) => (
                          <label key={p.code} className="flex items-center gap-1 text-xs" title={locale === 'ar' ? p.descriptionAr : p.descriptionEn}>
                            <input type="checkbox" checked={effective.has(p.code)} onChange={() => { toggle(p.code); }} />
                            <span dir="ltr">{p.action}</span>
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('changes')}</CardTitle>
          <CardDescription>{t('changesHint', { grant: diff.grant.length, deny: diff.deny.length })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {diff.grant.length > 0 && <p className="text-sm" dir="ltr"><span className="font-medium">+ </span>{diff.grant.join(', ')}</p>}
          {diff.deny.length > 0 && <p className="text-sm" dir="ltr"><span className="font-medium">− </span>{diff.deny.join(', ')}</p>}
          <div className="space-y-1">
            <Label htmlFor="acc-note">{t('note')}</Label>
            <Input id="acc-note" value={note} onChange={(e) => { setNote(e.target.value); }} />
          </div>
          <div className="flex items-center gap-3">
            <Button disabled={busy} onClick={() => { setStepUp(true); }}>
              {busy && <Loader2 className="animate-spin" />}
              {t('save')}
            </Button>
            {saved && <span className="text-sm text-muted-foreground">{t('saved')}</span>}
          </div>
        </CardContent>
      </Card>
      {stepUp && <StepUpDialog actionClass="ROLE_CHANGE" onVerified={(token) => { setStepUp(false); void save(token); }} onClose={() => { setStepUp(false); }} />}
    </div>
  );
}
