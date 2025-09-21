import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clients = await prisma.client.findMany();
    res.json(clients);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, address, company } = req.body;
    if (!name || !phone || !address) return res.status(400).json({ error: 'name, phone and address are required' });
    const client = await prisma.client.create({ data: { name, email: email || null, phone, address, company: company || null } });
    res.status(201).json(client);
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Unique constraint violation' });
    next(err);
  }
};

export const obtener = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const client = await prisma.client.findUnique({ where: { id }, include: { jobs: true, appAccount: true } });
    if (!client) return res.status(404).json({ error: 'Not found' });
    res.json(client);
  } catch (err) { next(err); }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { name, email, phone, address, company } = req.body;
    const client = await prisma.client.update({ where: { id }, data: { name, email, phone, address, company } });
    res.json(client);
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    await prisma.client.delete({ where: { id } });
    res.status(204).end();
  } catch (err) { next(err); }
};
