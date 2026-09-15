'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2, Lock, Plus, Save, Trash2 } from 'lucide-react';
import type { PermissionDto, RoleDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { StepUpDialog } from '@/components/auth/step-up-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Role editor (api.md §8.29, BRIEF-§5): roles are rows; a new role with a chosen permission subset is an admin action, not a deployment. System roles are read-only. */
export function AdminRolesPage() {
  const t = useTranslations('portal.adminRoles');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useSession();
  const [roles, setRoles] = useState<RoleDto[] | null>(null);
  const [permissions, setPermissions] = useState<PermissionDto[]>([]);
  const [editing, setEditing] = useState<RoleDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ code: '', nameEn: '', nameAr: '', description: '', permissionCodes: [] as string[] });
  const [action, setAction] = useState<null | { kind: 'save' | 'delete' }>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api<RoleDto[]>('/roles'), api<PermissionDto[]>('/permissions')]);
    if (a.ok) setRoles(a.data);
    else setError(a.error);
    if (b.ok) setPermissions(b.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function open(r: RoleDto | null) {
    setCreating(r === null);
    setEditing(r);
    setDraft(r ? { code: r.code, nameEn: r.nameEn, nameAr: r.nameAr, description: r.description ?? '', permissionCodes: [...r.permissionCodes] } : { code: '', nameEn: '', nameAr: '', description: '', permissionCodes: [] });
  }
  function toggle(code: string) {
    setDraft((d) => ({ ...d, permissionCodes: d.permissionCodes.includes(code) ? d.permissionCodes.filter((c) => c !== code) : [...d.permissionCodes, code] }));
  }
  async function persist(stepUpToken: string, kind: 'save' | 'delete') {
    setBusy(true);
    setError(null);
    const headers = { 'X-Step-Up-Token': stepUpToken };
    const body = { nameEn: draft.nameEn, nameAr: draft.nameAr, ...(draft.description ? { description: draft.description } : {}), permissionCodes: draft.permissionCodes };
    const res = kind === 'delete' && editing
      ? await api(`/roles/${editing.code}`, { method: 'DELETE', headers })
      : creating
        ? await api<RoleDto>('/roles', { method: 'POST', body: { code: draft.code.toUpperCase(), ...body }, headers })
        : await api<RoleDto>(`/roles/${editing?.code ?? ''}`, { method: 'PATCH', body, headers });
    setBusy(false);
    if (res.ok) {
      setEditing(null);
      setCreating(false);
      await load();
    } else setError(res.error);
  }
  const modules = [...new Set(permissions.map((p) => p.module))];
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    setAction({ kind: 'save' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {can('roles.manage') && <Button onClick={() => { open(null); }}><Plus className="size-4" />{t('create')}</Button>}
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      <Card>
        <CardContent className="divide-y p-0">
          {roles === null ? (
            <div className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></div>
          ) : (
            roles.map((r) => (
              <div key={r.code} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <div className="flex items-center gap-2"><span className="font-mono text-xs" dir="ltr">{r.code}</span>{r.isSystem && <Badge variant="secondary"><Lock className="me-1 size-3" />{t('system')}</Badge>}</div>
                  <div className="text-sm">{locale === 'ar' ? r.nameAr : r.nameEn}{r.description ? ` — ${r.description}` : ''}</div>
                  <div className="text-xs text-muted-foreground">{t('grants', { n: r.permissionCodes.length })}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => { open(r); }}>{r.isSystem ? t('view') : can('roles.manage') ? t('edit') : t('view')}</Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {(editing ?? creating) && (
        <Card className="border-primary/40">
          <CardHeader><CardTitle className="text-base">{creating ? t('create') : editing?.code}</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="grid gap-3 sm:grid-cols-3">
                {creating && <div className="space-y-1"><Label htmlFor="rl-code">{t('code')}</Label><Input id="rl-code" dir="ltr" required value={draft.code} onChange={(e) => { setDraft({ ...draft, code: e.target.value.toUpperCase() }); }} /></div>}
                <div className="space-y-1"><Label htmlFor="rl-en">{t('nameEn')}</Label><Input id="rl-en" required disabled={editing?.isSystem} value={draft.nameEn} onChange={(e) => { setDraft({ ...draft, nameEn: e.target.value }); }} /></div>
                <div className="space-y-1"><Label htmlFor="rl-ar">{t('nameAr')}</Label><Input id="rl-ar" dir="rtl" required disabled={editing?.isSystem} value={draft.nameAr} onChange={(e) => { setDraft({ ...draft, nameAr: e.target.value }); }} /></div>
                <div className="space-y-1 sm:col-span-3"><Label htmlFor="rl-desc">{t('description')}</Label><Input id="rl-desc" disabled={editing?.isSystem} value={draft.description} onChange={(e) => { setDraft({ ...draft, description: e.target.value }); }} /></div>
              </div>
              <div className="space-y-3">
                {modules.map((m) => (
                  <div key={m}>
                    <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">{m}</div>
                    <div className="flex flex-wrap gap-2">
                      {permissions.filter((p) => p.module === m).map((p) => (
                        <label key={p.code} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${draft.permissionCodes.includes(p.code) ? 'bg-primary/10 border-primary/40' : ''}`} title={locale === 'ar' ? p.descriptionAr : p.descriptionEn}>
                          <input type="checkbox" disabled={editing?.isSystem === true || !p.isAssignable} checked={draft.permissionCodes.includes(p.code)} onChange={() => { toggle(p.code); }} />
                          <span dir="ltr">{p.code}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {!editing?.isSystem && can('roles.manage') && <Button type="submit" disabled={busy || !draft.nameEn || !draft.nameAr || (creating && !draft.code)}>{busy ? <Loader2 className="animate-spin" /> : <Save className="size-4" />}{t('save')}</Button>}
                {editing && !editing.isSystem && can('roles.manage') && <Button type="button" variant="destructive" disabled={busy} onClick={() => { setAction({ kind: 'delete' }); }}><Trash2 className="size-4" />{t('delete')}</Button>}
                <Button type="button" variant="ghost" onClick={() => { setEditing(null); setCreating(false); }}>{tc('cancel')}</Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('stepUpHint')}</p>
            </form>
          </CardContent>
        </Card>
      )}
      {action && <StepUpDialog actionClass="ROLE_CHANGE" onVerified={(token) => { const k = action.kind; setAction(null); void persist(token, k); }} onClose={() => { setAction(null); }} />}
    </div>
  );
}
