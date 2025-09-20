import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pedidos = await prisma.pedido.findMany({ include: { cliente: true, asignaciones: { include: { trabajador: true } } }, orderBy: { fecha: 'desc' } });
    res.json(pedidos);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clienteId, trabajo, monto } = req.body;
    const pedido = await prisma.pedido.create({ data: { clienteId, trabajo, monto, estado: 'pendiente' } });
    res.status(201).json(pedido);
  } catch (err) { next(err); }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const id = parseInt(req.params.id as string, 10);
    const data: any = {};
    const updatable = ['trabajo', 'monto', 'estado'];
    updatable.forEach(k => { if ((req.body as any)[k] !== undefined) data[k] = (req.body as any)[k]; });
    const pedido = await prisma.pedido.update({ where: { id }, data });
    res.json(pedido);
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const id = parseInt(req.params.id as string, 10);
    await prisma.pedido.delete({ where: { id } });
    res.status(204).end();
  } catch (err) { next(err); }
};
