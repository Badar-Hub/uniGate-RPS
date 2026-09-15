/** OpenAPI registrations for /customers, /owners, /drivers, /spo and /me/saved-locations (api.md §8.2, §8.4–§8.7). */
import { z } from 'zod';
import {
  adminCreditBody,
  adminVatNumberBody,
  assignSpoCustomerBody,
  convertSpoLeadBody,
  createBankAccountBody,
  createCustomerBody,
  createDriverBody,
  createOwnerBody, createVendorBody,
  createSpoLeadBody,
  createSpoProfileBody,
  driverAvailabilityBody,
  driverDecisionBody,
  driverRejectBody,
  idParams,
  listCustomersQuery,
  listDriversQuery,
  listOwnersQuery,
  listSpoCommissionsQuery,
  listSpoLeadsQuery,
  listSpoProfilesQuery,
  ownerDecisionBody,
  ownerRejectBody,
  ownerSuspendBody,
  patchCustomerBody,
  patchDriverBody,
  patchOwnerBody,
  patchSavedLocationBody,
  patchSpoLeadBody,
  patchSpoProfileBody,
  savedLocationBody,
  serviceAreasBody,
  spoCustomerParams,
  upsertCorporateBody,
  verifyCustomerBody,
} from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: successEnvelope(schema, name) } } });
const bearer = [{ bearerAuth: [] }];
const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });
const money = z.string().regex(/^-?\d+\.\d{2}$/).openapi({ description: 'decimal string, 2dp' });
const stepUpHeader = z.object({ 'x-step-up-token': z.string() });

const nationalAddress = z
  .object({
    buildingNumber: z.string().nullable(), streetEn: z.string().nullable(), streetAr: z.string().nullable(), districtEn: z.string().nullable(), districtAr: z.string().nullable(),
    cityId: z.string().uuid().nullable(), postalCode: z.string().nullable(), additionalNumber: z.string().nullable(), shortCode: z.string().nullable(), isComplete: z.boolean(),
  })
  .openapi('NationalAddress');
