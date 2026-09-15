import type { Request, RequestHandler, Response } from 'express';

/** Wraps an async controller so rejections reach the terminal error middleware. */
export function h(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
