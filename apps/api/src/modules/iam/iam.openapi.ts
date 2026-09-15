/**
 * OpenAPI registrations for the IAM module (api.md §8.1–§8.4): /auth, /me, /users, /roles,
 * /permissions. Request schemas are the same Zod objects that validate the routes; response
 * schemas mirror the DTOs in @unigate/types (never Prisma entities).
 */
import { z } from 'zod';
import {
  createRoleBody,
  createUserBody,
  listUsersQuery,
  loginBody,
  otpRequestBody,
  otpVerifyBody,
  passwordChangeBody,
  passwordForgotBody,
  passwordResetBody,
  patchMeBody,
  patchUserBody,
  refreshBody,
  registerBody,
  roleCodeParams,
  sessionIdParams,
  setUserPermissionsBody, setUserRolesBody,
  stepUpRequestBody,
  stepUpVerifyBody,
  suspendUserBody,
  updateRoleBody,
  userIdParams,
} from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({
  description,
  content: { 'application/json': { schema: successEnvelope(schema, name) } },
});
const bearer = [{ bearerAuth: [] }];
const clientTypeEnum = z.enum(['WEB', 'IOS', 'ANDROID']);

// ── Schemas (mirror @unigate/types DTOs) ────────────────────────────────────────────────────
const tokenPair = z
  .object({ accessToken: z.string(), refreshToken: z.string(), accessTokenExpiresAt: z.string().datetime(), refreshTokenExpiresAt: z.string().datetime() })
  .openapi('TokenPair');
const authResult = z
  .object({
    userId: z.string().uuid(),
    sessionId: z.string().uuid(),
    clientType: clientTypeEnum,
    roles: z.array(z.string()),
    tokens: tokenPair.nullable().openapi({ description: 'null for WEB sessions — tokens travel in httpOnly cookies (ug_at / ug_rt)' }),
  })
  .openapi('AuthResult');
const registerResult = z
  .object({ userId: z.string().uuid(), status: z.literal('PENDING_VERIFICATION'), otpSentTo: z.string().openapi({ description: 'masked destination' }) })
  .openapi('RegisterResult');
const otpRequestResult = z
  .object({ sentTo: z.string(), expiresInSeconds: z.number().int(), resendAfterSeconds: z.number().int() })
  .openapi('OtpRequestResult');
const stepUpRequested = otpRequestResult.extend({ actionClass: z.string() }).openapi('StepUpRequested');
const stepUpResult = z.object({ stepUpToken: z.string(), actionClass: z.string(), expiresInSeconds: z.number().int() }).openapi('StepUpResult');
const sessionEcho = z
  .object({ userId: z.string().uuid(), sessionId: z.string().uuid(), roles: z.array(z.string()), clientType: clientTypeEnum, expiresAt: z.string().datetime() })
  .openapi('SessionEcho');
const session = z
  .object({
    id: z.string().uuid(),
    deviceName: z.string().nullable(),
    clientType: clientTypeEnum,
    ipAddress: z.string().nullable(),
    createdAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    isCurrent: z.boolean(),
  })
  .openapi('Session');
const profileSummary = z
  .object({
    customer: z.object({ id: z.string().uuid(), customerType: z.string() }).nullable(),
    owner: z.object({ id: z.string().uuid(), onboardingStatus: z.string(), isPlatformFleet: z.boolean() }).nullable(),
    driver: z.object({ id: z.string().uuid(), approvalStatus: z.string() }).nullable(),
    spo: z.object({ id: z.string().uuid(), employeeCode: z.string() }).nullable(),
  })
  .openapi('ProfileSummary');
const userCore = {
  id: z.string().uuid(),
  email: z.string().nullable(),
  emailVerifiedAt: z.string().datetime().nullable(),
  phoneE164: z.string().nullable(),
  phoneVerifiedAt: z.string().datetime().nullable(),
  fullNameEn: z.string(),
  fullNameAr: z.string().nullable(),
  status: z.string(),
  preferredLocale: z.enum(['ar', 'en']),
  timezone: z.string(),
  roles: z.array(z.string()),
  permissionVersion: z.number().int(),
  profiles: profileSummary,
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
};
const me = z.object({ ...userCore, permissions: z.array(z.string()) }).openapi('Me');
const userAdmin = z
  .object({ ...userCore, phoneE164: z.string().nullable(), updatedAt: z.string().datetime(), deletedAt: z.string().datetime().nullable() })
  .openapi('UserAdmin');