const corporate = z
  .object({
    id: z.string().uuid(), companyNameEn: z.string(), companyNameAr: z.string(), crNumber: z.string(), nationalAddress, contactPersonName: z.string(), contactPersonPhone: z.string(),
    contactPersonEmail: z.string().nullable(), creditStatus: z.string(), creditLimitAmount: money, creditTermsDays: z.number().int(), billingCycle: z.string(),
    invoiceLineGranularity: z.string().nullable(), isVerified: z.boolean(), creditApprovedAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('CorporateCustomer');
const customer = z
  .object({
    id: z.string().uuid(), userId: z.string().uuid(), customerType: z.string(), fullNameEn: z.string(), fullNameAr: z.string().nullable(), phoneE164: z.string().nullable(), email: z.string().nullable(),
    userStatus: z.string(), vatNumber: z.string().nullable(), vatNumberVerifiedAt: z.string().datetime().nullable(), vatNumberLockedAt: z.string().datetime().nullable(), defaultCityId: z.string().uuid().nullable(),
    ratingAvg: z.string(), ratingCount: z.number().int(), totalBookings: z.number().int(), acquiredBySpoId: z.string().uuid().nullable(), corporate: corporate.nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('Customer');
const credit = z
  .object({
    customerProfileId: z.string().uuid(), companyNameEn: z.string(), isVerified: z.boolean(), creditStatus: z.string(), creditLimitAmount: money, creditTermsDays: z.number().int(), billingCycle: z.string(),
    defaultBillingMode: z.enum(['PREPAID', 'INVOICED']), outstandingAmount: money, availableAmount: money, headroomAmount: money, currency: z.literal('SAR'), creditApprovedAt: z.string().datetime().nullable(), computedAt: z.string().datetime(),
  })
  .openapi('CustomerCredit', { description: 'outstandingAmount is computed from ledger_entries on read (30 s cache); never a stored column.' });
const owner = z
  .object({
    id: z.string().uuid(), userId: z.string().uuid(), ownerType: z.string(), isPlatformFleet: z.boolean(), businessNameEn: z.string().nullable(), businessNameAr: z.string().nullable(), crNumber: z.string().nullable(),
    vatNumber: z.string().nullable(), isVatRegistered: z.boolean(), vatVerifiedAt: z.string().datetime().nullable(), nationalIdLast4: z.string().nullable(), onboardingStatus: z.string(), approvedAt: z.string().datetime().nullable(),
    rejectionReason: z.string().nullable(), ratingAvg: z.string(), ratingCount: z.number().int(), privacySettings: z.record(z.boolean()),
    verticals: z.array(z.object({ transportType: z.string(), status: z.string(), approvedAt: z.string().datetime().nullable(), notes: z.string().nullable() })),
    serviceAreaCityIds: z.array(z.string().uuid()), fullNameEn: z.string(), phoneE164: z.string().nullable(), email: z.string().nullable(), userStatus: z.string(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('Owner');
const bankAccount = z
  .object({ id: z.string().uuid(), accountHolderName: z.string(), bankName: z.string(), ibanLast4: z.string(), isVerified: z.boolean(), isDefault: z.boolean(), activationAt: z.string().datetime(), createdAt: z.string().datetime() })
  .openapi('OwnerBankAccount');
const driver = z
  .object({
    id: z.string().uuid(), userId: z.string().uuid(), ownerProfileId: z.string().uuid().nullable(), fullNameEn: z.string(), fullNameAr: z.string().nullable(), phoneE164: z.string().nullable(), userStatus: z.string(),
    idType: z.string(), nationalIdLast4: z.string().nullable(), dateOfBirth: z.string().nullable(), licenseNumberLast4: z.string().nullable(), licenseExpiryDate: z.string().nullable(), licenseCategories: z.array(z.string()),
    approvalStatus: z.string(), availabilityStatus: z.string(), ratingAvg: z.string(), ratingCount: z.number().int(), emergencyContactName: z.string().nullable(), emergencyContactPhone: z.string().nullable(),
    verticals: z.array(z.object({ transportType: z.string(), status: z.string(), approvedAt: z.string().datetime().nullable() })), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('Driver');
const assignment = z.object({ id: z.string().uuid(), vehicleId: z.string().uuid(), assignedAt: z.string().datetime(), unassignedAt: z.string().datetime().nullable(), assignedByUserId: z.string().uuid().nullable() }).openapi('DriverAssignment');
const spoProfile = z
  .object({
    id: z.string().uuid(), userId: z.string().uuid(), fullNameEn: z.string(), email: z.string().nullable(), employeeCode: z.string(), regionId: z.string().uuid().nullable(), managerUserId: z.string().uuid().nullable(),
    commissionModelId: z.string().uuid().nullable(), isActive: z.boolean(), activeCustomerCount: z.number().int(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('SpoProfile');
const spoAssignment = z.object({ id: z.string().uuid(), spoProfileId: z.string().uuid(), customerProfileId: z.string().uuid(), customerFullNameEn: z.string(), assignedAt: z.string().datetime(), unassignedAt: z.string().datetime().nullable() }).openapi('SpoCustomerAssignment');
const spoLead = z
  .object({ id: z.string().uuid(), spoProfileId: z.string().uuid(), contactName: z.string(), contactPhone: z.string(), companyName: z.string().nullable(), status: z.string(), convertedUserId: z.string().uuid().nullable(), notes: z.string().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() })
  .openapi('SpoLead');
const spoCommission = z.object({ bookingId: z.string().uuid(), spoProfileId: z.string(), customerProfileId: z.string().uuid(), amount: money, basis: z.string(), snapshotAt: z.string().datetime() }).openapi('SpoCommissionLine');
const savedLocation = z
  .object({ id: z.string().uuid(), label: z.string(), addressLine: z.string(), cityId: z.string().uuid(), latitude: z.number(), longitude: z.number(), placeId: z.string().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() })
  .openapi('SavedLocation');

// ── customers ────────────────────────────────────────────────────────────────
registry.registerPath({ method: 'get', path: '/customers', tags: ['customers'], summary: 'List customers (customers.read)', security: bearer, request: { query: listCustomersQuery }, responses: { 200: ok(z.array(customer), 'CustomerListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'post', path: '/customers', tags: ['customers'], summary: 'Staff/SPO-created customer (customers.create; OTP login verifies the phone)', security: bearer, request: { body: json(createCustomerBody) }, responses: { 201: ok(customer, 'CustomerEnvelope', 'Created'), 409: err('AUTH_IDENTIFIER_TAKEN') } });
registry.registerPath({ method: 'get', path: '/customers/{id}', tags: ['customers'], summary: 'Profile + corporate extension (own → global)', security: bearer, request: { params: idParams }, responses: { 200: ok(customer, 'CustomerEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'patch', path: '/customers/{id}', tags: ['customers'], summary: 'Default city, VAT number (locked once invoiced), SPO attribution', security: bearer, request: { params: idParams, body: json(patchCustomerBody) }, responses: { 200: ok(customer, 'CustomerEnvelope'), 422: err('VALIDATION_FAILED with details.lockedByInvoiceNumber') } });
registry.registerPath({ method: 'put', path: '/customers/{id}/corporate', tags: ['customers'], summary: 'Upsert the corporate extension (national address per FR-PROFILES-14)', security: bearer, request: { params: idParams, body: json(upsertCorporateBody) }, responses: { 200: ok(customer, 'CustomerEnvelope') } });
registry.registerPath({ method: 'post', path: '/customers/{id}/verify', tags: ['customers'], summary: 'Verify the corporate record: VAT number, full national address and verified mandatory documents (customers.verify)', security: bearer, request: { params: idParams, body: json(verifyCustomerBody) }, responses: { 200: ok(customer, 'CustomerEnvelope'), 422: err('VALIDATION_FAILED — details.fieldErrors names what is missing') } });
registry.registerPath({ method: 'get', path: '/customers/{id}/credit', tags: ['customers'], summary: 'Credit position (invoices.read; own → global)', security: bearer, request: { params: idParams }, responses: { 200: ok(credit, 'CustomerCreditEnvelope'), 404: err('NOT_FOUND — no corporate profile') } });
registry.registerPath({ method: 'patch', path: '/admin/customers/{id}/credit', tags: ['customers'], summary: 'Credit decision (customers.verify): APPROVED needs a verified record and a positive limit; SUSPENDED needs a reason', security: bearer, request: { params: idParams, body: json(adminCreditBody) }, responses: { 200: ok(credit, 'CustomerCreditEnvelope'), 422: err('VALIDATION_FAILED') } });
registry.registerPath({ method: 'patch', path: '/admin/customers/{id}/vat-number', tags: ['customers'], summary: 'Admin correction of a locked VAT number (audited NOTICE; issued invoices untouched)', security: bearer, request: { params: idParams, body: json(adminVatNumberBody) }, responses: { 200: ok(customer, 'CustomerEnvelope') } });

// ── owners ───────────────────────────────────────────────────────────────────
registry.registerPath({ method: 'get', path: '/me/owner-profile', tags: ['owners'], summary: 'The caller’s own owner profile', security: bearer, responses: { 200: ok(owner, 'OwnerEnvelope'), 404: err('no owner profile') } });
registry.registerPath({ method: 'get', path: '/owners', tags: ['owners'], summary: 'List owners (owners.read)', security: bearer, request: { query: listOwnersQuery }, responses: { 200: ok(z.array(owner), 'OwnerListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'post', path: '/admin/vendors', tags: ['owners'], summary: 'UniGate adds a third-party vendor (users.create + owners.create): account with the VEHICLE_OWNER role, owner profile, verticals applied for, and a one-time activation link shown to the admin. The vendor activates, uploads documents, and the profile enters the review queue by itself when every mandatory document is in', security: bearer, request: { body: json(createVendorBody) }, responses: { 201: ok(z.object({ user: z.object({ id: z.string().uuid(), email: z.string().nullable() }).passthrough(), owner, activationUrl: z.string(), activationExpiresAt: z.string().datetime() }).openapi('VendorCreated'), 'VendorCreatedEnvelope', 'Created'), 409: err('AUTH_IDENTIFIER_TAKEN') } });
registry.registerPath({ method: 'post', path: '/owners', tags: ['owners'], summary: 'Admin-created owner profile for an existing user (owners.create)', security: bearer, request: { body: json(createOwnerBody) }, responses: { 201: ok(owner, 'OwnerEnvelope', 'Created'), 409: err('CONFLICT — user already has one') } });
registry.registerPath({ method: 'get', path: '/owners/{id}', tags: ['owners'], summary: 'Owner profile (own → global); nationalIdLast4 only for self or owners.pii.reveal', security: bearer, request: { params: idParams }, responses: { 200: ok(owner, 'OwnerEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'patch', path: '/owners/{id}', tags: ['owners'], summary: 'Business details, national id (encrypted), verticals, privacy; identity edits after approval → UNDER_REVIEW', security: bearer, request: { params: idParams, body: json(patchOwnerBody) }, responses: { 200: ok(owner, 'OwnerEnvelope'), 422: err('OWNER_NOT_APPROVED (suspended)') } });
registry.registerPath({ method: 'post', path: '/owners/{id}/submit-for-review', tags: ['owners'], summary: 'DRAFT / REJECTED → UNDER_REVIEW once mandatory documents are verified', security: bearer, request: { params: idParams }, responses: { 200: ok(owner, 'OwnerEnvelope'), 422: err('OWNER_DOCUMENTS_INCOMPLETE (details.missing) / OWNER_NOT_APPROVED') } });
registry.registerPath({ method: 'post', path: '/owners/{id}/approve', tags: ['owners'], summary: '→ APPROVED, verticals approved (owners.approve)', security: bearer, request: { params: idParams, body: json(ownerDecisionBody) }, responses: { 200: ok(owner, 'OwnerEnvelope'), 422: err('OWNER_NOT_APPROVED — not under review') } });
registry.registerPath({ method: 'post', path: '/owners/{id}/reject', tags: ['owners'], summary: '→ REJECTED with a reason (owners.approve)', security: bearer, request: { params: idParams, body: json(ownerRejectBody) }, responses: { 200: ok(owner, 'OwnerEnvelope') } });
registry.registerPath({ method: 'post', path: '/owners/{id}/suspend', tags: ['owners'], summary: '→ SUSPENDED; vehicles become non-dispatchable, live bookings untouched (owners.suspend)', security: bearer, request: { params: idParams, body: json(ownerSuspendBody) }, responses: { 200: ok(owner, 'OwnerEnvelope') } });
registry.registerPath({ method: 'put', path: '/owners/{id}/service-areas', tags: ['owners'], summary: 'Replace the served cities', security: bearer, request: { params: idParams, body: json(serviceAreasBody) }, responses: { 200: ok(owner, 'OwnerEnvelope'), 422: err('VALIDATION_FAILED — unknown cities') } });
registry.registerPath({ method: 'get', path: '/owners/{id}/bank-accounts', tags: ['owners'], summary: 'Payout accounts — ibanLast4 only', security: bearer, request: { params: idParams }, responses: { 200: ok(z.array(bankAccount), 'OwnerBankAccountListEnvelope') } });
registry.registerPath({ method: 'post', path: '/owners/{id}/bank-accounts', tags: ['owners'], summary: 'Add a payout account — step-up BANK_ACCOUNT required; activation after the cool-off setting', security: bearer, request: { params: idParams, headers: stepUpHeader, body: json(createBankAccountBody) }, responses: { 201: ok(bankAccount, 'OwnerBankAccountEnvelope', 'Created'), 403: err('PERM_DENIED with details.stepUpRequired'), 409: err('CONFLICT — IBAN already on the profile') } });

// ── drivers ──────────────────────────────────────────────────────────────────
registry.registerPath({ method: 'get', path: '/drivers', tags: ['drivers'], summary: 'Own drivers (owner) / self (driver) / all with drivers.read_any', security: bearer, request: { query: listDriversQuery }, responses: { 200: ok(z.array(driver), 'DriverListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'post', path: '/drivers', tags: ['drivers'], summary: 'Create a driver under the acting owner: phone-only user + profile (drivers.create)', security: bearer, request: { body: json(createDriverBody) }, responses: { 201: ok(driver, 'DriverEnvelope', 'Created'), 409: err('AUTH_IDENTIFIER_TAKEN'), 422: err('DRIVER_LICENSE_EXPIRED / OWNER_NOT_APPROVED') } });
registry.registerPath({ method: 'get', path: '/drivers/{id}', tags: ['drivers'], summary: 'Driver profile — last-4 identifiers only', security: bearer, request: { params: idParams }, responses: { 200: ok(driver, 'DriverEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'patch', path: '/drivers/{id}', tags: ['drivers'], summary: 'Licence, categories, emergency contact (drivers.update)', security: bearer, request: { params: idParams, body: json(patchDriverBody) }, responses: { 200: ok(driver, 'DriverEnvelope') } });
registry.registerPath({ method: 'post', path: '/drivers/{id}/approve', tags: ['drivers'], summary: 'Approve after verified mandatory documents and an unexpired licence (drivers.approve)', security: bearer, request: { params: idParams, body: json(driverDecisionBody) }, responses: { 200: ok(driver, 'DriverEnvelope'), 409: err('CONFLICT — already approved'), 422: err('OWNER_DOCUMENTS_INCOMPLETE (details.missing) / DRIVER_LICENSE_EXPIRED') } });
registry.registerPath({ method: 'post', path: '/drivers/{id}/reject', tags: ['drivers'], summary: 'Reject with a reason (drivers.approve)', security: bearer, request: { params: idParams, body: json(driverRejectBody) }, responses: { 200: ok(driver, 'DriverEnvelope') } });
registry.registerPath({ method: 'post', path: '/drivers/{id}/availability', tags: ['drivers'], summary: 'OFF_DUTY | AVAILABLE (self → own); ON_TRIP is system-set', security: bearer, request: { params: idParams, body: json(driverAvailabilityBody) }, responses: { 200: ok(driver, 'DriverEnvelope'), 409: err('DRIVER_ALREADY_ON_TRIP'), 422: err('DRIVER_NOT_APPROVED / DRIVER_LICENSE_EXPIRED') } });
registry.registerPath({ method: 'get', path: '/drivers/{id}/assignments', tags: ['drivers'], summary: 'Vehicle assignment history, newest first', security: bearer, request: { params: idParams }, responses: { 200: ok(z.array(assignment), 'DriverAssignmentListEnvelope') } });
registry.registerPath({ method: 'delete', path: '/drivers/{id}', tags: ['drivers'], summary: 'Deactivate (blocked on an active trip); sessions revoked', security: bearer, request: { params: idParams }, responses: { 204: { description: 'Deactivated' }, 409: err('DRIVER_ALREADY_ON_TRIP') } });

// ── spo ──────────────────────────────────────────────────────────────────────
registry.registerPath({ method: 'get', path: '/spo/profiles', tags: ['spo'], summary: 'List SPOs (spo.read)', security: bearer, request: { query: listSpoProfilesQuery }, responses: { 200: ok(z.array(spoProfile), 'SpoProfileListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'post', path: '/spo/profiles', tags: ['spo'], summary: 'Create an SPO profile on an existing user (spo.create)', security: bearer, request: { body: json(createSpoProfileBody) }, responses: { 201: ok(spoProfile, 'SpoProfileEnvelope', 'Created'), 409: err('CONFLICT') } });
registry.registerPath({ method: 'get', path: '/spo/profiles/{id}', tags: ['spo'], summary: 'One SPO', security: bearer, request: { params: idParams }, responses: { 200: ok(spoProfile, 'SpoProfileEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'patch', path: '/spo/profiles/{id}', tags: ['spo'], summary: 'Update an SPO (spo.update)', security: bearer, request: { params: idParams, body: json(patchSpoProfileBody) }, responses: { 200: ok(spoProfile, 'SpoProfileEnvelope') } });
registry.registerPath({ method: 'get', path: '/spo/profiles/{id}/customers', tags: ['spo'], summary: 'Active customer assignments (own → global)', security: bearer, request: { params: idParams }, responses: { 200: ok(z.array(spoAssignment), 'SpoCustomerAssignmentListEnvelope') } });
registry.registerPath({ method: 'post', path: '/spo/profiles/{id}/customers', tags: ['spo'], summary: 'Assign a customer (spo.update); closes any other live assignment', security: bearer, request: { params: idParams, body: json(assignSpoCustomerBody) }, responses: { 201: ok(spoAssignment, 'SpoCustomerAssignmentEnvelope', 'Created') } });
registry.registerPath({ method: 'delete', path: '/spo/profiles/{id}/customers/{customerProfileId}', tags: ['spo'], summary: 'Unassign (spo.update)', security: bearer, request: { params: spoCustomerParams }, responses: { 204: { description: 'Unassigned' }, 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'get', path: '/spo/leads', tags: ['spo'], summary: 'Lead pipeline (spo.leads.manage; own → global)', security: bearer, request: { query: listSpoLeadsQuery }, responses: { 200: ok(z.array(spoLead), 'SpoLeadListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'post', path: '/spo/leads', tags: ['spo'], summary: 'Create a lead', security: bearer, request: { body: json(createSpoLeadBody) }, responses: { 201: ok(spoLead, 'SpoLeadEnvelope', 'Created') } });
registry.registerPath({ method: 'patch', path: '/spo/leads/{id}', tags: ['spo'], summary: 'Update a lead (CONVERTED is read-only)', security: bearer, request: { params: idParams, body: json(patchSpoLeadBody) }, responses: { 200: ok(spoLead, 'SpoLeadEnvelope'), 409: err('CONFLICT') } });
registry.registerPath({ method: 'post', path: '/spo/leads/{id}/convert', tags: ['spo'], summary: 'QUALIFIED → CONVERTED: creates the customer with the attribution chain', security: bearer, request: { params: idParams, body: json(convertSpoLeadBody) }, responses: { 201: ok(z.object({ lead: spoLead, customerProfileId: z.string().uuid(), userId: z.string().uuid() }), 'SpoLeadConvertedEnvelope', 'Created'), 409: err('AUTH_IDENTIFIER_TAKEN'), 422: err('VALIDATION_FAILED — not QUALIFIED') } });
registry.registerPath({ method: 'get', path: '/spo/commissions', tags: ['spo'], summary: 'Attributed commission lines from booking_financial_snapshots (spo.commissions.read; own → global)', security: bearer, request: { query: listSpoCommissionsQuery }, responses: { 200: ok(z.array(spoCommission), 'SpoCommissionListEnvelope', 'OK — paginated') } });

// ── /me/saved-locations ──────────────────────────────────────────────────────
registry.registerPath({ method: 'get', path: '/me/saved-locations', tags: ['me'], summary: 'Customer address book', security: bearer, responses: { 200: ok(z.array(savedLocation), 'SavedLocationListEnvelope') } });
registry.registerPath({ method: 'post', path: '/me/saved-locations', tags: ['me'], summary: 'Add a saved location (customer profile required)', security: bearer, request: { body: json(savedLocationBody) }, responses: { 201: ok(savedLocation, 'SavedLocationEnvelope', 'Created'), 422: err('VALIDATION_FAILED') } });
registry.registerPath({ method: 'patch', path: '/me/saved-locations/{id}', tags: ['me'], summary: 'Update a saved location', security: bearer, request: { params: idParams, body: json(patchSavedLocationBody) }, responses: { 200: ok(savedLocation, 'SavedLocationEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'delete', path: '/me/saved-locations/{id}', tags: ['me'], summary: 'Remove a saved location', security: bearer, request: { params: idParams }, responses: { 204: { description: 'Deleted' }, 404: err('NOT_FOUND') } });
