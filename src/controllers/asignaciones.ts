import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client';
import { success, fail } from '../utils/response';
import { suggestTopTrabajador } from '../services/HeuristicsService';
import { predictTiempoSec, storePrediccion } from '../services/MLService';
import { logger } from '../utils/logger';

// Asignación simple: actualizar Pedido con responsable
export const asignar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pedido_id, trabajador_id, origen = 'MANUAL', score_sugerencia, skill_match, tiempo_estimado_sec, comentarios } = req.body;
  if (!pedido_id) return fail(res, 'VALIDATION_ERROR', 'pedido_id requerido', 400);
  let trabajador = Number(trabajador_id);
  // Si no se especifica trabajador, sugerir uno
  if (!trabajador) {
    const sugerido = await suggestTopTrabajador(Number(pedido_id));
    if (!sugerido) return fail(res, 'NOT_FOUND', 'No hay trabajadores disponibles', 404);
    trabajador = sugerido.id;
    if (typeof score_sugerencia === 'undefined') (req as any).score_sugerencia = sugerido.score;
  }

  // Estimar tiempo si no viene
  let tEstimado = typeof tiempo_estimado_sec === 'number' ? tiempo_estimado_sec : undefined;
  if (typeof tEstimado === 'undefined') {
    tEstimado = await predictTiempoSec(Number(pedido_id), trabajador);
  }

  // Create an assignment record
  const asign = await prisma.asignaciones.create({ data: {
    pedido_id: Number(pedido_id),
    trabajador_id: Number(trabajador),
    origen,
    score_sugerencia: typeof (req as any).score_sugerencia === 'number' ? (req as any).score_sugerencia : (score_sugerencia ?? null),
    skill_match: skill_match ?? null,
    tiempo_estimado_sec: tEstimado ?? null,
    comentarios: comentarios ?? null,
  } });
  // Update pedido responsable
  await prisma.pedidos.update({ where: { id: Number(pedido_id) }, data: { responsable_id: Number(trabajador_id), estado: 'ASIGNADO' } });
  // Persist predicted time for learning history
  if (tEstimado) await storePrediccion(Number(pedido_id), trabajador, tEstimado);
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