const role = z
  .object({
    code: z.string(),
    nameEn: z.string(),
    nameAr: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    permissionCodes: z.array(z.string()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Role');
const permission = z
  .object({ code: z.string(), module: z.string(), descriptionEn: z.string(), descriptionAr: z.string(), isAssignable: z.boolean() })
  .openapi('Permission');

const stepUpHeader = z.object({ 'x-step-up-token': z.string().openapi({ description: 'Single-use token from POST /auth/step-up/verify for this action class' }) });

// ── /auth ───────────────────────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'post', path: '/auth/register', tags: ['auth'], summary: 'Start registration; sends a REGISTRATION OTP to the phone',
  request: { body: { content: { 'application/json': { schema: registerBody } } } },
  responses: { 201: ok(registerResult, 'RegisterResultEnvelope', 'Created'), 409: err('AUTH_IDENTIFIER_TAKEN'), 422: err('AUTH_PASSWORD_POLICY / VALIDATION_FAILED'), 429: err('AUTH_OTP_THROTTLED') },
});
registry.registerPath({
  method: 'post', path: '/auth/login', tags: ['auth'], summary: 'Password login (WEB → cookies, mobile → tokens in body)',
  request: { body: { content: { 'application/json': { schema: loginBody } } } },
  responses: { 200: ok(authResult, 'AuthResultEnvelope'), 401: err('AUTH_INVALID_CREDENTIALS'), 403: err('AUTH_ACCOUNT_SUSPENDED / AUTH_PHONE_NOT_VERIFIED'), 429: err('AUTH_ACCOUNT_LOCKED') },
});
registry.registerPath({
  method: 'post', path: '/auth/refresh', tags: ['auth'], summary: 'Rotate the refresh token (cookie ug_rt or body). Replay revokes the whole family.',
  request: { body: { content: { 'application/json': { schema: refreshBody } } } },
  responses: { 200: ok(authResult, 'AuthResultEnvelope'), 401: err('AUTH_TOKEN_INVALID / AUTH_REFRESH_REUSE_DETECTED / AUTH_SESSION_REVOKED') },
});
registry.registerPath({
  method: 'post', path: '/auth/logout', tags: ['auth'], summary: 'Revoke the current session', security: bearer,
  responses: { 204: { description: 'Logged out' }, 401: err('AUTH_TOKEN_MISSING') },
});
registry.registerPath({
  method: 'post', path: '/auth/logout-all', tags: ['auth'], summary: 'Revoke every session of the caller', security: bearer,
  responses: { 200: ok(z.object({ revokedSessions: z.number().int() }), 'LogoutAllEnvelope'), 401: err('AUTH_TOKEN_MISSING') },
});
registry.registerPath({
  method: 'get', path: '/auth/session', tags: ['auth'], summary: 'Echo the current session (cheap liveness check for the web app)', security: bearer,
  responses: { 200: ok(sessionEcho, 'SessionEchoEnvelope'), 401: err('AUTH_TOKEN_EXPIRED / AUTH_SESSION_REVOKED / AUTH_PASSWORD_CHANGED') },
});
registry.registerPath({
  method: 'post', path: '/auth/otp/request', tags: ['auth'], summary: 'Send an OTP (REGISTRATION, LOGIN, PHONE_VERIFICATION, PASSWORD_RESET)',
  request: { body: { content: { 'application/json': { schema: otpRequestBody } } } },
  responses: { 200: ok(otpRequestResult, 'OtpRequestResultEnvelope'), 422: err('AUTH_OTP_DESTINATION_NOT_ALLOWED / VALIDATION_FAILED'), 429: err('AUTH_OTP_THROTTLED') },
});
registry.registerPath({
  method: 'post', path: '/auth/otp/verify', tags: ['auth'], summary: 'Verify an OTP; REGISTRATION / LOGIN open a session',
  request: { body: { content: { 'application/json': { schema: otpVerifyBody } } } },
  responses: { 200: ok(z.union([authResult, z.object({ verified: z.literal(true) })]), 'OtpVerifyEnvelope'), 422: err('AUTH_OTP_INVALID'), 429: err('AUTH_OTP_THROTTLED / AUTH_OTP_MAX_ATTEMPTS') },
});
registry.registerPath({
  method: 'post', path: '/auth/step-up', tags: ['auth'], summary: 'Send a SENSITIVE_ACTION code to the caller’s verified phone', security: bearer,
  request: { body: { content: { 'application/json': { schema: stepUpRequestBody } } } },
  responses: { 200: ok(stepUpRequested, 'StepUpRequestedEnvelope'), 403: err('AUTH_PHONE_NOT_VERIFIED'), 429: err('AUTH_OTP_THROTTLED') },
});
registry.registerPath({
  method: 'post', path: '/auth/step-up/verify', tags: ['auth'], summary: 'Exchange the code for a single-use 5-minute step-up token', security: bearer,
  request: { body: { content: { 'application/json': { schema: stepUpVerifyBody } } } },
  responses: { 200: ok(stepUpResult, 'StepUpResultEnvelope'), 422: err('AUTH_OTP_INVALID') },
});
registry.registerPath({
  method: 'post', path: '/auth/password/forgot', tags: ['auth'], summary: 'Always 200; sends a reset link/code only if the identifier exists',
  request: { body: { content: { 'application/json': { schema: passwordForgotBody } } } },
  responses: { 200: ok(z.object({ accepted: z.literal(true) }), 'PasswordForgotEnvelope') },
});
registry.registerPath({
  method: 'post', path: '/auth/password/reset', tags: ['auth'], summary: 'Consume a reset token once; revokes every session',
  request: { body: { content: { 'application/json': { schema: passwordResetBody } } } },
  responses: { 200: ok(z.object({ reset: z.literal(true) }), 'PasswordResetEnvelope'), 422: err('AUTH_PASSWORD_RESET_INVALID / AUTH_PASSWORD_POLICY') },
});
registry.registerPath({
  method: 'post', path: '/auth/password/change', tags: ['auth'], summary: 'Change password; revokes other sessions and re-issues this session’s access token', security: bearer,
  request: { body: { content: { 'application/json': { schema: passwordChangeBody } } } },
  responses: {
    200: ok(z.object({ changed: z.literal(true), accessToken: z.string().nullable().openapi({ description: 'null in cookie mode (cookie was re-set)' }), accessTokenExpiresAt: z.string().datetime().optional() }), 'PasswordChangeEnvelope'),
    401: err('AUTH_INVALID_CREDENTIALS'),
    422: err('AUTH_PASSWORD_POLICY'),
  },
});

// ── /me ─────────────────────────────────────────────────────────────────────────────────────
registry.registerPath({ method: 'get', path: '/me', tags: ['me'], summary: 'The caller’s profile, roles and effective permissions', security: bearer, responses: { 200: ok(me, 'MeEnvelope') } });
registry.registerPath({
  method: 'patch', path: '/me', tags: ['me'], summary: 'Update own name, locale, timezone', security: bearer,
  request: { body: { content: { 'application/json': { schema: patchMeBody } } } },
  responses: { 200: ok(me, 'MeEnvelope') },
});
registry.registerPath({ method: 'get', path: '/me/sessions', tags: ['me'], summary: 'Active sessions of the caller', security: bearer, responses: { 200: ok(z.array(session), 'SessionListEnvelope') } });
registry.registerPath({
  method: 'delete', path: '/me/sessions/{id}', tags: ['me'], summary: 'Revoke one of the caller’s sessions', security: bearer,
  request: { params: sessionIdParams },
  responses: { 204: { description: 'Revoked' }, 404: err('NOT_FOUND') },
});

// ── /users (admin) ───────────────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/users', tags: ['users'], summary: 'List users (users.read)', security: bearer,
  request: { query: listUsersQuery },
  responses: { 200: ok(z.array(userAdmin), 'UserAdminListEnvelope', 'OK — paginated (meta.page/pageSize/totalItems/totalPages)'), 403: err('PERM_DENIED') },
});
registry.registerPath({
  method: 'post', path: '/users', tags: ['users'], summary: 'Create a staff or end user (users.create; Idempotency-Key honoured)', security: bearer,
  request: { body: { content: { 'application/json': { schema: createUserBody } } } },
  responses: { 201: ok(userAdmin, 'UserAdminEnvelope', 'Created'), 409: err('AUTH_IDENTIFIER_TAKEN'), 422: err('AUTH_PASSWORD_POLICY / VALIDATION_FAILED') },
});
registry.registerPath({
  method: 'get', path: '/users/{id}', tags: ['users'], summary: 'One user (users.read)', security: bearer,
  request: { params: userIdParams },
  responses: { 200: ok(userAdmin, 'UserAdminEnvelope'), 404: err('NOT_FOUND') },
});
registry.registerPath({
  method: 'patch', path: '/users/{id}', tags: ['users'], summary: 'Update a user (users.update)', security: bearer,
  request: { params: userIdParams, body: { content: { 'application/json': { schema: patchUserBody } } } },
  responses: { 200: ok(userAdmin, 'UserAdminEnvelope'), 404: err('NOT_FOUND') },
});
registry.registerPath({
  method: 'delete', path: '/users/{id}', tags: ['users'], summary: 'Soft-delete a user (users.delete)', security: bearer,
  request: { params: userIdParams },
  responses: { 204: { description: 'Deleted' }, 404: err('NOT_FOUND'), 422: err('PERM_SELF_MODIFICATION') },
});
registry.registerPath({
  method: 'post', path: '/users/{id}/suspend', tags: ['users'], summary: 'Suspend a user and revoke their sessions (users.suspend)', security: bearer,
  request: { params: userIdParams, body: { content: { 'application/json': { schema: suspendUserBody } } } },
  responses: { 200: ok(userAdmin, 'UserAdminEnvelope'), 422: err('PERM_SELF_MODIFICATION') },
});
registry.registerPath({
  method: 'post', path: '/users/{id}/reactivate', tags: ['users'], summary: 'Reactivate a suspended user (users.suspend)', security: bearer,
  request: { params: userIdParams, body: { content: { 'application/json': { schema: suspendUserBody } } } },
  responses: { 200: ok(userAdmin, 'UserAdminEnvelope') },
});
const userPermissions = z.object({ userId: z.string().uuid(), roles: z.array(z.string()), fromRoles: z.array(z.string()), granted: z.array(z.string()), denied: z.array(z.string()), effective: z.array(z.string()), catalogue: z.array(z.object({ code: z.string(), module: z.string(), action: z.string(), descriptionEn: z.string(), descriptionAr: z.string() })) }).openapi('UserPermissions');
registry.registerPath({ method: 'get', path: '/users/{id}/permissions', tags: ['users'], summary: 'A user’s effective access: roles, per-user overrides (grant/deny) and the assignable catalogue (permissions.assign)', security: bearer, request: { params: userIdParams }, responses: { 200: ok(userPermissions, 'UserPermissionsEnvelope') } });
registry.registerPath({
  method: 'put', path: '/users/{id}/permissions', tags: ['users'], summary: 'Replace a user’s permission overrides on top of their roles (permissions.assign + step-up ROLE_CHANGE). An admin may only grant what they hold; audited SECURITY; bumps permission_version', security: bearer,
  request: { params: userIdParams, headers: stepUpHeader, body: { content: { 'application/json': { schema: setUserPermissionsBody } } } },
  responses: { 200: ok(userPermissions, 'UserPermissionsEnvelope'), 403: err('PERMISSION_NOT_HELD / PERM_DENIED (step-up)'), 422: err('PERM_SELF_MODIFICATION / VALIDATION_FAILED') },
});
registry.registerPath({
  method: 'put', path: '/users/{id}/roles', tags: ['users'], summary: 'Replace a user’s roles (permissions.assign + step-up ROLE_CHANGE); bumps permission_version', security: bearer,
  request: { params: userIdParams, headers: stepUpHeader, body: { content: { 'application/json': { schema: setUserRolesBody } } } },
  responses: { 200: ok(userAdmin, 'UserAdminEnvelope'), 403: err('PERM_DENIED with details.stepUpRequired = true and details.actionClass'), 422: err('PERM_SELF_MODIFICATION / VALIDATION_FAILED') },
});

