import { Router } from 'express';
import {
  createRoleBody,
  createUserBody,
  listUsersQuery,
  patchMeBody,
  patchUserBody,
  roleCodeParams,
  sessionIdParams,
  setUserPermissionsBody,
  setUserRolesBody,
  suspendUserBody,
  updateRoleBody,
  userIdParams,
} from '@unigate/validation';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { requireStepUp } from '@/middleware/step-up.js';
import { validate } from '@/middleware/validate.js';
import * as admin from './admin.controller.js';
import * as me from './me.controller.js';

/** api.md §8.2 `/me` — self scope, no permission codes. */
export function meRouter(): Router {
  const r = Router({ strict: true });
  // Path-scoped on purpose: a bare router.use() would run for EVERY request passing through the
  // router, including public routes mounted later (settings/public, reference catalogue).
  r.use('/me', authenticate(), csrfGuard());
  r.get('/me', h(me.getMe));
  r.patch('/me', validate({ body: patchMeBody }), h(me.patchMe));
  r.get('/me/sessions', h(me.listSessions));
  r.delete('/me/sessions/:id', validate({ params: sessionIdParams }), h(me.deleteSession));
  return r;
}

/**
 * api.md §8.3 `/users` and the role catalogue. Every route: authenticate → csrf →
 * requirePermission (layer 1) → validate → controller, which builds the GLOBAL scope (layer 2).
 * Role and permission-assignment mutations are step-up protected (security.md §3.6 ROLE_CHANGE).
 */
export function adminIamRouter(): Router {
  const r = Router({ strict: true });
  // Path-scoped on purpose: a bare router.use() would run for EVERY request passing through the
  // router, including public routes mounted later (settings/public, reference catalogue).
  r.use(['/users', '/roles', '/permissions'], authenticate(), csrfGuard());

  r.get('/users', requirePermission('users.read'), validate({ query: listUsersQuery }), h(admin.listUsers));
  r.post('/users', requirePermission('users.create'), idempotent({ required: false }), validate({ body: createUserBody }), h(admin.createUser));
  r.get('/users/:id', requirePermission('users.read'), validate({ params: userIdParams }), h(admin.getUser));
  r.patch('/users/:id', requirePermission('users.update'), validate({ params: userIdParams, body: patchUserBody }), h(admin.patchUser));
  r.delete('/users/:id', requirePermission('users.delete'), validate({ params: userIdParams }), h(admin.deleteUser));
  r.post('/users/:id/suspend', requirePermission('users.suspend'), validate({ params: userIdParams, body: suspendUserBody }), h(admin.suspendUser));
  r.post('/users/:id/reactivate', requirePermission('users.suspend'), validate({ params: userIdParams, body: suspendUserBody }), h(admin.reactivateUser));
  r.put('/users/:id/roles', requirePermission('permissions.assign'), requireStepUp('ROLE_CHANGE'), validate({ params: userIdParams, body: setUserRolesBody }), h(admin.setUserRoles));
  // Per-user overrides on top of roles (vendor access control): read is permissions.assign; write is step-up protected like a role change.
  r.get('/users/:id/permissions', requirePermission('permissions.assign'), validate({ params: userIdParams }), h(admin.getUserPermissions));
  r.put('/users/:id/permissions', requirePermission('permissions.assign'), requireStepUp('ROLE_CHANGE'), validate({ params: userIdParams, body: setUserPermissionsBody }), h(admin.setUserPermissions));

  r.get('/roles', requirePermission('roles.read'), h(admin.listRoles));
  r.post('/roles', requirePermission('roles.manage'), requireStepUp('ROLE_CHANGE'), validate({ body: createRoleBody }), h(admin.createRole));
  r.patch('/roles/:code', requirePermission('roles.manage'), requireStepUp('ROLE_CHANGE'), validate({ params: roleCodeParams, body: updateRoleBody }), h(admin.updateRole));
  r.delete('/roles/:code', requirePermission('roles.manage'), requireStepUp('ROLE_CHANGE'), validate({ params: roleCodeParams }), h(admin.deleteRole));
  r.get('/permissions', requirePermission('permissions.read'), h(admin.listPermissions));

  return r;
}
