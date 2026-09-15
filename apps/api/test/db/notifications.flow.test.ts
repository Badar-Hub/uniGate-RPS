/**
 * Phase 13a — notifications against the real database:
 *   - a domain event fans out through the subscribers: one IN_APP row (delivered by the row) and
 *     one row per off-platform channel (QUEUED → SENT through the memory providers); the same
 *     outbox id handled twice never produces a second row (dedupe, FR-NOTIFICATIONS-05)
 *   - the inbox: cursor list, unread count by category, read / read-all / delete, SELF only
 *   - preferences: the full matrix with locked transactional categories; disabling a channel
 *     suppresses it (IN_APP still delivered); locked categories refuse (422)
 *   - delivery retries: a provider failure leaves the row QUEUED until the final attempt
 *   - templates: list, preview reporting unfilled placeholders, edit bumps the version, audited
 *   - ops send: template + audience → 202 (idempotent), unknown variables → 422, empty audience → 422
 *   - one-time links: forgot-password delivers the reset URL by email; the stored row is masked
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { MemoryChannelProviders, setChannelProvidersForTests } from '@/integrations/notifications/index.js';
import { handleDomainEvent } from '@/modules/notifications/event.subscribers.js';
import { deliver } from '@/modules/notifications/notification.service.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'notifications test passphrase 1';
interface Pref { category: string; channel: string; isEnabled: boolean; isLocked: boolean }
const prefsOf = (rows: unknown): Pref[] => rows as Pref[];
const prefOf = (rows: unknown, category: string, channel: string): Pref | undefined => prefsOf(rows).find((p) => p.category === category && p.channel === channel);
interface Tpl { id: string; channel: string; locale: string }

describeDb('notifications', () => {
  let h: Harness;
  let mem: MemoryChannelProviders;
  let admin = '';
  let owner = '';
  let customer = '';
  let ownerUserId = '';
  let ownerProfileId = '';
  let customerProfileId = '';

  beforeAll(async () => {
    h = await bootHarness();
    mem = new MemoryChannelProviders();
    setChannelProvidersForTests({ email: mem, sms: mem, push: mem });
    await createUserWithRoles('admin@notif.test', PW, ['SUPER_ADMIN']);
    ownerUserId = await createUserWithRoles('owner@notif.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    const customerUserId = await createUserWithRoles('customer@notif.test', PW, ['CUSTOMER'], 'CUSTOMER');
    ownerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ownerUserId } })).id;
    customerProfileId = (await prisma().customerProfile.findFirstOrThrow({ where: { userId: customerUserId } })).id;
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@notif.test', PW)).accessToken;
    owner = (await loginBearer(h.app, 'owner@notif.test', PW)).accessToken;
    customer = (await loginBearer(h.app, 'customer@notif.test', PW)).accessToken;
  });
  afterAll(async () => {
    setChannelProvidersForTests(null);
    await teardownHarness();
  });

  it('event fan-out: in-app + email + sms rows, dedupe on replay, delivery, the inbox', async () => {
    const eventId = randomUUID();
    const event = { id: eventId, eventType: 'booking.created', aggregateType: 'booking', aggregateId: randomUUID(), payload: { bookingNumber: 'BK-1001', tripRequestId: randomUUID(), ownerProfileId, customerProfileId, totalAmount: '1500.00' } };
    expect(await handleDomainEvent(event)).toBe(true);
    // Replay of the same outbox row: no second row per user × channel.
    expect(await handleDomainEvent(event)).toBe(true);
    const rows = await prisma().notification.findMany({ where: { userId: ownerUserId, templateCode: 'BID_ACCEPTED' }, orderBy: { channel: 'asc' } });
    expect(rows.map((r) => `${r.channel}:${r.status}`).sort()).toEqual(['EMAIL:QUEUED', 'IN_APP:SENT', 'PUSH:SUPPRESSED', 'SMS:QUEUED']);
    expect(rows.find((r) => r.channel === 'IN_APP')?.body).toContain('BK-1001');
    expect(rows.find((r) => r.channel === 'IN_APP')?.body).toContain('1500.00 SAR');
    expect(rows.find((r) => r.channel === 'PUSH')?.errorMessage).toBe('push provider not configured');

    // The delivery worker (inline here) sends the queued rows through the providers.
    const d = await deliver(rows.filter((r) => r.status === 'QUEUED').map((r) => r.id), { finalAttempt: false });
    expect(d).toMatchObject({ sent: 2, failed: [], suppressed: 0 });
    expect(mem.emails).toHaveLength(1);
    expect(mem.emails[0]?.to).toBe('owner@notif.test');
    expect(mem.emails[0]?.subject).toContain('BK-1001');
    expect(mem.sms).toHaveLength(1);
    expect((await prisma().notification.count({ where: { userId: ownerUserId, status: 'SENT' } })).valueOf()).toBe(3);

    // Inbox (SELF): the owner sees it; the customer does not.
    const inbox = await bearer(request(h.app).get('/api/v1/notifications'), owner);
    expect(inbox.status, JSON.stringify(inbox.body)).toBe(200);
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0]).toMatchObject({ templateCode: 'BID_ACCEPTED', category: 'BIDDING', channel: 'IN_APP', readAt: null });
    expect(inbox.body.data[0].data.bookingId).toBe(event.aggregateId);
    expect(inbox.body.meta.nextCursor).toBeNull();
    expect((await bearer(request(h.app).get('/api/v1/notifications'), customer)).body.data).toHaveLength(0);
    const unread = await bearer(request(h.app).get('/api/v1/notifications/unread-count'), owner);
    expect(unread.body.data).toEqual({ total: 1, byCategory: { BIDDING: 1 } });
    const id = inbox.body.data[0].id as string;
    // Another user cannot mark or delete it.
    expect((await bearer(request(h.app).post(`/api/v1/notifications/${id}/read`), customer)).status).toBe(404);
    expect((await bearer(request(h.app).delete(`/api/v1/notifications/${id}`), customer)).status).toBe(404);
    const read = await bearer(request(h.app).post(`/api/v1/notifications/${id}/read`), owner);
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).not.toBeNull();
    expect((await bearer(request(h.app).get('/api/v1/notifications/unread-count'), owner)).body.data.total).toBe(0);
    expect((await bearer(request(h.app).get('/api/v1/notifications'), owner).query({ unreadOnly: true })).body.data).toHaveLength(0);
    expect((await bearer(request(h.app).delete(`/api/v1/notifications/${id}`), owner)).status).toBe(204);
    expect((await bearer(request(h.app).get('/api/v1/notifications'), owner)).body.data).toHaveLength(0);
  });

  it('preferences: locked categories, suppression of a disabled channel, read-all', async () => {
    const prefs = await bearer(request(h.app).get('/api/v1/notifications/preferences'), customer);
    expect(prefs.status).toBe(200);
    const security = prefsOf(prefs.body.data).filter((p) => p.category === 'SECURITY');
    expect(security.length).toBe(4);
    expect(security.every((p) => p.isLocked && p.isEnabled)).toBe(true);
    expect(prefOf(prefs.body.data, 'BIDDING', 'EMAIL')).toMatchObject({ isEnabled: true, isLocked: false });

    const locked = await bearer(request(h.app).put('/api/v1/notifications/preferences'), customer).send({ preferences: [{ category: 'PAYMENT', channel: 'EMAIL', isEnabled: false }] });
    expect(locked.status).toBe(422);
    expect(locked.body.error.code).toBe('NOTIFICATION_CATEGORY_LOCKED');

    const set = await bearer(request(h.app).put('/api/v1/notifications/preferences'), customer).send({ preferences: [{ category: 'BIDDING', channel: 'EMAIL', isEnabled: false }, { category: 'BIDDING', channel: 'SMS', isEnabled: false }] });
    expect(set.status).toBe(200);
    expect(prefOf(set.body.data, 'BIDDING', 'EMAIL')?.isEnabled).toBe(false);

    mem.emails.length = 0;
    const eventId = randomUUID();
    await handleDomainEvent({ id: eventId, eventType: 'bid.submitted', aggregateType: 'bid', aggregateId: randomUUID(), payload: { bidNumber: 'BID-77', tripRequestId: randomUUID(), requestNumber: 'TR-500', customerProfileId, ownerProfileId, totalAmount: '900.00' } });
    const rows = await prisma().notification.findMany({ where: { templateCode: 'BID_RECEIVED', dedupeKey: { startsWith: `evt:${eventId}` } } });
    // BID_RECEIVED has no SMS template; the disabled email is suppressed, the inbox row still lands.
    expect(rows.map((r) => `${r.channel}:${r.status}`).sort()).toEqual(['EMAIL:SUPPRESSED', 'IN_APP:SENT', 'PUSH:SUPPRESSED']);
    expect(rows.find((r) => r.channel === 'EMAIL')?.errorMessage).toBe('user preference');
    await deliver(null, { finalAttempt: false });
    expect(mem.emails).toHaveLength(0);

    // A payment event is locked — the email still goes out regardless of any preference row.
    await handleDomainEvent({ id: randomUUID(), eventType: 'payment.captured', aggregateType: 'payment', aggregateId: randomUUID(), payload: { paymentNumber: 'PAY-1', bookingId: randomUUID(), customerProfileId, amount: '1500.00' } });
    await deliver(null, { finalAttempt: false });
    expect(mem.emails.map((e) => e.subject)).toContain('Payment PAY-1 received');

    const all = await bearer(request(h.app).post('/api/v1/notifications/read-all'), customer).send({});
    expect(all.body.data.updated).toBe(2);
    expect((await bearer(request(h.app).get('/api/v1/notifications/unread-count'), customer)).body.data.total).toBe(0);
  });

  it('delivery retries: a provider failure keeps the row QUEUED until the final attempt', async () => {
    await handleDomainEvent({ id: randomUUID(), eventType: 'settlement.paid', aggregateType: 'settlement', aggregateId: randomUUID(), payload: { settlementNumber: 'ST-9', ownerProfileId, netPayableAmount: '4000.00', ibanLast4: '1234' } });
    const row = await prisma().notification.findFirstOrThrow({ where: { templateCode: 'SETTLEMENT_PAID', channel: 'EMAIL', userId: ownerUserId } });
    mem.failNext = 'smtp down';
    const first = await deliver([row.id], { finalAttempt: false });
    expect(first.failed).toEqual([row.id]);
    expect((await prisma().notification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('QUEUED');
    mem.failNext = 'smtp still down';
    await deliver([row.id], { finalAttempt: true });
    const final = await prisma().notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(final.status).toBe('FAILED');
    expect(final.errorMessage).toBe('smtp still down');
  });

  it('templates: list, preview with unfilled placeholders, edit bumps the version', async () => {
    expect((await bearer(request(h.app).get('/api/v1/notifications/templates'), owner)).status).toBe(403);
    const list = await bearer(request(h.app).get('/api/v1/notifications/templates'), admin).query({ code: 'OPS_ANNOUNCEMENT' });
    expect(list.status).toBe(200);
    expect(list.body.meta.totalItems).toBe(6);
    const t = (list.body.data as Tpl[]).find((x) => x.channel === 'IN_APP' && x.locale === 'en');
    if (!t) throw new Error('template missing');
    const preview = await bearer(request(h.app).post(`/api/v1/notifications/templates/${t.id}/preview`), admin).send({ variables: { title: 'Maintenance window' } });
    expect(preview.status).toBe(200);
    expect(preview.body.data.subject).toBe('Maintenance window');
    expect(preview.body.data.missingVariables).toEqual(['message']);
    const patched = await bearer(request(h.app).patch(`/api/v1/notifications/templates/${t.id}`), admin).send({ body: '{{message}} — UniGate operations' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.version).toBe(2);
    const dup = await bearer(request(h.app).post('/api/v1/notifications/templates'), admin).send({ code: 'OPS_ANNOUNCEMENT', channel: 'IN_APP', locale: 'en', body: 'x', category: 'OPERATIONS' });
    expect(dup.status).toBe(409);
    const created = await bearer(request(h.app).post('/api/v1/notifications/templates'), admin).send({ code: 'OPS_TEST_ONLY', channel: 'IN_APP', locale: 'en', subject: 'Hi {{name}}', body: 'Hello {{name}}', variables: ['name'], category: 'OPERATIONS' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await prisma().auditLog.count({ where: { entityType: 'notification_template', entityId: t.id, action: 'notification_template.updated' } })).toBe(1);
  });

  it('ops send: template + audience, idempotent; variables and audience validated', async () => {
    const key = randomUUID();
    const send = (k: string, body: Record<string, unknown>) => bearer(request(h.app).post('/api/v1/notifications/send'), admin).set('Idempotency-Key', k).send(body);
    expect((await bearer(request(h.app).post('/api/v1/notifications/send'), admin).send({})).status).toBe(400);
    const missing = await send(randomUUID(), { templateCode: 'OPS_ANNOUNCEMENT', variables: { title: 'x' }, audience: { profileTypes: ['OWNER'] } });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('NOTIFICATION_TEMPLATE_VARIABLES_MISSING');
    expect(missing.body.error.details.missing).toEqual(['message']);
    const nobody = await send(randomUUID(), { templateCode: 'OPS_ANNOUNCEMENT', variables: { title: 'x', message: 'y' }, audience: { roleCodes: ['NO_SUCH_ROLE'] } });
    expect(nobody.status).toBe(422);
    expect(nobody.body.error.code).toBe('NOTIFICATION_AUDIENCE_EMPTY');
    expect((await send(randomUUID(), { templateCode: 'NOPE_NOPE', variables: {}, audience: { profileTypes: ['OWNER'] } })).status).toBe(404);

    const sent = await send(key, { templateCode: 'OPS_ANNOUNCEMENT', variables: { title: 'Planned downtime', message: 'Tonight 02:00–03:00' }, audience: { profileTypes: ['OWNER'] }, channels: ['IN_APP', 'EMAIL'] });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    expect(sent.body.data.recipients).toBeGreaterThanOrEqual(1);
    expect(sent.body.data.queued).toBeGreaterThanOrEqual(2);
    const replay = await send(key, { templateCode: 'OPS_ANNOUNCEMENT', variables: { title: 'Planned downtime', message: 'Tonight 02:00–03:00' }, audience: { profileTypes: ['OWNER'] }, channels: ['IN_APP', 'EMAIL'] });
    expect(replay.status).toBe(202);
    expect(replay.body.data).toEqual(sent.body.data);
    const inbox = await bearer(request(h.app).get('/api/v1/notifications'), owner).query({ category: 'OPERATIONS' });
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0].title).toBe('Planned downtime');
    expect(inbox.body.data[0].body).toBe('Tonight 02:00–03:00 — UniGate operations');
    expect((await bearer(request(h.app).get('/api/v1/notifications'), customer).query({ category: 'OPERATIONS' })).body.data).toHaveLength(0);
    expect(await prisma().auditLog.count({ where: { action: 'notification.sent' } })).toBe(1);
  });

  it('one-time links: forgot-password delivers the reset URL by email and stores a masked row', async () => {
    mem.emails.length = 0;
    await clearThrottles();
    const res = await request(h.app).post('/api/v1/auth/password/forgot').send({ identifier: 'owner@notif.test' });
    expect(res.status).toBe(200);
    expect(mem.emails).toHaveLength(1);
    const url = /https?:\/\/\S+\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(mem.emails[0]?.text ?? '');
    expect(url).not.toBeNull();
    const stored = await prisma().notification.findFirstOrThrow({ where: { userId: ownerUserId, templateCode: 'PASSWORD_RESET' } });
    expect(stored.status).toBe('SENT');
    expect(stored.body).toContain('[link]');
    expect(stored.body).not.toContain(url?.[1] ?? 'never');
    // The link works: it consumes the token once.
    const reset = await request(h.app).post('/api/v1/auth/password/reset').send({ token: url?.[1], newPassword: 'a brand new long passphrase 9' });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    // The security notice for the change reaches the inbox via the subscriber.
    await handleDomainEvent({ id: randomUUID(), eventType: 'auth.password_changed', aggregateType: 'user', aggregateId: ownerUserId, payload: { at: new Date().toISOString() } });
    expect(await prisma().notification.count({ where: { userId: ownerUserId, templateCode: 'SECURITY_PASSWORD_CHANGED', channel: 'IN_APP', status: 'SENT' } })).toBe(1);
  });
});
