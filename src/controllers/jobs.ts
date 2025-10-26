import type { Request, Response, NextFunction  } from "express";
import { CreateJobSchema } from '../validators/jobValidator';
import * as JobService from '../services/jobService';
import { prisma } from '../prisma/client';
import { success, fail } from '../utils/response';

export const createJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const parsed = CreateJobSchema.parse(req.body);
  const job = await JobService.createJob(parsed);
  return success(res, job, 201);
  } catch (err: any) {
    if (err?.name === 'ZodError') return fail(res, 'VALIDATION_ERROR', JSON.stringify(err.errors), 400);
    next(err);
  }
};

export const getJobByCode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.params.code;
    if (!code) return fail(res, 'VALIDATION_ERROR', 'code required', 400);
  // In the new schema we don't use 'code' — find by id if numeric, otherwise return 400
  return fail(res, 'NOT_IMPLEMENTED', 'Buscar por código ya no está soportado. Use /pedidos/:id', 400);
  } catch (err) { next(err); }
};

export const listJobs = async (req: Request, res: Response, next: NextFunction) => {
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

export const updateJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id required', 400);
  const data = req.body;
  const pedido = await prisma.pedidos.update({ where: { id: Number(id) }, data });
  return success(res, pedido);
  } catch (err) { next(err); }
};

export const deleteJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id required', 400);
  await prisma.pedidos.delete({ where: { id: Number(id) } });
  return success(res, null, 204);
  } catch (err) { next(err); }
};

export const listWorkers = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const workers = await prisma.trabajadores.findMany({ where: { estado: 'Activo' }, include: { usuario: true } });
  return success(res, workers.map((w: any) => ({ id: w.id, nombre: w.usuario?.nombre || null })));
  } catch (err) { next(err); }
};