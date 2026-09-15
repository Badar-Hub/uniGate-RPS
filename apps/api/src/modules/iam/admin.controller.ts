import type { Request, Response } from 'express';
import type { z } from 'zod';
import type {
  createRoleBody,
  createUserBody,
  listUsersQuery,
  patchUserBody,
  roleCodeParams,
  setUserRolesBody,
  suspendUserBody,
  updateRoleBody,
  userIdParams,
} from '@unigate/validation';
import { paginated, sendCreated, sendNoContent, sendOk } from '@/common/envelope.js';
import { scopeFor } from '@/middleware/authenticate.js';
import type { ValidatedRequest } from '@/middleware/validate.js';
import * as admin from './admin.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;

export async function listUsers(req: Request, res: Response): Promise<void> {
  const { query } = (req as R<unknown, z.infer<typeof listUsersQuery>>).validated;
  const { items, total } = await admin.listUsers(scopeFor(req, 'users.read'), query, query);
  res.status(200).json(paginated(items, query.page, query.pageSize, total));
}

export async function getUser(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, z.infer<typeof userIdParams>>).validated;
  sendOk(res, await admin.getUser(scopeFor(req, 'users.read'), params.id));
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const { body } = (req as R<z.infer<typeof createUserBody>>).validated;
  const dto = await admin.createUser(scopeFor(req, 'users.create'), body);
  sendCreated(res, dto, `/api/v1/users/${dto.id}`);
}

export async function patchUser(req: Request, res: Response): Promise<void> {
  const { body, params } = (req as R<z.infer<typeof patchUserBody>, unknown, z.infer<typeof userIdParams>>).validated;
  sendOk(res, await admin.patchUser(scopeFor(req, 'users.update'), params.id, body));
}

export async function suspendUser(req: Request, res: Response): Promise<void> {
  const { body, params } = (req as R<z.infer<typeof suspendUserBody>, unknown, z.infer<typeof userIdParams>>).validated;
  sendOk(res, await admin.suspendUser(scopeFor(req, 'users.suspend'), params.id, body.reason, true));
}

export async function reactivateUser(req: Request, res: Response): Promise<void> {
  const { body, params } = (req as R<z.infer<typeof suspendUserBody>, unknown, z.infer<typeof userIdParams>>).validated;
  sendOk(res, await admin.suspendUser(scopeFor(req, 'users.suspend'), params.id, body.reason, false));
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, z.infer<typeof userIdParams>>).validated;
  await admin.deleteUser(scopeFor(req, 'users.delete'), params.id);
  sendNoContent(res);
}

export async function setUserRoles(req: Request, res: Response): Promise<void> {
  const { body, params } = (req as R<z.infer<typeof setUserRolesBody>, unknown, z.infer<typeof userIdParams>>).validated;
  sendOk(res, await admin.setUserRoles(scopeFor(req, 'permissions.assign'), params.id, body.roleCodes));
}

export async function listRoles(_req: Request, res: Response): Promise<void> {
  sendOk(res, await admin.listRoles());
}

export async function listPermissions(_req: Request, res: Response): Promise<void> {
  sendOk(res, await admin.listPermissions());
}

export async function createRole(req: Request, res: Response): Promise<void> {
  const { body } = (req as R<z.infer<typeof createRoleBody>>).validated;
  const dto = await admin.createRole(scopeFor(req, 'roles.manage'), body);
  sendCreated(res, dto, `/api/v1/roles/${dto.code}`);
}

export async function updateRole(req: Request, res: Response): Promise<void> {
  const { body, params } = (req as R<z.infer<typeof updateRoleBody>, unknown, z.infer<typeof roleCodeParams>>).validated;
  sendOk(res, await admin.updateRole(scopeFor(req, 'roles.manage'), params.code, body));
}

export async function deleteRole(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, z.infer<typeof roleCodeParams>>).validated;
  await admin.deleteRole(scopeFor(req, 'roles.manage'), params.code);
  sendNoContent(res);
}
