import { Router } from 'express';
import {
  loginBody,
  otpRequestBody,
  otpVerifyBody,
  passwordChangeBody,
  passwordForgotBody,
  passwordResetBody,
  refreshBody,
  registerBody,
  stepUpRequestBody,
  stepUpVerifyBody,
} from '@unigate/validation';
import { h } from '@/common/handler.js';
import { authenticate } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { validate } from '@/middleware/validate.js';
import * as c from './auth.controller.js';

/** api.md §8.1 `/auth`. Public routes are throttled inside the service, not by the router. */
export function authRouter(): Router {
  const r = Router({ strict: true });

  r.post('/auth/register', validate({ body: registerBody }), h(c.register));
  r.post('/auth/login', validate({ body: loginBody }), h(c.login));
  // refresh/logout may be reached with only a cookie; csrfGuard decides mode by its presence
  r.post('/auth/refresh', csrfGuard({ cookieOnlyRoute: true }), validate({ body: refreshBody }), h(c.refresh));
  r.post('/auth/logout', authenticate(), csrfGuard(), h(c.logout));
  r.post('/auth/logout-all', authenticate(), csrfGuard(), h(c.logoutAll));
  r.get('/auth/session', authenticate(), h(c.session));

  r.post('/auth/otp/request', authenticate({ optional: true }), csrfGuard(), validate({ body: otpRequestBody }), h(c.otpRequest));
  r.post('/auth/otp/verify', authenticate({ optional: true }), csrfGuard(), validate({ body: otpVerifyBody }), h(c.otpVerify));

  r.post('/auth/step-up', authenticate(), csrfGuard(), validate({ body: stepUpRequestBody }), h(c.stepUpRequest));
  r.post('/auth/step-up/verify', authenticate(), csrfGuard(), validate({ body: stepUpVerifyBody }), h(c.stepUpVerify));

  r.post('/auth/password/forgot', validate({ body: passwordForgotBody }), h(c.passwordForgot));
  r.post('/auth/password/reset', validate({ body: passwordResetBody }), h(c.passwordReset));
  r.post('/auth/password/change', authenticate(), csrfGuard(), validate({ body: passwordChangeBody }), h(c.passwordChange));

  return r;
}
