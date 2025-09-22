import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client.js';

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    const { email, password, role: rawRole, nombre } = req.body;
    const role = (rawRole || 'CLIENTE').toUpperCase();
    if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' });
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: 'Email en uso' });
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, password: hash, role: role as any, fullName: nombre } });
  console.log('Auth JWT_SECRET:', JWT_SECRET);
  if (!JWT_SECRET) { throw new Error('JWT_SECRET is not defined or empty'); }
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET as string, { expiresIn: '8h' });
    res.status(201).json({ token, profile: { id: user.id, email: user.email, role: user.role } });
  } catch (err) { next(err); }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET as string, { expiresIn: '8h' });
    res.json({ token, profile: { id: user.id, email: user.email, role: user.role } });
  } catch (err) { next(err); }
};
