import type { Request, Response, NextFunction  } from "express";
import { prisma } from '../prisma/client';
import * as PedidoService from '../services/PedidoService';
import { success, fail } from '../utils/response';
import { UpdatePedidoSchema } from '../validators/pedidoValidator';
import { transitionEstado } from '../services/PedidoWorkflow';

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
    if (err?.name === 'ZodError') return fail(res, 'VALIDATION_ERROR', 'Error de validación', 400, err.errors);
    next(err);
  }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const parsed = UpdatePedidoSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Datos inválidos', 400, parsed.error.flatten());
    const body = parsed.data as any;
    const data: any = {};
    if (typeof body.descripcion !== 'undefined') data.descripcion = body.descripcion;
    if (typeof body.prioridad !== 'undefined') data.prioridad = body.prioridad;
    if (typeof body.precio !== 'undefined') data.precio = body.precio;
    if (typeof body.fecha_estimada_fin !== 'undefined') data.fecha_estimada_fin = body.fecha_estimada_fin ? new Date(body.fecha_estimada_fin) : null;
    if (typeof body.estado !== 'undefined') data.estado = body.estado;
    if (typeof body.responsable_id !== 'undefined') data.responsable_id = body.responsable_id;
    if (typeof body.semaforo !== 'undefined') data.semaforo = body.semaforo;
    if (typeof body.notas !== 'undefined') data.notas = body.notas;
    if (typeof body.adjuntos !== 'undefined') data.adjuntos = body.adjuntos;

    if (Object.keys(data).length === 0) return fail(res, 'VALIDATION_ERROR', 'No hay campos para actualizar', 400);

    const pedido = await prisma.pedidos.update({ where: { id }, data });
    return success(res, pedido, 200, 'Pedido actualizado');
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    await prisma.pedidos.delete({ where: { id } });
    return success(res, null, 204);
  } catch (err) { next(err); }
};

export const cambiarEstado = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { estado, note, userId } = req.body as { estado: 'PENDIENTE'|'ASIGNADO'|'EN_PROGRESO'|'QA'|'ENTREGADO'; note?: string; userId?: number };
    if (!estado) return fail(res, 'VALIDATION_ERROR', 'Debe indicar el nuevo estado', 400);
    const pedido = await transitionEstado(id, estado, { note, userId });
    return success(res, { ok: true, pedido }, 200, 'Estado actualizado');
  } catch (err) { next(err); }
};