// ── /roles, /permissions ─────────────────────────────────────────────────────────────────────
registry.registerPath({ method: 'get', path: '/roles', tags: ['roles'], summary: 'List roles with their permission codes (roles.read)', security: bearer, responses: { 200: ok(z.array(role), 'RoleListEnvelope') } });
registry.registerPath({
  method: 'post', path: '/roles', tags: ['roles'], summary: 'Create a custom role (roles.manage + step-up ROLE_CHANGE)', security: bearer,
  request: { headers: stepUpHeader, body: { content: { 'application/json': { schema: createRoleBody } } } },
  responses: { 201: ok(role, 'RoleEnvelope', 'Created'), 403: err('PERM_DENIED (step-up)'), 409: err('CONFLICT — role code exists') },
});
registry.registerPath({
  method: 'patch', path: '/roles/{code}', tags: ['roles'], summary: 'Update a role (roles.manage + step-up); system roles keep their code', security: bearer,
  request: { params: roleCodeParams, headers: stepUpHeader, body: { content: { 'application/json': { schema: updateRoleBody } } } },
  responses: { 200: ok(role, 'RoleEnvelope'), 403: err('PERM_DENIED (step-up)'), 404: err('NOT_FOUND'), 409: err('PERM_ROLE_IMMUTABLE') },
});
registry.registerPath({
  method: 'delete', path: '/roles/{code}', tags: ['roles'], summary: 'Delete a custom role (roles.manage + step-up); system roles cannot be deleted', security: bearer,
  request: { params: roleCodeParams, headers: stepUpHeader },
  responses: { 204: { description: 'Deleted' }, 403: err('PERM_DENIED (step-up)'), 409: err('PERM_ROLE_IMMUTABLE / CONFLICT — role still assigned') },
});
registry.registerPath({ method: 'get', path: '/permissions', tags: ['permissions'], summary: 'Permission catalogue (permissions.read)', security: bearer, responses: { 200: ok(z.array(permission), 'PermissionListEnvelope') } });
