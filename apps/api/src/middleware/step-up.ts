import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { StepUpActionClass } from '@unigate/validation';
import { ForbiddenError } from '@/common/errors.js';
import { isAuthenticated } from '@/middleware/authenticate.js';
import { consumeStepUpToken } from '@/modules/iam/otp.service.js';

export const STEP_UP_HEADER = 'x-step-up-token';

/**
 * requireStepUp('<actionClass>') — security.md §3.6. The protected route needs a fresh,
 * single-use step-up token bound to this session and action class. Absence or mismatch is
 * PERM_DENIED with details.stepUpRequired = true, which the client renders as an OTP prompt.
 */
export function requireStepUp(actionClass: StepUpActionClass): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!isAuthenticated(req)) {
      next(new ForbiddenError('PERM_DENIED', 'Authentication required'));
      return;
    }
    const token = req.header(STEP_UP_HEADER);
    if (!token) {
      next(
        new ForbiddenError('PERM_DENIED', 'This action requires step-up verification', {
          stepUpRequired: true,
          actionClass,
        }),
      );
      return;
    }
    consumeStepUpToken(req.actor.userId, req.actor.sessionId ?? '', actionClass, token).then(
      (ok) => {
        if (ok) next();
        else
          next(
            new ForbiddenError('PERM_DENIED', 'Step-up token is invalid or expired', {
              stepUpRequired: true,
              actionClass,
            }),
          );
      },
      next,
    );
  };
}
