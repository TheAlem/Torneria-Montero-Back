import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client.js';

const JWT_SECRET = process.env.JWT_SECRET ?? '';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Malformed token' });
  const token = parts[1];
  try {
    if (!JWT_SECRET) {
      return res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET missing' });
    }
  const payload = (jwt as any).verify(token, JWT_SECRET);
    const profile = await prisma.profile.findUnique({ where: { id: payload.id } });
    if (!profile) return res.status(401).json({ error: 'User not found' });
    (req as any).user = { id: profile.id, role: profile.role, email: profile.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
