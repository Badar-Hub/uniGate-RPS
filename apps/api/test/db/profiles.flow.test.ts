/**
 * Phase 4 — profiles & documents against the real database AND the real object store
 * (MinIO from docker-compose / CI). Covers:
 *   - the presigned two-step upload, magic-byte check, checksum check, download-url audit
 *   - owner onboarding: DRAFT → (documents verified) → UNDER_REVIEW → APPROVED, verticals
 *   - driver creation under an owner, approval gate on documents + licence, availability
 *   - corporate customer: national address, verification prerequisites, credit decision
 *   - SPO lead conversion with the attribution chain
 *   - scope: another owner's documents and drivers are 404, never 403
 */
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'profiles test passphrase 1';

/** A tiny but valid PDF and PNG so the magic-byte sniff is exercised for real. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describeDb('profiles & documents', () => {
  let h: Harness;
  let admin = '';
  let owner = '';
  let ownerId = '';
  let ownerProfileId = '';
  let otherOwner = '';
  let customer = '';
  let customerProfileId = '';
  let spoToken = '';
  const cityId = async () => (await prisma().city.findFirstOrThrow({ where: { isActive: true }, select: { id: true } })).id;

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@profiles.test', PW, ['SUPER_ADMIN']);
    ownerId = await createUserWithRoles('owner@profiles.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    await createUserWithRoles('other@profiles.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    await createUserWithRoles('customer@profiles.test', PW, ['CUSTOMER'], 'CUSTOMER');
    await createUserWithRoles('spo@profiles.test', PW, ['SPO']);
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@profiles.test', PW)).accessToken;
    owner = (await loginBearer(h.app, 'owner@profiles.test', PW)).accessToken;
    otherOwner = (await loginBearer(h.app, 'other@profiles.test', PW)).accessToken;
    customer = (await loginBearer(h.app, 'customer@profiles.test', PW)).accessToken;
    spoToken = (await loginBearer(h.app, 'spo@profiles.test', PW)).accessToken;
    ownerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ownerId } })).id;
    // the helper creates APPROVED owners for the matrix; this suite walks the onboarding from DRAFT
    await prisma().ownerProfile.update({ where: { id: ownerProfileId }, data: { onboardingStatus: 'DRAFT', ownerType: 'INDIVIDUAL' } });
    customerProfileId = (await prisma().customerProfile.findFirstOrThrow({ where: { user: { email: 'customer@profiles.test' } } })).id;
  });
  afterAll(teardownHarness);

  /** Full client-side upload: upload-url → PUT to the store → confirm (with Idempotency-Key). */
  async function upload(token: string, documentTypeCode: string, target: { kind: string; id: string }, bytes: Buffer, mimeType: string, extra: Record<string, unknown> = {}) {
    const url = await bearer(request(h.app).post('/api/v1/documents/upload-url'), token).send({ documentTypeCode, target, originalFilename: `x.${mimeType.split('/')[1]}`, mimeType, sizeBytes: bytes.length, checksumSha256: sha(bytes), ...extra });
    if (url.status !== 201) return url;
    const put = await fetch(url.body.data.upload.url, { method: 'PUT', headers: url.body.data.upload.headers, body: bytes });
    expect(put.status).toBe(200);
    return bearer(request(h.app).post(`/api/v1/documents/${url.body.data.documentId}/confirm`), token).set('Idempotency-Key', randomUUID()).send({ checksumSha256: sha(bytes) });
  }

  async function stepUp(token: string, actionClass: string): Promise<string> {
    await clearThrottles();
    const req = await bearer(request(h.app).post('/api/v1/auth/step-up'), token).send({ actionClass });
    expect(req.status).toBe(200);
    const ver = await bearer(request(h.app).post('/api/v1/auth/step-up/verify'), token).send({ actionClass, code: h.otp.last('SENSITIVE_ACTION') });
    expect(ver.status).toBe(200);
    return ver.body.data.stepUpToken as string;
  }

  it('presigned upload: type/target/mime/size validation, real PUT, checksum + magic bytes on confirm', async () => {
    // wrong target kind for the type
    const wrongKind = await bearer(request(h.app).post('/api/v1/documents/upload-url'), owner).send({ documentTypeCode: 'OWNER_CR', target: { kind: 'USER', id: ownerId }, originalFilename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, checksumSha256: sha(PDF), expiryDate: '2030-01-01' });
    expect(wrongKind.status).toBe(422);
    expect(wrongKind.body.error.code).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
    // mime not allowed for the type
    const badMime = await bearer(request(h.app).post('/api/v1/documents/upload-url'), owner).send({ documentTypeCode: 'OWNER_CR', target: { kind: 'OWNER', id: ownerProfileId }, originalFilename: 'a.exe', mimeType: 'application/x-msdownload', sizeBytes: 10, checksumSha256: sha(PDF), expiryDate: '2030-01-01' });
    expect(badMime.body.error.code).toBe('DOCUMENT_MIME_NOT_ALLOWED');
    // expiry required
    const noExpiry = await bearer(request(h.app).post('/api/v1/documents/upload-url'), owner).send({ documentTypeCode: 'OWNER_CR', target: { kind: 'OWNER', id: ownerProfileId }, originalFilename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, checksumSha256: sha(PDF) });
    expect(noExpiry.body.error.code).toBe('DOCUMENT_EXPIRY_REQUIRED');
    // another owner's profile as target → 404 (anti-enumeration)
    const foreign = await bearer(request(h.app).post('/api/v1/documents/upload-url'), otherOwner).send({ documentTypeCode: 'OWNER_CR', target: { kind: 'OWNER', id: ownerProfileId }, originalFilename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, checksumSha256: sha(PDF), expiryDate: '2030-01-01' });
    expect(foreign.status).toBe(404);

    // confirm before the PUT → 409
    const early = await bearer(request(h.app).post('/api/v1/documents/upload-url'), owner).send({ documentTypeCode: 'OWNER_CR', target: { kind: 'OWNER', id: ownerProfileId }, originalFilename: 'cr.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, checksumSha256: sha(PDF), expiryDate: '2030-01-01' });
    expect(early.status).toBe(201);
    expect(early.body.data.upload.method).toBe('PUT');
    const notYet = await bearer(request(h.app).post(`/api/v1/documents/${early.body.data.documentId}/confirm`), owner).set('Idempotency-Key', randomUUID()).send({ checksumSha256: sha(PDF) });
    expect(notYet.status).toBe(409);
    expect(notYet.body.error.code).toBe('DOCUMENT_UPLOAD_INCOMPLETE');

    // declared PDF but PNG bytes → magic-byte mismatch
    const lie = await bearer(request(h.app).post('/api/v1/documents/upload-url'), owner).send({ documentTypeCode: 'OWNER_CR', target: { kind: 'OWNER', id: ownerProfileId }, originalFilename: 'cr.pdf', mimeType: 'application/pdf', sizeBytes: PNG.length, checksumSha256: sha(PNG), expiryDate: '2030-01-01' });
    const put = await fetch(lie.body.data.upload.url, { method: 'PUT', headers: lie.body.data.upload.headers, body: PNG });
    expect(put.status).toBe(200);
    const sniffed = await bearer(request(h.app).post(`/api/v1/documents/${lie.body.data.documentId}/confirm`), owner).set('Idempotency-Key', randomUUID()).send({ checksumSha256: sha(PNG) });
    expect(sniffed.status).toBe(422);
    expect(sniffed.body.error.code).toBe('DOCUMENT_MIME_NOT_ALLOWED');
    expect(sniffed.body.error.details.detected).toBe('image/png');

    // the honest one
    const ok = await upload(owner, 'OWNER_CR', { kind: 'OWNER', id: ownerProfileId }, PDF, 'application/pdf', { expiryDate: '2030-01-01' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.uploadStatus).toBe('UPLOADED');
    expect(ok.body.data.verificationStatus).toBe('PENDING');
    expect(ok.body.data).not.toHaveProperty('storageKey');

    // metadata never carries a URL; download-url does, and it is audited
    const meta = await bearer(request(h.app).get(`/api/v1/documents/${ok.body.data.id}`), owner);
    expect(meta.status).toBe(200);
    expect(JSON.stringify(meta.body)).not.toMatch(/X-Amz|http/);
    const dl = await bearer(request(h.app).get(`/api/v1/documents/${ok.body.data.id}/download-url`), owner);
    expect(dl.status).toBe(200);
    expect(dl.body.data.url).toMatch(/X-Amz-Signature/);
    const fetched = await fetch(dl.body.data.url);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PDF)).toBe(true);
    const audit = await prisma().auditLog.findFirst({ where: { action: 'document.download_url_issued', entityId: ok.body.data.id } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.afterValue)).not.toMatch(/X-Amz/);

    // other owner cannot see or download it
    expect((await bearer(request(h.app).get(`/api/v1/documents/${ok.body.data.id}`), otherOwner)).status).toBe(404);
    expect((await bearer(request(h.app).get(`/api/v1/documents/${ok.body.data.id}/download-url`), otherOwner)).status).toBe(404);
  });

  it('owner onboarding: submit is blocked until mandatory documents are verified, then approve', async () => {
    const me = await bearer(request(h.app).get('/api/v1/me/owner-profile'), owner);
    expect(me.status).toBe(200);
    expect(me.body.data.onboardingStatus).toBe('DRAFT');

    const patched = await bearer(request(h.app).patch(`/api/v1/owners/${ownerProfileId}`), owner).send({ ownerType: 'COMPANY', businessNameEn: 'Najd Fleet', businessNameAr: 'أسطول نجد', crNumber: '1010123456', nationalId: '1234567890', transportTypes: ['PASSENGER'], privacySettings: { showFleetSize: true } });
    expect(patched.status).toBe(200);
    expect(patched.body.data.nationalIdLast4).toBe('7890');
    expect(patched.body.data.privacySettings.showFleetSize).toBe(true);
    // the encrypted value never appears anywhere in the DTO
    expect(JSON.stringify(patched.body)).not.toContain('1234567890');
    const row = await prisma().ownerProfile.findUniqueOrThrow({ where: { id: ownerProfileId } });
    expect(row.nationalIdEncrypted).toMatch(/^v1:/);

    const tooEarly = await bearer(request(h.app).post(`/api/v1/owners/${ownerProfileId}/submit-for-review`), owner);
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body.error.code).toBe('OWNER_DOCUMENTS_INCOMPLETE');
    expect(tooEarly.body.error.details.missing).toEqual(expect.arrayContaining(['OWNER_CR', 'OWNER_TGA_LICENCE_PASSENGER']));

    // requirements checklist agrees with the guard
    const reqs = await bearer(request(h.app).get('/api/v1/documents/requirements'), owner).query({ appliesTo: 'OWNER', targetId: ownerProfileId, transportType: 'PASSENGER' });
    expect(reqs.status).toBe(200);
    const byCode = Object.fromEntries((reqs.body.data as { documentTypeCode: string; status: string }[]).map((r) => [r.documentTypeCode, r.status]));
    expect(byCode['OWNER_CR']).toBe('PENDING');
    expect(byCode['OWNER_TGA_LICENCE_PASSENGER']).toBe('MISSING');
    expect(byCode).not.toHaveProperty('OWNER_TGA_LICENCE_GOODS');

    // upload the licence, then admin verifies both
    const lic = await upload(owner, 'OWNER_TGA_LICENCE_PASSENGER', { kind: 'OWNER', id: ownerProfileId }, PDF, 'application/pdf', { expiryDate: '2030-01-01' });
    expect(lic.status).toBe(200);
    const pending = await bearer(request(h.app).get('/api/v1/documents'), admin).query({ ownerProfileId, verificationStatus: 'PENDING', uploadStatus: 'UPLOADED' });
    expect(pending.body.data.length).toBe(2);
    for (const d of pending.body.data as { id: string }[]) {
      const v = await bearer(request(h.app).post(`/api/v1/documents/${d.id}/verify`), admin).send({});
      expect(v.status).toBe(200);
      expect(v.body.data.verificationStatus).toBe('VERIFIED');
    }
    const again = await bearer(request(h.app).post(`/api/v1/documents/${pending.body.data[0].id}/verify`), admin).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DOCUMENT_ALREADY_VERIFIED');

    const submitted = await bearer(request(h.app).post(`/api/v1/owners/${ownerProfileId}/submit-for-review`), owner);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.onboardingStatus).toBe('UNDER_REVIEW');

    // an owner cannot approve themselves (no owners.approve) and cannot see another owner
    expect((await bearer(request(h.app).post(`/api/v1/owners/${ownerProfileId}/approve`), owner).send({})).status).toBe(403);
    const otherId = (await prisma().ownerProfile.findFirstOrThrow({ where: { user: { email: 'other@profiles.test' } } })).id;
    expect((await bearer(request(h.app).get(`/api/v1/owners/${otherId}`), owner)).status).toBe(404);

    const approved = await bearer(request(h.app).post(`/api/v1/owners/${ownerProfileId}/approve`), admin).send({ notes: 'CR and TGA licence verified' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.onboardingStatus).toBe('APPROVED');
    expect(approved.body.data.verticals).toEqual([expect.objectContaining({ transportType: 'PASSENGER', status: 'APPROVED' })]);

    // service areas + bank account (step-up) with cool-off
    const c = await cityId();
    const areas = await bearer(request(h.app).put(`/api/v1/owners/${ownerProfileId}/service-areas`), owner).send({ cityIds: [c] });
    expect(areas.body.data.serviceAreaCityIds).toEqual([c]);
    const gated = await bearer(request(h.app).post(`/api/v1/owners/${ownerProfileId}/bank-accounts`), owner).send({ accountHolderName: 'Najd Fleet', bankName: 'SNB', iban: 'SA0380000000608010167519' });
    expect(gated.status).toBe(403);
    expect(gated.body.error.details.actionClass).toBe('BANK_ACCOUNT');
    const token = await stepUp(owner, 'BANK_ACCOUNT');
    const bank = await bearer(request(h.app).post(`/api/v1/owners/${ownerProfileId}/bank-accounts`), owner).set('X-Step-Up-Token', token).send({ accountHolderName: 'Najd Fleet', bankName: 'SNB', iban: 'SA0380000000608010167519' });
    expect(bank.status).toBe(201);
    expect(bank.body.data.ibanLast4).toBe('7519');
    expect(bank.body.data.isDefault).toBe(true);
    expect(new Date(bank.body.data.activationAt).getTime()).toBeGreaterThan(Date.now() + 60 * 3_600_000);
    expect(JSON.stringify(bank.body)).not.toContain('SA0380000000608010167519');
    const list = await bearer(request(h.app).get(`/api/v1/owners/${ownerProfileId}/bank-accounts`), owner);
    expect(list.body.data).toHaveLength(1);

    // identity edit after approval → back to UNDER_REVIEW
    const reReview = await bearer(request(h.app).patch(`/api/v1/owners/${ownerProfileId}`), owner).send({ crNumber: '1010999999' });
    expect(reReview.body.data.onboardingStatus).toBe('UNDER_REVIEW');
    await bearer(request(h.app).post(`/api/v1/owners/${ownerProfileId}/approve`), admin).send({});
  });

  it('drivers: created under the owner, approval needs verified documents, availability rules', async () => {
    const created = await bearer(request(h.app).post('/api/v1/drivers'), owner).send({
      fullNameEn: 'Saad Driver', phoneE164: '+966533333333', idType: 'NATIONAL_ID', nationalId: '1098765432', licenseNumber: 'LIC12345', licenseExpiryDate: '2030-06-30', licenseCategories: ['B'], transportTypes: ['PASSENGER'],
    });
    expect(created.status).toBe(201);
    const driverId: string = created.body.data.id;
    expect(created.body.data.ownerProfileId).toBe(ownerProfileId);
    expect(created.body.data.nationalIdLast4).toBe('5432');
    expect(created.body.data.licenseNumberLast4).toBe('2345');
    expect(JSON.stringify(created.body)).not.toMatch(/1098765432|LIC12345/);

    // other owner: 404; support (drivers.read_any) sees it but masked
    expect((await bearer(request(h.app).get(`/api/v1/drivers/${driverId}`), otherOwner)).status).toBe(404);
    const mine = await bearer(request(h.app).get('/api/v1/drivers'), owner);
    expect((mine.body.data as { id: string }[]).map((d) => d.id)).toEqual([driverId]);
    expect((await bearer(request(h.app).get('/api/v1/drivers'), otherOwner)).body.data).toEqual([]);

    // cannot go on duty before approval
    const early = await bearer(request(h.app).post(`/api/v1/drivers/${driverId}/availability`), owner).send({ availabilityStatus: 'AVAILABLE' });
    expect(early.body.error.code).toBe('DRIVER_NOT_APPROVED');
    // ON_TRIP is rejected at validation
    expect((await bearer(request(h.app).post(`/api/v1/drivers/${driverId}/availability`), owner).send({ availabilityStatus: 'ON_TRIP' })).status).toBe(422);

    const notReady = await bearer(request(h.app).post(`/api/v1/drivers/${driverId}/approve`), admin).send({});
    expect(notReady.status).toBe(422);
    expect(notReady.body.error.details.missing).toEqual(expect.arrayContaining(['DRIVER_LICENCE', 'DRIVER_TGA_CARD_PASSENGER', 'DRIVER_PHOTO']));

    for (const [code, bytes, mime, extra] of [
      ['DRIVER_LICENCE', PDF, 'application/pdf', { expiryDate: '2030-06-30' }],
      ['DRIVER_TGA_CARD_PASSENGER', PDF, 'application/pdf', { expiryDate: '2030-06-30' }],
      ['DRIVER_PHOTO', PNG, 'image/png', {}],
    ] as const) {
      const up = await upload(owner, code, { kind: 'DRIVER', id: driverId }, bytes, mime, extra);
      expect(up.status).toBe(200);
      const v = await bearer(request(h.app).post(`/api/v1/documents/${up.body.data.id}/verify`), admin).send({});
      expect(v.status).toBe(200);
    }
    const approved = await bearer(request(h.app).post(`/api/v1/drivers/${driverId}/approve`), admin).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.data.approvalStatus).toBe('APPROVED');
    const onDuty = await bearer(request(h.app).post(`/api/v1/drivers/${driverId}/availability`), owner).send({ availabilityStatus: 'AVAILABLE' });
    expect(onDuty.body.data.availabilityStatus).toBe('AVAILABLE');

    // the driver signs in by OTP on their phone and reads their own record (SELF scope, no drivers.* code)
    await clearThrottles();
    const otp = await request(h.app).post('/api/v1/auth/otp/request').send({ channel: 'SMS', destination: '+966533333333', purpose: 'LOGIN' });
    expect(otp.status).toBe(200);
    const login = await request(h.app).post('/api/v1/auth/otp/verify').send({ channel: 'SMS', destination: '+966533333333', purpose: 'LOGIN', code: h.otp.last('LOGIN'), clientType: 'ANDROID', deviceId: 'driver-device-0001' });
    expect(login.body, JSON.stringify(login.body)).toMatchObject({ success: true });
    const drv: string = login.body.data.tokens.accessToken;
    const self = await bearer(request(h.app).get(`/api/v1/drivers/${driverId}`), drv);
    expect(self.status).toBe(200);
    expect(self.body.data.nationalIdLast4).toBe('5432');

    const gone = await bearer(request(h.app).delete(`/api/v1/drivers/${driverId}`), owner);
    expect(gone.status).toBe(204);
    expect((await bearer(request(h.app).get(`/api/v1/drivers/${driverId}`), drv)).status).toBe(401);
  });

  it('corporate customer: address + documents gate verification; credit needs verification and a limit', async () => {
    const corp = await bearer(request(h.app).put(`/api/v1/customers/${customerProfileId}/corporate`), customer).send({
      companyNameEn: 'Najd Logistics', companyNameAr: 'نجد للخدمات اللوجستية', crNumber: '1010555555', contactPersonName: 'Amal', contactPersonPhone: '+966544444444',
      billingCycle: 'MONTHLY', creditTermsDays: 30,
    });
    expect(corp.status).toBe(200);
    expect(corp.body.data.customerType).toBe('CORPORATE');
    expect(corp.body.data.corporate.nationalAddress.isComplete).toBe(false);
    const corporateId: string = corp.body.data.corporate.id;

    const notReady = await bearer(request(h.app).post(`/api/v1/customers/${customerProfileId}/verify`), admin).send({});
    expect(notReady.status).toBe(422);
    expect(Object.keys(notReady.body.error.details.fieldErrors)).toEqual(expect.arrayContaining(['vatNumber', 'nationalAddress', 'documents']));

    const c = await cityId();
    await bearer(request(h.app).patch(`/api/v1/customers/${customerProfileId}`), customer).send({ vatNumber: '300012345600003' });
    const withAddress = await bearer(request(h.app).put(`/api/v1/customers/${customerProfileId}/corporate`), customer).send({
      companyNameEn: 'Najd Logistics', companyNameAr: 'نجد للخدمات اللوجستية', crNumber: '1010555555', contactPersonName: 'Amal', contactPersonPhone: '+966544444444',
      nationalAddress: { buildingNumber: '1234', streetEn: 'King Fahd Rd', streetAr: 'طريق الملك فهد', districtEn: 'Olaya', districtAr: 'العليا', cityId: c, postalCode: '12211', additionalNumber: '5678' },
    });
    expect(withAddress.body.data.corporate.nationalAddress.isComplete).toBe(true);
    for (const [code, extra] of [['CORPORATE_CR', { expiryDate: '2030-01-01' }], ['CORPORATE_VAT_CERTIFICATE', {}], ['CORPORATE_NATIONAL_ADDRESS', { expiryDate: '2030-01-01' }]] as const) {
      const up = await upload(customer, code, { kind: 'CORPORATE_CUSTOMER', id: corporateId }, PDF, 'application/pdf', extra);
      expect(up.status).toBe(200);
      expect((await bearer(request(h.app).post(`/api/v1/documents/${up.body.data.id}/verify`), admin).send({})).status).toBe(200);
    }
    // credit approval refused before verification
    const premature = await bearer(request(h.app).patch(`/api/v1/admin/customers/${customerProfileId}/credit`), admin).send({ creditStatus: 'APPROVED', creditLimitAmount: '250000.00' });
    expect(premature.status).toBe(422);
    const verified = await bearer(request(h.app).post(`/api/v1/customers/${customerProfileId}/verify`), admin).send({});
    expect(verified.status).toBe(200);
    expect(verified.body.data.corporate.isVerified).toBe(true);

    const credit = await bearer(request(h.app).patch(`/api/v1/admin/customers/${customerProfileId}/credit`), admin).send({ creditStatus: 'APPROVED', creditLimitAmount: '250000.00', creditTermsDays: 45 });
    expect(credit.status).toBe(200);
    expect(credit.body.data).toMatchObject({ creditStatus: 'APPROVED', creditLimitAmount: '250000.00', outstandingAmount: '0.00', availableAmount: '250000.00', defaultBillingMode: 'INVOICED', currency: 'SAR' });
    // the customer reads their own position through invoices.read; a suspension without a reason is 422
    const own = await bearer(request(h.app).get(`/api/v1/customers/${customerProfileId}/credit`), customer);
    expect(own.status).toBe(200);
    expect(own.body.data.creditTermsDays).toBe(45);
    expect((await bearer(request(h.app).patch(`/api/v1/admin/customers/${customerProfileId}/credit`), admin).send({ creditStatus: 'SUSPENDED' })).status).toBe(422);
    const audit = await prisma().auditLog.findFirst({ where: { action: 'customer.credit_changed', entityId: customerProfileId } });
    expect(audit?.severity).toBe('NOTICE');
    // the owner (a stranger to this customer) cannot see the customer
    expect((await bearer(request(h.app).get(`/api/v1/customers/${customerProfileId}`), owner)).status).toBe(403);
  });

  it('SPO: lead pipeline converts into an attributed customer; assignments are admin-only', async () => {
    const spoId = (await prisma().spoProfile.create({ data: { id: randomUUID(), userId: (await prisma().user.findFirstOrThrow({ where: { email: 'spo@profiles.test' } })).id, employeeCode: 'SPO-001' } })).id;
    await clearThrottles();
    spoToken = (await loginBearer(h.app, 'spo@profiles.test', PW)).accessToken; // re-login so the actor carries spoProfileId
    const lead = await bearer(request(h.app).post('/api/v1/spo/leads'), spoToken).send({ contactName: 'Fahad', contactPhone: '+966555555555', companyName: 'Fahad Trading' });
    expect(lead.status).toBe(201);
    expect(lead.body.data.spoProfileId).toBe(spoId);
    const tooSoon = await bearer(request(h.app).post(`/api/v1/spo/leads/${lead.body.data.id}/convert`), spoToken).send({ customerType: 'CORPORATE', fullNameEn: 'Fahad' });
    expect(tooSoon.status).toBe(422);
    await bearer(request(h.app).patch(`/api/v1/spo/leads/${lead.body.data.id}`), spoToken).send({ status: 'QUALIFIED' });
    const converted = await bearer(request(h.app).post(`/api/v1/spo/leads/${lead.body.data.id}/convert`), spoToken).send({ customerType: 'CORPORATE', fullNameEn: 'Fahad' });
    expect(converted.status).toBe(201);
    expect(converted.body.data.lead.status).toBe('CONVERTED');
    const cust = await bearer(request(h.app).get(`/api/v1/customers/${converted.body.data.customerProfileId}`), spoToken);
    expect(cust.body.data.acquiredBySpoId).toBe(spoId);
    // an SPO cannot assign customers to themselves (spo.update is admin-only)
    expect((await bearer(request(h.app).post(`/api/v1/spo/profiles/${spoId}/customers`), spoToken).send({ customerProfileId })).status).toBe(403);
    const assigned = await bearer(request(h.app).post(`/api/v1/spo/profiles/${spoId}/customers`), admin).send({ customerProfileId });
    expect(assigned.status).toBe(201);
    const mine = await bearer(request(h.app).get(`/api/v1/spo/profiles/${spoId}/customers`), spoToken);
    expect((mine.body.data as { customerProfileId: string }[]).map((a) => a.customerProfileId).sort()).toEqual([customerProfileId, converted.body.data.customerProfileId as string].sort());
  });

  it('saved locations are bound to the acting customer', async () => {
    const c = await cityId();
    const created = await bearer(request(h.app).post('/api/v1/me/saved-locations'), customer).send({ label: 'Office', addressLine: 'Olaya St 12', cityId: c, latitude: 24.7136, longitude: 46.6753 });
    expect(created.status).toBe(201);
    expect((await bearer(request(h.app).get('/api/v1/me/saved-locations'), customer)).body.data).toHaveLength(1);
    // an owner without a customer profile: empty list, 422 on create, 404 on someone else's id
    expect((await bearer(request(h.app).get('/api/v1/me/saved-locations'), owner)).body.data).toEqual([]);
    expect((await bearer(request(h.app).post('/api/v1/me/saved-locations'), owner).send({ label: 'x', addressLine: 'somewhere', cityId: c, latitude: 1, longitude: 1 })).status).toBe(422);
    expect((await bearer(request(h.app).delete(`/api/v1/me/saved-locations/${created.body.data.id}`), owner)).status).toBe(422);
    expect((await bearer(request(h.app).delete(`/api/v1/me/saved-locations/${created.body.data.id}`), customer)).status).toBe(204);
  });
});
