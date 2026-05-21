import { Router } from 'express';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../db/prisma';
import type { Request, Response } from 'express';

const router = Router();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return salt + ':' + hash;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const check = createHash('sha256').update(salt + password).digest('hex');
  return check === hash;
}

export async function getAuthUser(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  // Reject soft-deleted users: their tokens stop authenticating once an admin
  // tombstones them, but rows remain so an admin can restore later.
  return prisma.user.findFirst({ where: { token, deleted_at: null } });
}

/**
 * Returns the authed user when they are also an admin; null otherwise.
 * Callers decide whether the null case is a 401 (no auth) or 403 (wrong role)
 * by checking getAuthUser themselves if they care to distinguish.
 */
export async function requireAdmin(req: Request) {
  const user = await getAuthUser(req);
  if (!user) return null;
  if (user.role !== 'admin') return null;
  return user;
}

router.post('/register', async (req: Request, res: Response) => {
  const { email, name, password } = req.body as { email?: string; name?: string; password?: string };

  if (!email || !name || !password) {
    return res.status(400).json({ error: 'email, name, and password are required' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const existing = await prisma.user.findFirst({ where: { email, deleted_at: null } });
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const token = uuidv4();
  const user = await prisma.user.create({
    data: {
      email,
      name,
      password_hash: hashPassword(password),
      token,
    },
  });

  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, token });
});

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // Soft-deleted users should not be able to log in; treat them like a missing
  // account so we don't leak that the row still exists.
  const user = await prisma.user.findFirst({ where: { email, deleted_at: null } });

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = uuidv4();
  await prisma.user.update({ where: { id: user.id }, data: { token } });

  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, token });
});

router.post('/logout', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (user) {
    await prisma.user.update({ where: { id: user.id }, data: { token: null } });
  }
  res.json({ ok: true });
});

router.get('/me', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

export default router;
