import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client';
import { success, fail } from '../utils/response';
import { logger } from '../utils/logger';

// Asignación simple: actualizar Pedido con responsable
export const asignar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pedido_id, trabajador_id, origen = 'MANUAL', score_sugerencia, skill_match, tiempo_estimado_sec, comentarios } = req.body;
  if (!pedido_id || !trabajador_id) return fail(res, 'VALIDATION_ERROR', 'pedido_id and trabajador_id required', 400);
    // Create an assignment record
    const asign = await prisma.asignaciones.create({ data: {
      pedido_id: Number(pedido_id),
      trabajador_id: Number(trabajador_id),
      origen,
      score_sugerencia: score_sugerencia ?? null,
      skill_match: skill_match ?? null,
      tiempo_estimado_sec: tiempo_estimado_sec ?? null,
      comentarios: comentarios ?? null,
    } });
  // Update pedido responsable
  await prisma.pedidos.update({ where: { id: Number(pedido_id) }, data: { responsable_id: Number(trabajador_id), estado: 'ASIGNADO' } });
  logger.info({ msg: 'Asignación creada', asign });
  return success(res, asign, 201);
  } catch (err) { next(err); }
};

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const asigns = await prisma.asignaciones.findMany({ include: { pedido: true, trabajador: true }, orderBy: { fecha_asignacion: 'desc' } });
  return success(res, asigns);
  } catch (err) { next(err); }
};
