import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const trabajadores = await prisma.trabajador.findMany({ include: { asignaciones: true } });
    res.json(trabajadores);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nombre, especialidad } = req.body;
    const t = await prisma.trabajador.create({ data: { nombre, especialidad } });
    res.status(201).json(t);
  } catch (err) { next(err); }
};

export const obtener = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const id = parseInt(req.params.id as string, 10);
    const t = await prisma.trabajador.findUnique({ where: { id }, include: { asignaciones: { include: { pedido: true } } } });
    if (!t) return res.status(404).json({ error: 'No encontrado' });
    res.json(t);
  } catch (err) { next(err); }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const id = parseInt(req.params.id as string, 10);
    const { nombre, especialidad } = req.body;
    const t = await prisma.trabajador.update({ where: { id }, data: { nombre, especialidad } });
    res.json(t);
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const id = parseInt(req.params.id as string, 10);
    await prisma.trabajador.delete({ where: { id } });
    res.status(204).end();
  } catch (err) { next(err); }
};
