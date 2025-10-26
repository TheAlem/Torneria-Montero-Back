import type { Request, Response, NextFunction  } from "express";
import { prisma } from '../prisma/client';
import * as JobService from '../services/jobService';
import { success, fail } from '../utils/response';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const pedidos = await prisma.pedidos.findMany({ include: { cliente: true, responsable: true }, orderBy: { fecha_actualizacion: 'desc' } });
  return success(res, pedidos);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.body.descripcion) {
      return fail(res, 'VALIDATION_ERROR', 'El campo descripcion es obligatorio', 400);
    }

    const body = {
      descripcion: req.body.descripcion,
      prioridad: req.body.prioridad || 'MEDIA',
      cliente_id: parseInt(req.body.cliente_id),
      responsable_id: req.body.responsable_id ? parseInt(req.body.responsable_id) : undefined,
      fecha_estimada_fin: req.body.fecha_estimada_fin ? new Date(req.body.fecha_estimada_fin) : null,
      precio: req.body.precio ? parseFloat(req.body.precio) : null,
    } as any;
  const pedido = await JobService.createJob(body);
  return success(res, pedido, 201);
  } catch (err) { next(err); }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const data: any = {};
    const updatable = ['descripcion', 'prioridad', 'precio', 'estado', 'notas', 'semaforo'];
    updatable.forEach(k => { if ((req.body as any)[k] !== undefined) data[k] = (req.body as any)[k]; });
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
