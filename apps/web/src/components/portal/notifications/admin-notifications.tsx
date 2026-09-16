'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2, Megaphone, Save } from 'lucide-react';
import type { NotificationPreviewDto, NotificationSendResultDto, NotificationTemplateDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const select = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';
const PROFILE_TYPES = ['CUSTOMER', 'OWNER', 'DRIVER', 'SPO'] as const;

/** Operations: template wording without a deploy (with preview), and template-based sends to an audience (api.md §8.26). */
export function AdminNotificationsPage() {
  const t = useTranslations('portal.notifications.admin');
  const tn = useTranslations('portal.notifications');
  const tc = useTranslations('common');
  const { can } = useSession();
  const [templates, setTemplates] = useState<NotificationTemplateDto[] | null>(null);
  const [filter, setFilter] = useState({ code: '', channel: '', locale: '' });
  const [editing, setEditing] = useState<NotificationTemplateDto | null>(null);
  const [draft, setDraft] = useState({ subject: '', body: '', isActive: true });
  const [sample, setSample] = useState('');
  const [preview, setPreview] = useState<NotificationPreviewDto | null>(null);
  const [send, setSend] = useState({ templateCode: 'OPS_ANNOUNCEMENT', variables: '{"title":"","message":""}', profileTypes: [] as string[], roleCodes: '', userIds: '', channels: ['IN_APP', 'EMAIL'] as string[], urgent: false });
  const [sent, setSent] = useState<NotificationSendResultDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<NotificationTemplateDto[]>('/notifications/templates', { query: { pageSize: 100, ...(filter.code ? { code: filter.code.toUpperCase() } : {}), ...(filter.channel ? { channel: filter.channel } : {}), ...(filter.locale ? { locale: filter.locale } : {}) } });
    if (res.ok) setTemplates(res.data);
    else setError(res.error);
  }, [filter]);
  useEffect(() => {
    if (can('notifications.templates.manage')) void load();
    else setTemplates([]);
  }, [load, can]);

  function edit(tpl: NotificationTemplateDto) {
    setEditing(tpl);
    setDraft({ subject: tpl.subject ?? '', body: tpl.body, isActive: tpl.isActive });
    setSample(JSON.stringify(Object.fromEntries(tpl.variables.map((v) => [v, `<${v}>`])), null, 0));
    setPreview(null);
  }
  function parseVars(raw: string): Record<string, string> | null {
    try {
      const o = JSON.parse(raw) as unknown;
      if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
    } catch {
      return null;
    }
  }
  async function runPreview() {
    if (!editing) return;
    const variables = parseVars(sample);
    if (!variables) return;
    // Preview the saved version; unsaved edits are previewed after save (the API renders the stored row).
    const res = await api<NotificationPreviewDto>(`/notifications/templates/${editing.id}/preview`, { method: 'POST', body: { variables } });
    if (res.ok) setPreview(res.data);
    else setError(res.error);
  }
  async function save(e: SyntheticEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    const res = await api<NotificationTemplateDto>(`/notifications/templates/${editing.id}`, { method: 'PATCH', body: { subject: draft.subject || null, body: draft.body, isActive: draft.isActive } });
    setBusy(false);
    if (res.ok) {
      setEditing(res.data);
      await load();
      await runPreview();
    } else setError(res.error);
  }
  async function submitSend(e: SyntheticEvent) {
    e.preventDefault();
    const variables = parseVars(send.variables);
    if (!variables) {
      setError({ status: 422, code: 'VALIDATION_FAILED', message: 'variables must be a JSON object' });
      return;
    }
    setBusy(true);
    setError(null);
    setSent(null);
    const audience = {
      ...(send.profileTypes.length ? { profileTypes: send.profileTypes } : {}),
      ...(send.roleCodes.trim() ? { roleCodes: send.roleCodes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) } : {}),
      ...(send.userIds.trim() ? { userIds: send.userIds.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    };
    const res = await api<NotificationSendResultDto>('/notifications/send', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: { templateCode: send.templateCode.toUpperCase(), variables, audience, channels: send.channels, urgent: send.urgent } });
    setBusy(false);
    if (res.ok) setSent(res.data);
    else setError(res.error);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}{error.details && 'missing' in error.details ? ` — ${(error.details as { missing: string[] }).missing.join(', ')}` : ''}</AlertDescription></Alert>
      )}

      {can('notifications.send') && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('send.title')}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => void submitSend(e)}>
              <div className="space-y-1">
                <Label htmlFor="sn-code">{t('send.template')}</Label>
                <Input id="sn-code" dir="ltr" value={send.templateCode} onChange={(e) => { setSend({ ...send, templateCode: e.target.value }); }} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="sn-vars">{t('send.variables')}</Label>
                <Input id="sn-vars" dir="ltr" value={send.variables} onChange={(e) => { setSend({ ...send, variables: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label>{t('send.profileTypes')}</Label>
                <div className="flex flex-wrap gap-3 text-sm">
                  {PROFILE_TYPES.map((p) => (
                    <label key={p} className="flex items-center gap-1"><input type="checkbox" checked={send.profileTypes.includes(p)} onChange={(e) => { setSend({ ...send, profileTypes: e.target.checked ? [...send.profileTypes, p] : send.profileTypes.filter((x) => x !== p) }); }} />{t(`send.profile.${p}`)}</label>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sn-roles">{t('send.roleCodes')}</Label>
                <Input id="sn-roles" dir="ltr" placeholder="OPS_MANAGER, SUPPORT_AGENT" value={send.roleCodes} onChange={(e) => { setSend({ ...send, roleCodes: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sn-users">{t('send.userIds')}</Label>
                <Input id="sn-users" dir="ltr" value={send.userIds} onChange={(e) => { setSend({ ...send, userIds: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label>{t('send.channels')}</Label>
                <div className="flex flex-wrap gap-3 text-sm">
                  {(['IN_APP', 'EMAIL', 'SMS', 'PUSH'] as const).map((c) => (
                    <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={send.channels.includes(c)} onChange={(e) => { setSend({ ...send, channels: e.target.checked ? [...send.channels, c] : send.channels.filter((x) => x !== c) }); }} />{tn(`channels.${c}`)}</label>
                  ))}
                </div>
              </div>
              <div className="flex items-end gap-3 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={send.urgent} onChange={(e) => { setSend({ ...send, urgent: e.target.checked }); }} />{t('send.urgent')}</label>
                <Button type="submit" disabled={busy || !send.templateCode || send.channels.length === 0}>{busy ? <Loader2 className="animate-spin" /> : <Megaphone className="size-4" />}{t('send.submit')}</Button>
              </div>
            </form>
            {sent && <p className="mt-3 text-sm text-muted-foreground">{t('send.result', { recipients: sent.recipients, queued: sent.queued, suppressed: sent.suppressed })}</p>}
          </CardContent>
        </Card>
      )}

      {can('notifications.templates.manage') && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('templates.title')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input dir="ltr" placeholder={t('templates.code')} value={filter.code} onChange={(e) => { setFilter({ ...filter, code: e.target.value }); }} />
              <select className={select} value={filter.channel} onChange={(e) => { setFilter({ ...filter, channel: e.target.value }); }}>
                <option value="">{t('templates.anyChannel')}</option>
                {(['IN_APP', 'EMAIL', 'SMS', 'PUSH'] as const).map((c) => <option key={c} value={c}>{tn(`channels.${c}`)}</option>)}
              </select>
              <select className={select} value={filter.locale} onChange={(e) => { setFilter({ ...filter, locale: e.target.value }); }}>
                <option value="">{t('templates.anyLocale')}</option>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('templates.code')}</TableHead>
                  <TableHead>{t('templates.channel')}</TableHead>
                  <TableHead>{t('templates.locale')}</TableHead>
                  <TableHead>{t('templates.subject')}</TableHead>
                  <TableHead>{t('templates.version')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates === null ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
                ) : templates.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('templates.empty')}</TableCell></TableRow>
                ) : (
                  templates.map((tpl) => (
                    <TableRow key={tpl.id} className={editing?.id === tpl.id ? 'bg-muted/40' : ''}>
                      <TableCell dir="ltr" className="font-mono text-xs">{tpl.code}</TableCell>
                      <TableCell><Badge variant="outline">{tn(`channels.${tpl.channel}`)}</Badge></TableCell>
                      <TableCell dir="ltr">{tpl.locale}</TableCell>
                      <TableCell className="max-w-md truncate text-sm">{tpl.subject ?? '—'}{!tpl.isActive && <span className="ms-2 text-xs text-muted-foreground">{t('templates.inactive')}</span>}</TableCell>
                      <TableCell dir="ltr">v{tpl.version}</TableCell>
                      <TableCell className="text-end"><Button variant="ghost" size="sm" onClick={() => { edit(tpl); }}>{t('templates.edit')}</Button></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {editing && (
        <Card className="border-primary/40">
          <CardHeader><CardTitle className="text-base">{t('editor.title', { code: editing.code, channel: editing.channel, locale: editing.locale })}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 lg:grid-cols-2" onSubmit={(e) => void save(e)}>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="te-subject">{t('templates.subject')}</Label>
                  <Input id="te-subject" dir={editing.locale === 'ar' ? 'rtl' : 'ltr'} value={draft.subject} onChange={(e) => { setDraft({ ...draft, subject: e.target.value }); }} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="te-body">{t('editor.body')}</Label>
                  <textarea id="te-body" dir={editing.locale === 'ar' ? 'rtl' : 'ltr'} rows={6} className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm" value={draft.body} onChange={(e) => { setDraft({ ...draft, body: e.target.value }); }} />
                  <p className="text-xs text-muted-foreground">{t('editor.variablesHint', { vars: editing.variables.map((v) => `{{${v}}}`).join(' ') || '—' })}</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={(e) => { setDraft({ ...draft, isActive: e.target.checked }); }} />{t('editor.active')}</label>
                  <Button type="submit" disabled={busy || !draft.body}>{busy ? <Loader2 className="animate-spin" /> : <Save className="size-4" />}{t('editor.save')}</Button>
                  <Button type="button" variant="ghost" onClick={() => { setEditing(null); }}>{tc('cancel')}</Button>
                </div>
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="te-sample">{t('editor.sample')}</Label>
                  <Input id="te-sample" dir="ltr" value={sample} onChange={(e) => { setSample(e.target.value); }} />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void runPreview()}>{t('editor.preview')}</Button>
                {preview && (
                  <div className="rounded-md border p-3 text-sm" dir={preview.locale === 'ar' ? 'rtl' : 'ltr'}>
                    {preview.subject && <div className="font-medium">{preview.subject}</div>}
                    <div className="whitespace-pre-wrap text-muted-foreground">{preview.body}</div>
                    {preview.missingVariables.length > 0 && <div className="mt-2 text-xs text-destructive">{t('editor.missing', { vars: preview.missingVariables.join(', ') })}</div>}
                  </div>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
