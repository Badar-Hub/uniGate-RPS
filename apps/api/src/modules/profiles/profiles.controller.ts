import type { Request, Response } from 'express';
import type { z } from 'zod';
import type {
  adminCreditBody,
  statementQuery,
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
  ownerDecisionBody, ownerVerticalsBody,
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
import { paginated, sendCreated, sendNoContent, sendOk } from '@/common/envelope.js';
import { NotFoundError } from '@/common/errors.js';
import { scopeFor, selfScope, type AuthenticatedRequest } from '@/middleware/authenticate.js';
import type { ValidatedRequest } from '@/middleware/validate.js';
import * as customers from './customer.service.js';
import * as drivers from './driver.service.js';
import * as owners from './owner.service.js';
import * as saved from './saved-location.service.js';
import * as spo from './spo.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

// ── customers ─────────────────────────────────────────────────────────────────

export async function listCustomers(req: Request, res: Response): Promise<void> {
  const { query } = (req as R<unknown, z.infer<typeof listCustomersQuery>>).validated;
  const { items, total } = await customers.listCustomers(scopeFor(req, 'customers.read'), query, query);
  res.status(200).json(paginated(items, query.page, query.pageSize, total));
}
export async function createCustomer(req: Request, res: Response): Promise<void> {
  const { body } = (req as R<z.infer<typeof createCustomerBody>>).validated;
  const dto = await customers.createCustomer(scopeFor(req, 'customers.create'), body);
  sendCreated(res, dto, `/api/v1/customers/${dto.id}`);
}
export async function getCustomer(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  sendOk(res, await customers.getCustomer(scopeFor(req, 'customers.read'), params.id));
}
export async function patchCustomer(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof patchCustomerBody>, unknown, Id>).validated;
  sendOk(res, await customers.patchCustomer(scopeFor(req, 'customers.update'), params.id, body));
}
export async function upsertCorporate(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof upsertCorporateBody>, unknown, Id>).validated;
  sendOk(res, await customers.upsertCorporate(scopeFor(req, 'customers.update'), params.id, body));
}
export async function verifyCustomer(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof verifyCustomerBody>, unknown, Id>).validated;
  sendOk(res, await customers.verifyCustomer(scopeFor(req, 'customers.verify'), params.id, body.notes));
}
export async function getCredit(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  // `invoices.read` is the code the corporate customer already holds; staff reach GLOBAL through customers.read (api.md §8.4).
  sendOk(res, await customers.getCredit(scopeFor(req, 'customers.read'), params.id));
}
export async function getStatement(req: Request, res: Response): Promise<void> {
  const { params, query } = (req as R<unknown, z.infer<typeof statementQuery>, Id>).validated;
  sendOk(res, await customers.getStatement(scopeFor(req, 'customers.read'), params.id, query));
}
export async function adminCredit(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof adminCreditBody>, unknown, Id>).validated;
  sendOk(res, await customers.adminSetCredit(scopeFor(req, 'customers.verify'), params.id, body));
}
export async function adminVatNumber(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof adminVatNumberBody>, unknown, Id>).validated;
  sendOk(res, await customers.adminSetVatNumber(scopeFor(req, 'customers.verify'), params.id, body));
}

// ── owners ────────────────────────────────────────────────────────────────────

export async function listOwners(req: Request, res: Response): Promise<void> {
  const { query } = (req as R<unknown, z.infer<typeof listOwnersQuery>>).validated;
  const { items, total } = await owners.listOwners(scopeFor(req, 'owners.read'), query, query);
  res.status(200).json(paginated(items, query.page, query.pageSize, total));
}
export async function createVendor(req: Request, res: Response): Promise<void> {
  const { body } = (req as R<z.infer<typeof createVendorBody>>).validated;
  const dto = await owners.createVendor(scopeFor(req, 'owners.create'), body);
  sendCreated(res, dto);
}

