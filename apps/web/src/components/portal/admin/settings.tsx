'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2, Lock, Save } from 'lucide-react';
import type { SettingDto, SettingsSectionDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { StepUpDialog } from '@/components/auth/step-up-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * Settings (api.md §8.31, ADR-009): the thirteen sections, every PUBLIC/INTERNAL key with its
 * type and description, inline edit → PUT /settings/{key}. SECRET keys never reach this screen;
 * code-managed keys are shown locked. Values are typed by valueType: booleans toggle, numbers
 * parse, arrays and JSON are edited as JSON text.
 */
export function AdminSettingsPage() {
  const t = useTranslations('portal.adminSettings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useSession();
  const [sections, setSections] = useState<SettingsSectionDto[]>([]);
  const [section, setSection] = useState('');
  const [rows, setRows] = useState<SettingDto[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<SettingDto | null>(null);

  useEffect(() => {
    void api<SettingsSectionDto[]>('/settings/sections').then((res) => {
      if (res.ok) {
        setSections(res.data);
        setSection((s) => s || (res.data[0]?.section ?? ''));
      } else setError(res.error);
    });
  }, []);
  const load = useCallback(async () => {
    if (!section) return;
    const res = await api<SettingDto[]>('/settings', { query: { section } });
    if (res.ok) {
      setRows(res.data);
      setDrafts(Object.fromEntries(res.data.map((s) => [s.key, render(s)])));
    } else setError(res.error);
  }, [section]);
  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  function render(s: SettingDto): string {
    if (s.valueType === 'BOOLEAN') return s.value ? 'true' : 'false';
    if (typeof s.value === 'string') return s.value;
    return JSON.stringify(s.value);
  }
  function parse(s: SettingDto, raw: string): unknown {
    switch (s.valueType) {
      case 'BOOLEAN':
        return raw === 'true';
      case 'INTEGER':
        return Number.parseInt(raw, 10);
      case 'DECIMAL':
        return Number(raw);
      case 'STRING':
      case 'ENUM':
        return raw;
      default:
        return JSON.parse(raw) as unknown;
    }
  }
  async function save(s: SettingDto, stepUpToken: string) {
    let value: unknown;
    try {
      value = parse(s, drafts[s.key] ?? '');
    } catch {
      setError({ status: 422, code: 'VALIDATION_FAILED', message: 'invalid JSON' });
      return;
    }
    setBusy(s.key);
    setError(null);
    setSaved(null);
    const res = await api<SettingDto>(`/settings/${s.key}`, { method: 'PUT', body: { value }, headers: { 'X-Step-Up-Token': stepUpToken } });
    setBusy(null);
    if (res.ok) {
      setSaved(s.key);
      await load();
    } else setError(res.error);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      {saved && (
        <Alert><CheckCircle2 className="size-4" /><AlertDescription>{t('saved', { key: saved })}</AlertDescription></Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {sections.map((s) => (
          <Button key={s.section} variant={s.section === section ? 'default' : 'outline'} size="sm" onClick={() => { setSection(s.section); }}>
            {s.section} <Badge variant="secondary" className="ms-1">{s.keyCount}</Badge>
          </Button>
        ))}
      </div>
      <Card>
        <CardContent className="divide-y p-0">
          {rows === null ? (
            <div className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></div>
          ) : (
            rows.map((s) => {
              const dirty = (drafts[s.key] ?? '') !== render(s);
              const editable = can('settings.manage') && !s.isCodeManaged;
              return (
                <div key={s.key} className="grid gap-2 p-4 md:grid-cols-[1fr_minmax(16rem,20rem)_auto]">
                  <div>
                    <div className="font-mono text-xs" dir="ltr">{s.key}</div>
                    <div className="text-sm">{locale === 'ar' ? s.descriptionAr : s.descriptionEn}</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                      <Badge variant="outline">{s.valueType}</Badge>
                      <Badge variant="outline">{s.scope}</Badge>
                      {s.isCodeManaged && <Badge variant="secondary"><Lock className="me-1 size-3" />{t('codeManaged')}</Badge>}
                    </div>
                  </div>
                  <div>
                    {s.valueType === 'BOOLEAN' ? (
                      <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={drafts[s.key] ?? 'false'} disabled={!editable} onChange={(e) => { setDrafts({ ...drafts, [s.key]: e.target.value }); }}>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <Input dir="ltr" className="font-mono text-xs" value={drafts[s.key] ?? ''} disabled={!editable} onChange={(e) => { setDrafts({ ...drafts, [s.key]: e.target.value }); }} />
                    )}
                  </div>
                  <div className="flex items-start">
                    {editable && <Button size="sm" disabled={!dirty || busy === s.key} onClick={() => { setPending(s); }}>{busy === s.key ? <Loader2 className="animate-spin" /> : <Save className="size-4" />}{t('save')}</Button>}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
      {pending && <StepUpDialog actionClass="SETTINGS" onVerified={(token) => { const s = pending; setPending(null); void save(s, token); }} onClose={() => { setPending(null); }} />}
    </div>
  );
}
