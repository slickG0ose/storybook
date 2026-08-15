import { getAuthUser } from '../routes/auth';
import type { Request, Response, NextFunction } from 'express';

/**
 * Express middleware: require an authenticated user. Attaches the resolved
 * user to res.locals.user for downstream handlers. Returns 401 if there's no
 * valid token. Use this BEFORE `validate(...)` so unauthenticated callers
 * don't get request-shape feedback they're not entitled to see.
 *
 * Lives here rather than inside a route module because more than one router
 * needs it — notably the paid-API routes, where an ungated handler bills the
 * project's own Anthropic/Fal keys for anonymous callers.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.locals.user = user;
  next();
}
