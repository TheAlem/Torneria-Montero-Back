import type { Request, Response, NextFunction  } from "express";
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client.js';
import { fail } from '../utils/response.js';
import { logger } from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET ?? '';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  // Permitir token por query para SSE/EventSource (no soporta headers personalizados)
  const tokenFromQuery = (req.query?.token || req.query?.access_token) as string | undefined;
  let token: string | undefined;
  if (auth) {
    const parts = auth.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return fail(res, 'AUTH_ERROR', 'Token malformado', 401);
    token = parts[1];
  } else if (typeof tokenFromQuery === 'string' && tokenFromQuery.length > 0) {
    token = tokenFromQuery;
  } else {
    return fail(res, 'AUTH_ERROR', 'Token no provisto', 401);
  }
  try {
    if (!JWT_SECRET) {
      logger.error('Configuración del servidor inválida: falta JWT_SECRET');
      return fail(res, 'SERVER_ERROR', 'Configuración del servidor inválida', 500);
    }
    const payload = (jwt as any).verify(token, JWT_SECRET) as any;
    const userId = Number(payload?.id);
    if (!Number.isFinite(userId)) return fail(res, 'AUTH_ERROR', 'Token inválido', 401);

    const tokenRole = String(payload?.role ?? payload?.rol ?? '').toUpperCase();
    if (tokenRole) {
      if (tokenRole === 'TRABAJADOR') return fail(res, 'AUTH_ERROR', 'Acceso denegado', 403);
      (req as any).user = { id: userId, role: tokenRole, email: payload?.email ?? null };
      return next();
    }

    // Fallback para tokens legacy sin role: consulta única a DB.
    const profile = await prisma.usuarios.findUnique({
      where: { id: userId },
      select: { id: true, rol: true, email: true },
    });
    if (!profile) return fail(res, 'AUTH_ERROR', 'Usuario no encontrado', 401);
    if (String(profile.rol).toUpperCase() === 'TRABAJADOR') return fail(res, 'AUTH_ERROR', 'Acceso denegado', 403);
    (req as any).user = { id: profile.id, role: String(profile.rol).toUpperCase(), email: profile.email };
    next();
  } catch (err) {
    return fail(res, 'AUTH_ERROR', 'Token inválido', 401);
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return fail(res, 'AUTH_ERROR', 'No autenticado', 401);
    const expected = roles.map(r => r.toUpperCase());
    const actual = String(user.role).toUpperCase();
    if (!expected.includes(actual)) return fail(res, 'AUTH_ERROR', 'Acceso denegado', 403);
    next();
  };
}
