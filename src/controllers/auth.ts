import type { Request, Response, NextFunction  } from "express";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client';
import { success, fail } from '../utils/response';
import { logger } from '../utils/logger';

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    const { email, password, nombre, ci_rut, telefono, direccion, rol } = req.body;
    const normalizedRole = String(rol || 'CLIENTE').toUpperCase();

    if (!email || !password) return fail(res, 'VALIDATION_ERROR', 'Email y contraseña requeridos', 400);
    const exists = await prisma.usuarios.findUnique({ where: { email } });
    if (exists) return fail(res, 'CONFLICT', 'Email en uso', 409);
  const hash = await bcrypt.hash(password, 10);
  let user: any;
  if (normalizedRole === 'TRABAJADOR') {
    if (!ci_rut) return fail(res, 'VALIDATION_ERROR', 'ci_rut requerido para TRABAJADOR', 400);
    user = await prisma.usuarios.create({
      data: {
        email,
        password_hash: hash,
        rol: 'TRABAJADOR' as any,
        nombre: nombre || '',
        telefono: telefono || null,
        trabajador: {
          create: {
            ci: ci_rut,
            direccion: direccion || null,
          }
        }
      },
      include: { trabajador: true }
    });
  } else {
    user = await prisma.usuarios.create({ 
      data: { 
        email, 
        password_hash: hash, 
        rol: 'CLIENTE' as any, 
        nombre: nombre || '',
        telefono: telefono || null,
        cliente: {
          create: {
            nombre: nombre || '',
            email: email,
            ci_rut: ci_rut || '',
            telefono: telefono || '',
            direccion: direccion || ''
          }
        }
      },
      include: {
        cliente: true
      }
    });
  }
    
  // Avoid logging the raw JWT secret. Log creation event instead.
  logger.info({ msg: 'Creating user', email });
  if (!JWT_SECRET) { throw new Error('JWT_SECRET is not defined or empty'); }
  const token = normalizedRole === 'TRABAJADOR' ? null : jwt.sign({ id: user.id, role: user.rol }, JWT_SECRET as string, { expiresIn: '8h' });
  return success(res, { token, profile: { id: user.id, email: user.email, role: user.rol } }, 201);
  } catch (err) { next(err); }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    const { email, password } = req.body;
    const user = await prisma.usuarios.findUnique({ where: { email } });
    if (!user) return fail(res, 'AUTH_ERROR', 'Credenciales inválidas', 401);
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return fail(res, 'AUTH_ERROR', 'Credenciales inválidas', 401);
    const token = jwt.sign({ id: user.id, role: user.rol }, JWT_SECRET as string, { expiresIn: '8h' });
    return success(res, { token, profile: { id: user.id, email: user.email, role: user.rol } });
  } catch (err) { next(err); }
};

export const adminCreate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, nombre, ci_rut, telefono, direccion, rol, rol_tecnico } = req.body as any;
    if (!email || !password || !rol) return fail(res, 'VALIDATION_ERROR', 'email, password y rol requeridos', 400);
    const normalizedRole = String(rol).toUpperCase();
    if (!['TRABAJADOR','TORNERO','ADMIN'].includes(normalizedRole)) {
      return fail(res, 'VALIDATION_ERROR', 'Solo se permite crear roles TORNERO, TRABAJADOR o ADMIN', 400);
    }
    const exists = await prisma.usuarios.findUnique({ where: { email } });
    if (exists) return fail(res, 'CONFLICT', 'Email en uso', 409);
    const hash = await bcrypt.hash(password, 10);

    let user: any;
    if (normalizedRole === 'TRABAJADOR') {
      if (!ci_rut) return fail(res, 'VALIDATION_ERROR', 'ci_rut requerido para TRABAJADOR', 400);
      user = await prisma.usuarios.create({
        data: {
          email,
          password_hash: hash,
          rol: 'TRABAJADOR' as any,
          nombre: nombre || '',
          telefono: telefono || null,
          trabajador: {
            create: {
              ci: ci_rut,
              direccion: direccion || null,
              rol_tecnico: rol_tecnico || null,
            }
          }
        },
        include: { trabajador: true }
      });
    } else if (normalizedRole === 'TORNERO') {
      // TORNERO
      user = await prisma.usuarios.create({
        data: {
          email,
          password_hash: hash,
          rol: 'TORNERO' as any,
          nombre: nombre || '',
          telefono: telefono || null,
          // opcionalmente crear registro trabajador si se pasa ci_rut
          ...(ci_rut ? { trabajador: { create: { ci: ci_rut, direccion: direccion || null, rol_tecnico: rol_tecnico || null } } } : {})
        },
        include: { trabajador: true }
      });
    } else {
      // ADMIN
      user = await prisma.usuarios.create({
        data: {
          email,
          password_hash: hash,
          rol: 'ADMIN' as any,
          nombre: nombre || '',
          telefono: telefono || null,
        }
      });
    }
    return success(res, { profile: { id: user.id, email: user.email, role: user.rol }, trabajador: user.trabajador || null }, 201);
  } catch (err) { next(err); }
};
