import type { Request, Response, NextFunction  } from "express";
import { prisma } from '../prisma/client';
import { success, fail } from '../utils/response';
import { logger } from '../utils/logger';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workers = await prisma.trabajadores.findMany({ include: { usuario: true } });
    return success(res, workers);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { usuario_id, ci, direccion, rol_tecnico } = req.body;
    if (!usuario_id || !ci) return fail(res, 'VALIDATION_ERROR', 'usuario_id and ci required', 400);
    const w = await prisma.trabajadores.create({ data: { usuario_id: Number(usuario_id), ci, direccion, rol_tecnico } });
    logger.info({ msg: 'Trabajador creado', id: w.id });
    return success(res, w, 201);
  } catch (err) { next(err); }
};

export const obtener = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const w = await prisma.trabajadores.findUnique({ where: { id }, include: { pedidosResponsable: true } });
    if (!w) return fail(res, 'NOT_FOUND', 'Not found', 404);
    return success(res, w);
  } catch (err) { next(err); }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { direccion, rol_tecnico, estado } = req.body;
    const w = await prisma.trabajadores.update({ where: { id }, data: { direccion, rol_tecnico, estado } });
    return success(res, w);
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    await prisma.trabajadores.delete({ where: { id } });
    return success(res, null, 204);
  } catch (err) { next(err); }
};

export const listarActivos = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const workers = await prisma.trabajadores.findMany({ where: { estado: 'Activo' }, include: { usuario: true } });
  return success(res, workers.map((w: any) => ({ id: w.id, nombre: w.usuario?.nombre || null })));
  } catch (err) { next(err); }
};
