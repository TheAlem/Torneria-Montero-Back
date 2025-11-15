import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';
import { success, fail } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { evaluateAndNotify } from '../services/KanbanMonitorService.js';
import { transitionEstado } from '../services/PedidoWorkflow.js';
import { computeSemaforoForPedido } from '../services/SemaforoService.js';

// Common select for kanban cards to ensure consistency
const kanbanCardSelect = {
  id: true,
  descripcion: true,
  prioridad: true,
  estado: true,
  semaforo: true,
  fecha_estimada_fin: true,
  fecha_actualizacion: true,
  cliente: { select: { id: true, nombre: true, telefono: true } },
  responsable: { select: { id: true, usuario: { select: { id: true, nombre: true } } } },
};

/**
 * Lists pedidos for the Kanban board, organized by status.
 * Accepts query params for filtering and searching.
 */
export const listarKanban = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, workerId, clientId, priority, limit = '50' } = req.query as Record<string, string | undefined>;

    const parsedLimit = Math.min(parseInt(String(limit), 10) || 50, 200);

    const baseWhere: any = { AND: [{ eliminado: false }] };
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

    // Normalize legacy enum variants
    const normalizeEstado = (s: string) => {
      if (!s) return s;
      const map: Record<string, string> = {
        EN_PROCESO: 'EN_PROGRESO',
        EN_PROGRESO: 'EN_PROGRESO',
        PENDIENTE: 'PENDIENTE',
        QA: 'QA',
        ENTREGADO: 'ENTREGADO',
        ASIGNADO: 'ASIGNADO',
      } as any;
      return (map as any)[s] ?? s;
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
 * Changes the status of a pedido and records the change in history.
 */
export const cambiarEstado = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as any;
    const { newStatus, note, userId } = req.body || {};

    const pedido = await transitionEstado(Number(id), newStatus, { note, userId });
    // Metrics for tooltip
    let semaforoMetrics: any = null;
    try { semaforoMetrics = await computeSemaforoForPedido(Number(id)); } catch {}
    logger.info({ msg: '[Kanban] Estado cambiado', id, newStatus, userId });
    return success(res, { ok: true, pedido, semaforo: semaforoMetrics?.color ?? pedido?.semaforo ?? null, metrics: semaforoMetrics });
  } catch (err) {
    next(err);
  }
};

/**
 * Triggers a semaphore evaluation and notifications (ADMIN / operator).
 */
export const evaluarSemaforo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // By default evaluamos con auto-reasignación activa; se puede forzar modo sugerencia con autoReassign=false.
    const autoReassign = String((req.query?.autoReassign as string) || 'true').toLowerCase() !== 'false';
    const result = await evaluateAndNotify({ autoReassign });
    const checked = Number((result as any)?.checked ?? 0);
    const affectedArr = Array.isArray((result as any)?.affected) ? (result as any).affected : [];
    const affectedCount = affectedArr.length;
    const responseData = { processed: checked, delayed: affectedCount, checked, affectedCount, total: checked, totalChecked: checked, requiresAttention: affectedCount, affected: affectedArr, result };
    return success(res, responseData, 200, 'Evaluación completada');
  } catch (err) { next(err); }
};
