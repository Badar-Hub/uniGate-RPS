'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2, MessageSquare, UserCheck } from 'lucide-react';
import type { BookingDto, ComplaintDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
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
const AGAINST = ['DRIVER', 'OWNER', 'CUSTOMER', 'VEHICLE', 'PLATFORM'] as const;
const SEVERITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const STATUSES = ['OPEN', 'IN_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'REJECTED', 'CLOSED'] as const;
const NEXT: Record<string, string[]> = { OPEN: ['IN_REVIEW', 'REJECTED'], IN_REVIEW: ['AWAITING_RESPONSE', 'RESOLVED', 'REJECTED'], AWAITING_RESPONSE: ['IN_REVIEW', 'RESOLVED', 'REJECTED'], RESOLVED: ['CLOSED', 'IN_REVIEW'], REJECTED: ['CLOSED', 'IN_REVIEW'], CLOSED: [] };
const tone = (s: string): 'default' | 'secondary' | 'destructive' | 'outline' => (s === 'RESOLVED' || s === 'CLOSED' ? 'default' : s === 'REJECTED' ? 'destructive' : s === 'OPEN' ? 'outline' : 'secondary');
const fmt = (locale: string, iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');

/**
 * Complaints (api.md §8.25). Raisers: their own list, a raise form, the thread. Managers
 * (complaints.manage): the queue with SLA flags, assign-to-me, status transitions with a
 * resolution, internal notes the raiser never sees.
 */
export function ComplaintsPage() {
  const t = useTranslations('portal.engagement.complaints');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { me, can } = useSession();
  const manager = can('complaints.manage');
  const [rows, setRows] = useState<ComplaintDto[] | null>(null);
  const [filter, setFilter] = useState({ status: '', severity: '', overdueOnly: false });
  const [categories, setCategories] = useState<string[]>([]);
  const [bookings, setBookings] = useState<BookingDto[]>([]);
  const [open, setOpen] = useState<ComplaintDto | null>(null);
  const [form, setForm] = useState({ againstType: 'DRIVER' as (typeof AGAINST)[number], category: '', subject: '', description: '', bookingId: '', severity: 'MEDIUM' as (typeof SEVERITY)[number] });
  const [note, setNote] = useState({ body: '', isInternal: false });
  const [transition, setTransition] = useState({ status: '', resolution: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<ComplaintDto[]>('/complaints', { query: { pageSize: 100, ...(filter.status ? { status: filter.status } : {}), ...(filter.severity ? { severity: filter.severity } : {}), ...(filter.overdueOnly ? { overdueOnly: true } : {}) } });
    if (res.ok) {
      setRows(res.data);
      setOpen((o) => (o ? (res.data.find((c) => c.id === o.id) ?? o) : o));
    } else setError(res.error);
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void api<{ key: string; value: unknown }[]>('/settings/public').then((res) => {
      if (!res.ok) return;
      const v = res.data.find((s) => s.key === 'platform.complaint_categories')?.value;
      if (Array.isArray(v)) {
        setCategories(v.filter((x): x is string => typeof x === 'string'));
        setForm((f) => ({ ...f, category: f.category || (typeof v[0] === 'string' ? v[0] : '') }));
      }
    });
    if (can('complaints.create')) {
      void api<BookingDto[]>('/bookings', { query: { pageSize: 50 } }).then((res) => {
        if (res.ok) setBookings(res.data);
      });
    }
  }, [can]);

  async function run(fn: () => Promise<{ ok: boolean; error?: ApiError }>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok && res.error) setError(res.error);
    await load();
    return res.ok;
  }
  async function raise(e: SyntheticEvent) {
    e.preventDefault();
    const ok = await run(() => api<ComplaintDto>('/complaints', { method: 'POST', body: { againstType: form.againstType, category: form.category, subject: form.subject, description: form.description, severity: form.severity, ...(form.bookingId ? { bookingId: form.bookingId } : {}) } }));
    if (ok) setForm((f) => ({ ...f, subject: '', description: '', bookingId: '' }));
  }
  async function addNote(e: SyntheticEvent) {
    e.preventDefault();
    if (!open || !note.body) return;
    const ok = await run(() => api<ComplaintDto>(`/complaints/${open.id}/notes`, { method: 'POST', body: { body: note.body, isInternal: manager && note.isInternal } }));
    if (ok) setNote({ body: '', isInternal: false });
  }
  async function move(e: SyntheticEvent) {
    e.preventDefault();
    if (!open || !transition.status) return;
    const ok = await run(() => api<ComplaintDto>(`/complaints/${open.id}/status`, { method: 'POST', body: { status: transition.status, ...(transition.resolution ? { resolution: transition.resolution } : {}) } }));
    if (ok) setTransition({ status: '', resolution: '' });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{manager ? t('queueTitle') : t('title')}</h1>
        <p className="text-sm text-muted-foreground">{manager ? t('queueSubtitle') : t('subtitle')}</p>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}

      {can('complaints.create') && !manager && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('raise')}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => void raise(e)}>
              <div className="space-y-1">
                <Label htmlFor="cp-against">{t('against')}</Label>
                <select id="cp-against" className={select} value={form.againstType} onChange={(e) => { setForm({ ...form, againstType: e.target.value as (typeof AGAINST)[number] }); }}>
                  {AGAINST.map((a) => <option key={a} value={a}>{t(`againstTypes.${a}`)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cp-cat">{t('category')}</Label>
                <select id="cp-cat" className={select} value={form.category} onChange={(e) => { setForm({ ...form, category: e.target.value }); }}>
                  {categories.map((c) => <option key={c} value={c}>{t.has(`categories.${c}`) ? t(`categories.${c}`) : c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cp-booking">{t('booking')}</Label>
                <select id="cp-booking" className={select} value={form.bookingId} onChange={(e) => { setForm({ ...form, bookingId: e.target.value }); }}>
                  <option value="">—</option>
                  {bookings.map((b) => <option key={b.id} value={b.id}>{b.bookingNumber}</option>)}
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="cp-subject">{t('subject')}</Label>
                <Input id="cp-subject" required value={form.subject} onChange={(e) => { setForm({ ...form, subject: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cp-sev">{t('severity')}</Label>
                <select id="cp-sev" className={select} value={form.severity} onChange={(e) => { setForm({ ...form, severity: e.target.value as (typeof SEVERITY)[number] }); }}>
                  {SEVERITY.map((s) => <option key={s} value={s}>{t(`severities.${s}`)}</option>)}
                </select>
              </div>
              <div className="space-y-1 sm:col-span-3">
                <Label htmlFor="cp-desc">{t('description')}</Label>
                <textarea id="cp-desc" rows={4} required className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm" value={form.description} onChange={(e) => { setForm({ ...form, description: e.target.value }); }} />
              </div>
              <div><Button type="submit" disabled={busy || !form.category || form.subject.length < 3 || form.description.length < 10}>{busy ? <Loader2 className="animate-spin" /> : <MessageSquare className="size-4" />}{t('submit')}</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      {manager && (
        <div className="flex flex-wrap items-center gap-2">
          <select className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={filter.status} onChange={(e) => { setFilter({ ...filter, status: e.target.value }); }}>
            <option value="">{t('anyStatus')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
          </select>
          <select className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={filter.severity} onChange={(e) => { setFilter({ ...filter, severity: e.target.value }); }}>
            <option value="">{t('anySeverity')}</option>
            {SEVERITY.map((s) => <option key={s} value={s}>{t(`severities.${s}`)}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filter.overdueOnly} onChange={(e) => { setFilter({ ...filter, overdueOnly: e.target.checked }); }} />{t('overdueOnly')}</label>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('number')}</TableHead>
                <TableHead>{t('subject')}</TableHead>
                <TableHead>{t('severity')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                {manager && <TableHead>{t('assignee')}</TableHead>}
                <TableHead>{t('raised')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
              ) : (
                rows.map((c) => (
                  <TableRow key={c.id} className={`cursor-pointer ${open?.id === c.id ? 'bg-muted/40' : ''}`} onClick={() => { setOpen(c); setTransition({ status: '', resolution: '' }); }}>
                    <TableCell dir="ltr" className="font-mono text-xs">{c.complaintNumber}</TableCell>
                    <TableCell className="text-sm">{c.subject}<div className="text-xs text-muted-foreground">{t(`againstTypes.${c.againstType}`)} · {t.has(`categories.${c.category}`) ? t(`categories.${c.category}`) : c.category}</div></TableCell>
                    <TableCell><Badge variant={c.severity === 'CRITICAL' || c.severity === 'HIGH' ? 'destructive' : 'outline'}>{t(`severities.${c.severity}`)}</Badge></TableCell>
                    <TableCell><Badge variant={tone(c.status)}>{t(`statuses.${c.status}`)}</Badge>{c.overdue && <span className="ms-2 text-xs text-destructive">{t('overdue')}</span>}</TableCell>
                    {manager && <TableCell className="text-sm">{c.assignedToName ?? '—'}</TableCell>}
                    <TableCell className="text-sm" dir="ltr">{fmt(locale, c.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {open && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base"><span dir="ltr">{open.complaintNumber}</span> · {open.subject}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap text-sm">{open.description}</p>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>{t('raisedBy')}: {open.raisedByName}</span>
              {open.bookingNumber && <span dir="ltr">{open.bookingNumber}</span>}
              {open.respondBy && <span>{t('respondBy')}: <span dir="ltr">{fmt(locale, open.respondBy)}</span></span>}
              {open.resolution && <span className="text-foreground">{t('resolution')}: {open.resolution}</span>}
            </div>
            {manager && (
              <div className="flex flex-wrap items-end gap-3">
                {open.assignedToUserId !== me?.id && open.status !== 'CLOSED' && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => api(`/complaints/${open.id}/assign`, { method: 'POST', body: { assignedToUserId: me?.id ?? null } }))}><UserCheck className="size-4" />{t('assignToMe')}</Button>
                )}
                {(NEXT[open.status] ?? []).length > 0 && (
                  <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void move(e)}>
                    <select className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={transition.status} onChange={(e) => { setTransition({ ...transition, status: e.target.value }); }}>
                      <option value="">{t('moveTo')}</option>
                      {(NEXT[open.status] ?? []).map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
                    </select>
                    {transition.status === 'RESOLVED' && <Input className="min-w-64" placeholder={t('resolution')} value={transition.resolution} onChange={(e) => { setTransition({ ...transition, resolution: e.target.value }); }} />}
                    <Button type="submit" size="sm" disabled={busy || !transition.status || (transition.status === 'RESOLVED' && !transition.resolution && !open.resolution)}>{t('apply')}</Button>
                  </form>
                )}
              </div>
            )}
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('thread')}</div>
              {open.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noNotes')}</p>
              ) : (
                open.notes.map((n) => (
                  <div key={n.id} className={`rounded-md border p-2 text-sm ${n.isInternal ? 'border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20' : ''}`}>
                    <div className="text-xs text-muted-foreground">{n.authorName} · <span dir="ltr">{fmt(locale, n.createdAt)}</span>{n.isInternal && ` · ${t('internal')}`}</div>
                    <div className="whitespace-pre-wrap">{n.body}</div>
                  </div>
                ))
              )}
              {open.status !== 'CLOSED' && (
                <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => void addNote(e)}>
                  <Input className="min-w-64 flex-1" placeholder={t('reply')} value={note.body} onChange={(e) => { setNote({ ...note, body: e.target.value }); }} />
                  {manager && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={note.isInternal} onChange={(e) => { setNote({ ...note, isInternal: e.target.checked }); }} />{t('internal')}</label>}
                  <Button type="submit" size="sm" disabled={busy || !note.body}>{t('send')}</Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
