import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client.js';
import { success, fail, fieldsValidation } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    const { email, password, nombre, ci_rut, telefono, direccion, rol } = req.body as any;
    const normalizedRole = String(rol || 'CLIENTE').toUpperCase();

    if (!email || !password) {
      const errors: any = {};
      if (!email) errors.email = 'El email es obligatorio.';
      if (!password) errors.password = 'La contraseña es obligatoria.';
      return fieldsValidation(res, errors);
    }

    const exists = await prisma.usuarios.findUnique({ where: { email } });
    if (exists) return fail(res, 'CONFLICT', 'Email en uso', 409);

    const hash = await bcrypt.hash(password, 10);
    let user: any;
    if (normalizedRole === 'TRABAJADOR') {
      if (!ci_rut) return fieldsValidation(res, { ci_rut: 'El campo ci_rut es obligatorio para TRABAJADOR.' });
      user = await prisma.usuarios.create({
        data: {
          email,
          password_hash: hash,
          rol: 'TRABAJADOR' as any,
          nombre: nombre || '',
          telefono: telefono || null,
          trabajador: { create: { ci: ci_rut, direccion: direccion || null } }
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
              email,
              ci_rut: ci_rut || '',
              telefono: telefono || '',
              direccion: direccion || ''
            }
          }
        },
        include: { cliente: true }
      });
    }

    logger.info({ msg: 'Creating user', email });
    if (!JWT_SECRET) { throw new Error('JWT_SECRET is not defined or empty'); }
    const token = normalizedRole === 'TRABAJADOR' ? null : (jwt as any).sign({ id: user.id, role: user.rol }, JWT_SECRET, { expiresIn: '8h' });
    return success(res, { token, profile: { id: user.id, email: user.email, role: user.rol } }, 201);
  } catch (err) { next(err); }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    const { email, password } = req.body as any;
    const user = await prisma.usuarios.findUnique({ where: { email } });
    if (!user) return fail(res, 'AUTH_ERROR', 'Credenciales inválidas', 401);
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return fail(res, 'AUTH_ERROR', 'Credenciales inválidas', 401);
    const token = (jwt as any).sign({ id: user.id, role: user.rol }, JWT_SECRET, { expiresIn: '8h' });
    return success(res, { token, profile: { id: user.id, email: user.email, role: user.rol } });
  } catch (err) { next(err); }
};

export const adminCreate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, nombre, ci_rut, telefono, direccion, rol, rol_tecnico, skills, disponibilidad } = req.body as any;
    if (!email || !password || !rol) {
      const errors: any = {};
      if (!email) errors.email = 'El email es obligatorio.';
      if (!password) errors.password = 'La contraseña es obligatoria.';
      if (!rol) errors.rol = 'El rol es obligatorio.';
      return fieldsValidation(res, errors);
    }
    const normalizedRole = String(rol).toUpperCase();
    if (!['TRABAJADOR','TORNERO','ADMIN'].includes(normalizedRole)) {
      return fail(res, 'VALIDATION_ERROR', 'Solo se permite crear roles TORNERO, TRABAJADOR o ADMIN', 400);
    }
    const exists = await prisma.usuarios.findUnique({ where: { email } });
    if (exists) return fail(res, 'CONFLICT', 'Email en uso', 409);
    const hash = await bcrypt.hash(password, 10);

    let user: any;
    if (normalizedRole === 'TRABAJADOR') {
      if (!ci_rut) return fieldsValidation(res, { ci_rut: 'El campo ci_rut es obligatorio para TRABAJADOR.' });
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
              ...(typeof skills !== 'undefined' ? { skills } : {}),
              ...(typeof disponibilidad !== 'undefined' ? { disponibilidad } : {}),
            }
          }
        },
        include: { trabajador: true }
      });
    } else if (normalizedRole === 'TORNERO') {
      user = await prisma.usuarios.create({
        data: {
          email,
          password_hash: hash,
          rol: 'TORNERO' as any,
          nombre: nombre || '',
          telefono: telefono || null,
          ...(ci_rut ? {
            trabajador: {
              create: {
                ci: ci_rut,
                direccion: direccion || null,
                rol_tecnico: rol_tecnico || null,
                ...(typeof skills !== 'undefined' ? { skills } : {}),
                ...(typeof disponibilidad !== 'undefined' ? { disponibilidad } : {}),
              }
            }
          } : {})
        },
        include: { trabajador: true }
      });
    } else {
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

