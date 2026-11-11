import type { Request, Response, NextFunction } from 'express';

const OFF_VALUES = new Set(['false', '0', 'off', 'no']);

/**
 * Commerce kill switch (#216, pairs with the client's `VITE_COMMERCE_ENABLED`,
 * ADR-036). Commerce is OFF only for an explicit `false` / `0` / `off` / `no`
 * (trimmed, case-insensitive). Unset, blank or anything else is ON, so a typo
 * can never silently take the store down. Read per call so tests can flip it.
 */
export function commerceEnabled(): boolean {
  const raw = process.env.COMMERCE_ENABLED;
  if (raw === undefined) return true;
  return !OFF_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Mount on the cart and orders routers. When commerce is off every route under
 * them answers 503 (not 404: the routes exist, the feature is paused) with a
 * stable `code` the client can key on.
 */
export function commerceGate(_req: Request, res: Response, next: NextFunction): void {
  if (commerceEnabled()) {
    next();
    return;
  }
  res.status(503).json({
    error: 'Commerce is currently disabled.',
    code: 'COMMERCE_DISABLED',
  });
}
