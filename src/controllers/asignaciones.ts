import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';

export const asignar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pedidoId, trabajadorId } = req.body;
    const asignacion = await prisma.pedidoAsignado.create({ data: { pedidoId, trabajadorId } });
    res.status(201).json(asignacion);
  } catch (err) { next(err); }
};

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asigs = await prisma.pedidoAsignado.findMany({ include: { pedido: true, trabajador: true }, orderBy: { fechaAsignacion: 'desc' } });
    res.json(asigs);
  } catch (err) { next(err); }
};
