import type { Request, Response, NextFunction  } from "express";
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client';
import { fail } from '../utils/response';
import { logger } from '../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET ?? '';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth) return fail(res, 'AUTH_ERROR', 'No token', 401);
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return fail(res, 'AUTH_ERROR', 'Malformed token', 401);
  const token = parts[1];
  try {
    if (!JWT_SECRET) {
      logger.error('Server misconfiguration: JWT_SECRET missing');
      return fail(res, 'SERVER_ERROR', 'Server misconfiguration', 500);
    }
    const payload = (jwt as any).verify(token, JWT_SECRET);
    const profile = await prisma.usuarios.findUnique({ where: { id: Number(payload.id) } });
    if (!profile) return fail(res, 'AUTH_ERROR', 'User not found', 401);
    if (String(profile.rol).toUpperCase() === 'TRABAJADOR') {
      return fail(res, 'AUTH_ERROR', 'Forbidden', 403);
    }
    (req as any).user = { id: profile.id, role: profile.rol, email: profile.email };
    next();
  } catch (err) {
    return fail(res, 'AUTH_ERROR', 'Invalid token', 401);
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return fail(res, 'AUTH_ERROR', 'Not authenticated', 401);
    const expected = roles.map(r => r.toUpperCase());
    const actual = String(user.role).toUpperCase();
    if (!expected.includes(actual)) return fail(res, 'AUTH_ERROR', 'Forbidden', 403);
    next();
  };
}