export async function createOwner(req: Request, res: Response): Promise<void> {
  const { body } = (req as R<z.infer<typeof createOwnerBody>>).validated;
  const dto = await owners.createOwner(scopeFor(req, 'owners.create'), body);
  sendCreated(res, dto, `/api/v1/owners/${dto.id}`);
}
export async function getOwner(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  sendOk(res, await owners.getOwner(scopeFor(req, 'owners.read'), params.id));
}
/** GET /me/owner-profile — the owner's own profile without knowing its id. */
export async function myOwnerProfile(req: Request, res: Response): Promise<void> {
  const id = (req as AuthenticatedRequest).actor.ownerProfileId;
  if (!id) throw new NotFoundError();
  sendOk(res, await owners.getOwner(selfScope(req), id));
}
export async function patchOwner(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof patchOwnerBody>, unknown, Id>).validated;
  sendOk(res, await owners.patchOwner(scopeFor(req, 'owners.update'), params.id, body));
}
export async function submitOwner(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  sendOk(res, await owners.submitForReview(scopeFor(req), params.id));
}
export async function approveOwner(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof ownerDecisionBody>, unknown, Id>).validated;
  sendOk(res, await owners.approveOwner(scopeFor(req, 'owners.approve'), params.id, body.notes));
}
export async function setOwnerVerticals(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof ownerVerticalsBody>, unknown, Id>).validated;
  sendOk(res, await owners.setVerticals(scopeFor(req, 'owners.approve'), params.id, body.transportTypes));
}
export async function rejectOwner(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof ownerRejectBody>, unknown, Id>).validated;
  sendOk(res, await owners.rejectOwner(scopeFor(req, 'owners.approve'), params.id, body.rejectionReason));
}
export async function suspendOwner(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof ownerSuspendBody>, unknown, Id>).validated;
  sendOk(res, await owners.suspendOwner(scopeFor(req, 'owners.suspend'), params.id, body.reason));
}
export async function setServiceAreas(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof serviceAreasBody>, unknown, Id>).validated;
  sendOk(res, await owners.setServiceAreas(scopeFor(req, 'owners.update'), params.id, body.cityIds));
}
export async function listBankAccounts(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  sendOk(res, await owners.listBankAccounts(scopeFor(req, 'owners.read'), params.id));
}
export async function addBankAccount(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof createBankAccountBody>, unknown, Id>).validated;
  const dto = await owners.addBankAccount(scopeFor(req, 'owners.update'), params.id, body);
  sendCreated(res, dto);
}

// ── drivers ───────────────────────────────────────────────────────────────────

export async function listDrivers(req: Request, res: Response): Promise<void> {
  const { query } = (req as R<unknown, z.infer<typeof listDriversQuery>>).validated;
  const { items, total } = await drivers.listDrivers(scopeFor(req, 'drivers.read_any'), query, query);
  res.status(200).json(paginated(items, query.page, query.pageSize, total));
}
export async function createDriver(req: Request, res: Response): Promise<void> {
  const { body } = (req as R<z.infer<typeof createDriverBody>>).validated;
  const dto = await drivers.createDriver(scopeFor(req, 'drivers.read_any'), body);
  sendCreated(res, dto, `/api/v1/drivers/${dto.id}`);
}
export async function getDriver(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  sendOk(res, await drivers.getDriver(scopeFor(req, 'drivers.read_any'), params.id));
}
export async function patchDriver(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof patchDriverBody>, unknown, Id>).validated;
  sendOk(res, await drivers.patchDriver(scopeFor(req, 'drivers.read_any'), params.id, body));
}
export async function approveDriver(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof driverDecisionBody>, unknown, Id>).validated;
  sendOk(res, await drivers.approveDriver(scopeFor(req, 'drivers.approve'), params.id, body.notes));
}
export async function rejectDriver(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof driverRejectBody>, unknown, Id>).validated;
  sendOk(res, await drivers.rejectDriver(scopeFor(req, 'drivers.approve'), params.id, body.rejectionReason));
}
export async function driverAvailability(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof driverAvailabilityBody>, unknown, Id>).validated;
  sendOk(res, await drivers.setAvailability(scopeFor(req, 'drivers.read_any'), params.id, body.availabilityStatus));
}
export async function driverAssignments(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  sendOk(res, await drivers.listAssignments(scopeFor(req, 'drivers.read_any'), params.id));
}
export async function deactivateDriver(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  await drivers.deactivateDriver(scopeFor(req, 'drivers.read_any'), params.id);
  sendNoContent(res);
}

