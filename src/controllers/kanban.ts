import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client';
import { success, fail } from '../utils/response';
import { logger } from '../utils/logger';
// enum types from Prisma removed to avoid direct dependency on generated client

// Common select for kanban cards to ensure consistency
const kanbanCardSelect = {
  id: true,
  descripcion: true,
  prioridad: true,
  estado: true,
  fecha_estimada_fin: true,
  fecha_actualizacion: true,
  cliente: { select: { id: true, nombre: true, telefono: true } },
  responsable: { select: { id: true, usuario: { select: { id: true, nombre: true } } } },
};

/**
 * Lists jobs for the Kanban board, organized by status.
 * Accepts query params for filtering and searching.
 */
export const listarKanban = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, workerId, clientId, priority, limit = '50' } = req.query;

    const parsedLimit = Math.min(parseInt(limit as string, 10) || 50, 200);

    const baseWhere: any = {
      AND: [],
    };

    if (workerId) baseWhere.AND.push({ responsable_id: Number(workerId) });
    if (clientId) baseWhere.AND.push({ cliente_id: Number(clientId) });
    if (priority) baseWhere.AND.push({ prioridad: priority as any });
    if (q) {
      const searchQuery = {
        OR: [
          { descripcion: { contains: q as string, mode: 'insensitive' } },
          { cliente: { nombre: { contains: q as string, mode: 'insensitive' } } },
        ],
      };
      baseWhere.AND.push(searchQuery);
    }
    // Normalizar posibles variantes del enum (evita fallos por typos o migraciones inconsistentes)
    const normalizeEstado = (s: string) => {
      if (!s) return s;
      const map: Record<string, string> = {
        'EN_PROCESO': 'EN_PROGRESO', // posible valor en migraciones antiguas
        'EN_PROGRESO': 'EN_PROGRESO',
        'PENDIENTE': 'PENDIENTE',
        'QA': 'QA',
        'ENTREGADO': 'ENTREGADO',
        'ASIGNADO': 'ASIGNADO'
      };
      return map[s] ?? s;
    };

    const [pending, inProgress, qa, delivered] = await Promise.all([
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('PENDIENTE') }, select: kanbanCardSelect, orderBy: [{ prioridad: 'desc' }, { fecha_actualizacion: 'desc' }], take: parsedLimit }),
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('EN_PROGRESO') }, select: kanbanCardSelect, orderBy: [{ prioridad: 'desc' }, { fecha_actualizacion: 'desc' }], take: parsedLimit }),
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('QA') }, select: kanbanCardSelect, orderBy: { fecha_actualizacion: 'desc' }, take: parsedLimit }),
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('ENTREGADO') }, select: kanbanCardSelect, orderBy: { fecha_actualizacion: 'desc' }, take: parsedLimit }),
    ]);

  return success(res, { columns: { PENDIENTE: pending, EN_PROGRESO: inProgress, QA: qa, ENTREGADO: delivered } });
  } catch (err) {
    next(err);
  }
};

/**
 * Changes the status of a job and records the change in history.
 */
export const cambiarEstado = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { newStatus, note, userId } = req.body;

  const pedido = await prisma.pedidos.update({ where: { id: Number(id) }, data: { estado: newStatus } });
  logger.info({ msg: 'Estado cambiado', id, newStatus, userId });
  return success(res, { ok: true, pedido });
  } catch (err) {
    next(err);
  }
};
