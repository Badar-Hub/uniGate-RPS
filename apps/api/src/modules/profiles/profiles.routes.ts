import { Router } from 'express';
import {
  adminCreditBody,
  adminVatNumberBody,
  assignSpoCustomerBody,
  convertSpoLeadBody,
  createBankAccountBody,
  createCustomerBody,
  createDriverBody,
  createOwnerBody,
  createVendorBody,
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
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, requirePermissionOrProfile } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { requireStepUp } from '@/middleware/step-up.js';
import { validate } from '@/middleware/validate.js';
import * as c from './profiles.controller.js';

/**
 * api.md §8.4–§8.7 and the /me address book. "own → global" rows use requirePermissionOrProfile:
 * the staff code opens GLOBAL scope, the profile holder passes with OWN scope, and the
 * repository's WHERE clause does the rest (out of scope = 404).
 */
export function profilesRouter(): Router {
  const r = Router({ strict: true });
  // Path-scoped on purpose: a bare router.use() would run for EVERY request passing through the
  // router, including public routes mounted later (settings/public, reference catalogue).
  r.use(['/customers', '/owners', '/drivers', '/spo', '/me', '/admin'], authenticate(), csrfGuard());

  // ── customers ─────────────────────────────────────────────────────────────
  r.get('/customers', requirePermission('customers.read'), validate({ query: listCustomersQuery }), h(c.listCustomers));
  r.post('/customers', requirePermission('customers.create'), idempotent({ required: false }), validate({ body: createCustomerBody }), h(c.createCustomer));
  r.get('/customers/:id', requirePermissionOrProfile('customers.read', 'customer'), validate({ params: idParams }), h(c.getCustomer));
  r.patch('/customers/:id', requirePermissionOrProfile('customers.update', 'customer'), validate({ params: idParams, body: patchCustomerBody }), h(c.patchCustomer));
  r.put('/customers/:id/corporate', requirePermissionOrProfile('customers.update', 'customer'), validate({ params: idParams, body: upsertCorporateBody }), h(c.upsertCorporate));
  r.post('/customers/:id/verify', requirePermission('customers.verify'), validate({ params: idParams, body: verifyCustomerBody }), h(c.verifyCustomer));
  r.get('/customers/:id/credit', requirePermission('invoices.read'), validate({ params: idParams }), h(c.getCredit));
  // UniGate adds vendors (A: only admins onboard third-party owners); both codes are ADMIN/SUPER_ADMIN only.
  r.post('/admin/vendors', requirePermission('users.create', 'owners.create'), idempotent({ required: false }), validate({ body: createVendorBody }), h(c.createVendor));
  r.patch('/admin/customers/:id/credit', requirePermission('customers.verify'), validate({ params: idParams, body: adminCreditBody }), h(c.adminCredit));
  r.patch('/admin/customers/:id/vat-number', requirePermission('customers.verify'), validate({ params: idParams, body: adminVatNumberBody }), h(c.adminVatNumber));

  // ── owners ────────────────────────────────────────────────────────────────
  r.get('/me/owner-profile', h(c.myOwnerProfile));
  r.get('/owners', requirePermission('owners.read'), validate({ query: listOwnersQuery }), h(c.listOwners));
  r.post('/owners', requirePermission('owners.create'), validate({ body: createOwnerBody }), h(c.createOwner));
  r.get('/owners/:id', requirePermissionOrProfile('owners.read', 'owner'), validate({ params: idParams }), h(c.getOwner));
  r.patch('/owners/:id', requirePermissionOrProfile('owners.update', 'owner'), validate({ params: idParams, body: patchOwnerBody }), h(c.patchOwner));
  r.post('/owners/:id/submit-for-review', requirePermissionOrProfile('owners.update', 'owner'), validate({ params: idParams }), h(c.submitOwner));
  r.post('/owners/:id/approve', requirePermission('owners.approve'), validate({ params: idParams, body: ownerDecisionBody }), h(c.approveOwner));
  r.post('/owners/:id/reject', requirePermission('owners.approve'), validate({ params: idParams, body: ownerRejectBody }), h(c.rejectOwner));
  r.post('/owners/:id/suspend', requirePermission('owners.suspend'), validate({ params: idParams, body: ownerSuspendBody }), h(c.suspendOwner));
  r.put('/owners/:id/service-areas', requirePermissionOrProfile('owners.update', 'owner'), validate({ params: idParams, body: serviceAreasBody }), h(c.setServiceAreas));
  r.get('/owners/:id/bank-accounts', requirePermissionOrProfile('settlements.read', 'owner'), validate({ params: idParams }), h(c.listBankAccounts));
  // Payout redirection is the highest-value fraud vector: step-up on every add (api.md §8.5).
  r.post('/owners/:id/bank-accounts', requirePermissionOrProfile('owners.update', 'owner'), requireStepUp('BANK_ACCOUNT'), validate({ params: idParams, body: createBankAccountBody }), h(c.addBankAccount));

  // ── drivers ───────────────────────────────────────────────────────────────
  r.get('/drivers', requirePermissionOrProfile('drivers.read', 'driver'), validate({ query: listDriversQuery }), h(c.listDrivers));
  r.post('/drivers', requirePermission('drivers.create'), idempotent({ required: false }), validate({ body: createDriverBody }), h(c.createDriver));
  r.get('/drivers/:id', requirePermissionOrProfile('drivers.read', 'driver'), validate({ params: idParams }), h(c.getDriver));
  r.patch('/drivers/:id', requirePermission('drivers.update'), validate({ params: idParams, body: patchDriverBody }), h(c.patchDriver));
  r.post('/drivers/:id/approve', requirePermission('drivers.approve'), validate({ params: idParams, body: driverDecisionBody }), h(c.approveDriver));
  r.post('/drivers/:id/reject', requirePermission('drivers.approve'), validate({ params: idParams, body: driverRejectBody }), h(c.rejectDriver));
  r.post('/drivers/:id/availability', requirePermissionOrProfile('drivers.update', 'driver'), validate({ params: idParams, body: driverAvailabilityBody }), h(c.driverAvailability));
  r.get('/drivers/:id/assignments', requirePermissionOrProfile('drivers.read', 'driver'), validate({ params: idParams }), h(c.driverAssignments));
  r.delete('/drivers/:id', requirePermission('drivers.update'), validate({ params: idParams }), h(c.deactivateDriver));

  // ── spo ───────────────────────────────────────────────────────────────────
  r.get('/spo/profiles', requirePermission('spo.read'), validate({ query: listSpoProfilesQuery }), h(c.listSpos));
  r.post('/spo/profiles', requirePermission('spo.create'), validate({ body: createSpoProfileBody }), h(c.createSpo));
  r.get('/spo/leads', requirePermission('spo.leads.manage'), validate({ query: listSpoLeadsQuery }), h(c.listLeads));
  r.post('/spo/leads', requirePermission('spo.leads.manage'), validate({ body: createSpoLeadBody }), h(c.createLead));
  r.patch('/spo/leads/:id', requirePermission('spo.leads.manage'), validate({ params: idParams, body: patchSpoLeadBody }), h(c.patchLead));
  r.post('/spo/leads/:id/convert', requirePermission('spo.leads.manage'), idempotent({ required: false }), validate({ params: idParams, body: convertSpoLeadBody }), h(c.convertLead));
  r.get('/spo/commissions', requirePermission('spo.commissions.read'), validate({ query: listSpoCommissionsQuery }), h(c.listCommissions));
  r.get('/spo/profiles/:id', requirePermission('spo.read'), validate({ params: idParams }), h(c.getSpo));
  r.patch('/spo/profiles/:id', requirePermission('spo.update'), validate({ params: idParams, body: patchSpoProfileBody }), h(c.patchSpo));
  r.get('/spo/profiles/:id/customers', requirePermission('spo.read'), validate({ params: idParams }), h(c.spoCustomers));
  r.post('/spo/profiles/:id/customers', requirePermission('spo.update'), validate({ params: idParams, body: assignSpoCustomerBody }), h(c.assignSpoCustomer));
  r.delete('/spo/profiles/:id/customers/:customerProfileId', requirePermission('spo.update'), validate({ params: spoCustomerParams }), h(c.unassignSpoCustomer));

  // ── /me/saved-locations ───────────────────────────────────────────────────
  r.get('/me/saved-locations', h(c.listSavedLocations));
  r.post('/me/saved-locations', validate({ body: savedLocationBody }), h(c.createSavedLocation));
  r.patch('/me/saved-locations/:id', validate({ params: idParams, body: patchSavedLocationBody }), h(c.patchSavedLocation));
  r.delete('/me/saved-locations/:id', validate({ params: idParams }), h(c.deleteSavedLocation));

  return r;
}
