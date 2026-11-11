import express from 'express';
import type { Request, Response, NextFunction } from 'express';

/**
 * Global JSON body cap (#211). Every JSON route takes small bodies (prompts, page text,
 * cart rows; the largest realistic one is a few KB). Image upload is multipart via
 * multer (5 MB cap in routes/uploads.ts) and never touches this parser.
 */
export const JSON_BODY_LIMIT = '100kb';

export const jsonBody = express.json({ limit: JSON_BODY_LIMIT });

/**
 * Final error handler. Express recognises error middleware by the four-arg signature --
 * do NOT drop `_next`. body-parser reports an over-limit body as an error with
 * type 'entity.too.large' (status 413); without the branch below it would fall through
 * to the generic 500. We never leak err.message or err.stack; detail goes to the log.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (typeof err === 'object' && err !== null && (err as { type?: unknown }).type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }
  console.error('[express:error]', err);
  res.status(500).json({ error: 'Internal server error' });
}
