import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { patchMeBody, sessionIdParams } from '@unigate/validation';
import { sendNoContent, sendOk } from '@/common/envelope.js';
import { NotFoundError } from '@/common/errors.js';
import { getRequestId } from '@/common/request-context.js';
import { selfScope, type AuthenticatedRequest } from '@/middleware/authenticate.js';
import type { ValidatedRequest } from '@/middleware/validate.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { toMeDto, toSessionDto } from './iam.mapper.js';
import * as sessions from './session.repository.js';
import * as users from './user.repository.js';

/** api.md §8.2 `/me` — every route is bound to `sub`; no permission code is required. */

export async function getMe(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest;
  const u = await users.findUserById(selfScope(req), r.actor.userId);
  if (!u) throw new NotFoundError();
  sendOk(res, toMeDto(u, r.actor.permissions));
}

export async function patchMe(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest & ValidatedRequest<z.infer<typeof patchMeBody>>;
  const before = await users.findUserById(selfScope(req), r.actor.userId);
  if (!before) throw new NotFoundError();
  const b = r.validated.body;
  await users.updateSelfProfile(selfScope(req), r.actor.userId, {
    ...(b.fullNameEn !== undefined ? { fullNameEn: b.fullNameEn } : {}),
    ...(b.fullNameAr !== undefined ? { fullNameAr: b.fullNameAr } : {}),
    ...(b.preferredLocale !== undefined ? { preferredLocale: b.preferredLocale } : {}),
    ...(b.timezone !== undefined ? { timezone: b.timezone } : {}),
  });
  await writeAudit({
    actorUserId: r.actor.userId, actorType: 'USER', action: 'user.self_updated', entityType: 'user', entityId: r.actor.userId,
    beforeValue: { fullNameEn: before.fullNameEn, fullNameAr: before.fullNameAr, preferredLocale: before.preferredLocale, timezone: before.timezone },
    afterValue: { ...b }, changedFields: Object.keys(b),
  });
  const after = await users.findUserById(selfScope(req), r.actor.userId);
  if (!after) throw new NotFoundError();
  sendOk(res, toMeDto(after, r.actor.permissions));
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest;
  const rows = await sessions.listSessions(selfScope(req), r.actor.userId);
  sendOk(res, rows.map((s) => toSessionDto(s, r.actor.sessionId)));
}

export async function deleteSession(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest & ValidatedRequest<unknown, unknown, z.infer<typeof sessionIdParams>>;
  const scope = selfScope(req);
  const owned = await sessions.findSessionOwned(scope, r.actor.userId, r.validated.params.id);
  if (!owned) throw new NotFoundError(); // another user's session id → 404, never 403 (api.md §3.2)
  await sessions.revokeSession(scope, owned.id, 'USER_REVOKED');
  await writeAudit({ actorUserId: r.actor.userId, actorType: 'USER', action: 'session.revoked', entityType: 'session', entityId: owned.id, ipAddress: req.ip ?? null });
  void getRequestId();
  sendNoContent(res);
}
