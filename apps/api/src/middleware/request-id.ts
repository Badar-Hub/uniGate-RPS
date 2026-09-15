import type { NextFunction, Request, Response } from 'express';
import { validate as isUuid } from 'uuid';
import { HEADER_REQUEST_ID } from '@unigate/types';
import { newId } from '@/common/ids.js';
import { runWithContext } from '@/common/request-context.js';

/**
 * api.md §1.2 — the client may send X-Request-Id (UUID). If absent or malformed we generate
 * one. It is echoed on the response, included in every log line via AsyncLocalStorage and
 * returned as error.requestId on failures.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.header(HEADER_REQUEST_ID);
  const id = supplied && isUuid(supplied) ? supplied : newId();
  res.setHeader(HEADER_REQUEST_ID, id);
  (req as Request & { id: string }).id = id;
  runWithContext({ requestId: id, userId: null, sessionId: null, startedAt: Date.now() }, () => { next(); });
}
