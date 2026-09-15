import type { Request, Response } from 'express';
import type { AnyScope } from '@unigate/types';
import { sendOk } from '@/common/envelope.js';
import { getRequestId } from '@/common/request-context.js';
import { scopeFor, type AuthenticatedRequest } from '@/middleware/authenticate.js';
import type { ValidatedRequest } from '@/middleware/validate.js';
import * as service from './settings.service.js';

/** The public subset is served without a session under a SYSTEM scope restricted to PUBLIC rows. */
function publicScope(): AnyScope {
  return { kind: 'SYSTEM', jobName: 'settings.public', requestId: getRequestId() };
}

export async function listPublic(_req: Request, res: Response): Promise<void> {
  sendOk(res, await service.listPublicSettings(publicScope()));
}

export async function list(req: Request, res: Response): Promise<void> {
  const { query } = (req as ValidatedRequest<unknown, { section?: string }>).validated;
  sendOk(res, await service.listSettings(scopeFor(req, 'settings.read'), query.section));
}

export async function sections(req: Request, res: Response): Promise<void> {
  sendOk(res, await service.listSections(scopeFor(req, 'settings.read')));
}

export async function update(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest & ValidatedRequest<{ value: unknown }, unknown, { key: string }>;
  sendOk(
    res,
    await service.updateSetting(scopeFor(req, 'settings.manage'), r.validated.params.key, r.validated.body.value, r.actor.userId),
  );
}
