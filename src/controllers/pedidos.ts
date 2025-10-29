import type { Request, Response, NextFunction  } from "express";
import { prisma } from '../prisma/client';
import * as PedidoService from '../services/PedidoService';
import { success, fail } from '../utils/response';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pedidos = await prisma.pedidos.findMany({
      include: { cliente: true, responsable: true },
      orderBy: { fecha_actualizacion: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    const total = await prisma.pedidos.count();
    return success(res, { pedidos, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Number(req.params.id);
        const pedido = await prisma.pedidos.findUnique({ where: { id }, include: { cliente: true, responsable: true, asignaciones: true, tiempos: true } });
        if (!pedido) return fail(res, 'NOT_FOUND', 'Pedido no encontrado', 404);
        return success(res, pedido);
    } catch (err) { next(err); }
}

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pedido = await PedidoService.createPedido(req.body);
    return success(res, pedido, 201);
  } catch (err: any) {
    if (err?.name === 'ZodError') return fail(res, 'VALIDATION_ERROR', JSON.stringify(err.errors), 400);
    next(err);
  }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const data = req.body;
    const pedido = await prisma.pedidos.update({ where: { id }, data });
    return success(res, pedido);
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    await prisma.pedidos.delete({ where: { id } });
    return success(res, null, 204);
  } catch (err) { next(err); }
};
