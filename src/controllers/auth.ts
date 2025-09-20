import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client.js';

const JWT_SECRET = process.env.JWT_SECRET as string;

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, role = 'cliente', nombre } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' });
    const exists = await prisma.profile.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: 'Email en uso' });
    const hash = await bcrypt.hash(password, 10);
    const profile = await prisma.profile.create({ data: { email, password: hash, role: role as any, nombre } });
  const token = jwt.sign({ id: profile.id, role: profile.role }, JWT_SECRET as string, { expiresIn: '8h' });
    res.status(201).json({ token, profile: { id: profile.id, email: profile.email, role: profile.role } });
  } catch (err) { next(err); }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const profile = await prisma.profile.findUnique({ where: { email } });
    if (!profile) return res.status(401).json({ error: 'Credenciales inválidas' });
    const ok = await bcrypt.compare(password, profile.password);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
  const token = jwt.sign({ id: profile.id, role: profile.role }, JWT_SECRET as string, { expiresIn: '8h' });
    res.json({ token, profile: { id: profile.id, email: profile.email, role: profile.role } });
  } catch (err) { next(err); }
};
