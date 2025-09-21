import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workers = await prisma.worker.findMany();
    res.json(workers);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fullName } = req.body;
    if (!fullName) return res.status(400).json({ error: 'fullName required' });
    const w = await prisma.worker.create({ data: { fullName } });
    res.status(201).json(w);
  } catch (err) { next(err); }
};

export const obtener = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const w = await prisma.worker.findUnique({ where: { id }, include: { jobs: true } });
    if (!w) return res.status(404).json({ error: 'Not found' });
    res.json(w);
  } catch (err) { next(err); }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { fullName, active } = req.body;
    const w = await prisma.worker.update({ where: { id }, data: { fullName, active } });
    res.json(w);
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    await prisma.worker.delete({ where: { id } });
    res.status(204).end();
  } catch (err) { next(err); }
};
