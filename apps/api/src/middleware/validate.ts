import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { ValidationError } from '@/common/errors.js';

/**
 * api.md P4 — every request is parsed by Zod before the controller runs. The parsed value is
 * attached to `req.validated`; the raw body is never read again. Unknown keys on write bodies
 * are rejected by the schema (`.strict()`), not silently stripped.
 */
export interface ValidatedRequest<B = unknown, Q = unknown, P = unknown> extends Request {
  validated: { body: B; query: Q; params: P };
}

interface Schemas<B extends ZodTypeAny, Q extends ZodTypeAny, P extends ZodTypeAny> {
  body?: B;
  query?: Q;
  params?: P;
}

export function validate<B extends ZodTypeAny, Q extends ZodTypeAny, P extends ZodTypeAny>(
  schemas: Schemas<B, Q, P>,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const fieldErrors: Record<string, string[]> = {};
    const formErrors: string[] = [];
    const out: { body?: unknown; query?: unknown; params?: unknown } = {};

    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (result.success) {
        out[part] = result.data;
        continue;
      }
      for (const issue of result.error.issues) {
        const path = issue.path.length ? `${part === 'body' ? '' : `${part}.`}${issue.path.join('.')}` : part;
        if (issue.path.length === 0 && part === 'body') formErrors.push(issue.message);
        else (fieldErrors[path] ??= []).push(issue.message);
      }
    }

    if (Object.keys(fieldErrors).length || formErrors.length) {
      next(new ValidationError('Request failed validation', { fieldErrors, formErrors }));
      return;
    }
    (req as ValidatedRequest).validated = {
      body: out.body,
      query: out.query,
      params: out.params,
    };
    next();
  };
}