// ── spo ───────────────────────────────────────────────────────────────────────

export async function listSpos(req: Request, res: Response): Promise<void> {
  const { query } = (req as R<unknown, z.infer<typeof listSpoProfilesQuery>>).validated;
  const { items, total } = await spo.listSpos(scopeFor(req, 'spo.read'), query, query);
  res.status(200).json(paginated(items, query.page, query.pageSize, total));
}
export async function createSpo(req: Request, res: Response): Promise<void> {
  const { body } = (req as R<z.infer<typeof createSpoProfileBody>>).validated;
  const dto = await spo.createSpo(scopeFor(req, 'spo.create'), body);
  sendCreated(res, dto, `/api/v1/spo/profiles/${dto.id}`);
}
export async function getSpo(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  sendOk(res, await spo.getSpo(scopeFor(req, 'spo.read'), params.id));
}
export async function patchSpo(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof patchSpoProfileBody>, unknown, Id>).validated;
  sendOk(res, await spo.patchSpo(scopeFor(req, 'spo.update'), params.id, body));
}
export async function spoCustomers(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  sendOk(res, await spo.listAssignments(scopeFor(req, 'spo.update'), params.id));
}
export async function assignSpoCustomer(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof assignSpoCustomerBody>, unknown, Id>).validated;
  sendCreated(res, await spo.assignCustomer(scopeFor(req, 'spo.update'), params.id, body.customerProfileId));
}
export async function unassignSpoCustomer(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, z.infer<typeof spoCustomerParams>>).validated;
  await spo.unassignCustomer(scopeFor(req, 'spo.update'), params.id, params.customerProfileId);
  sendNoContent(res);
}
export async function listLeads(req: Request, res: Response): Promise<void> {
  const { query } = (req as R<unknown, z.infer<typeof listSpoLeadsQuery>>).validated;
  const { items, total } = await spo.listLeads(scopeFor(req, 'spo.update'), query, query);
  res.status(200).json(paginated(items, query.page, query.pageSize, total));
}
export async function createLead(req: Request, res: Response): Promise<void> {
  const { body } = (req as R<z.infer<typeof createSpoLeadBody>>).validated;
  const dto = await spo.createLead(scopeFor(req, 'spo.update'), body);
  sendCreated(res, dto, `/api/v1/spo/leads/${dto.id}`);
}
export async function patchLead(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof patchSpoLeadBody>, unknown, Id>).validated;
  sendOk(res, await spo.patchLead(scopeFor(req, 'spo.update'), params.id, body));
}
export async function convertLead(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof convertSpoLeadBody>, unknown, Id>).validated;
  sendCreated(res, await spo.convertLead(scopeFor(req, 'spo.update'), params.id, body));
}
export async function listCommissions(req: Request, res: Response): Promise<void> {
  const { query } = (req as R<unknown, z.infer<typeof listSpoCommissionsQuery>>).validated;
  const { items, total } = await spo.listCommissions(scopeFor(req, 'spo.update'), query, query);
  res.status(200).json(paginated(items, query.page, query.pageSize, total));
}

// ── /me/saved-locations ───────────────────────────────────────────────────────

export async function listSavedLocations(req: Request, res: Response): Promise<void> {
  sendOk(res, await saved.listSavedLocations(selfScope(req)));
}
export async function createSavedLocation(req: Request, res: Response): Promise<void> {
  const { body } = (req as R<z.infer<typeof savedLocationBody>>).validated;
  sendCreated(res, await saved.createSavedLocation(selfScope(req), body));
}
export async function patchSavedLocation(req: Request, res: Response): Promise<void> {
  const { params, body } = (req as R<z.infer<typeof patchSavedLocationBody>, unknown, Id>).validated;
  sendOk(res, await saved.patchSavedLocation(selfScope(req), params.id, body));
}
export async function deleteSavedLocation(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, Id>).validated;
  await saved.deleteSavedLocation(selfScope(req), params.id);
  sendNoContent(res);
}
