import type { Request, Response, NextFunction  } from "express";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client';
import { success, fail } from '../utils/response';
import { logger } from '../utils/logger';

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    const { email, password, nombre, ci_rut, telefono, direccion } = req.body;
    const role = 'CLIENTE';

    if (!email || !password) return fail(res, 'VALIDATION_ERROR', 'email y password requeridos', 400);
    const exists = await prisma.usuarios.findUnique({ where: { email } });
    if (exists) return fail(res, 'CONFLICT', 'Email en uso', 409);
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.usuarios.create({ 
    data: { 
      email, 
      password_hash: hash, 
      rol: role as any, 
      nombre: nombre || '',
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
    
  // Avoid logging the raw JWT secret. Log creation event instead.
  logger.info({ msg: 'Creating user', email });
  if (!JWT_SECRET) { throw new Error('JWT_SECRET is not defined or empty'); }
  const token = jwt.sign({ id: user.id, role: user.rol }, JWT_SECRET as string, { expiresIn: '8h' });
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
