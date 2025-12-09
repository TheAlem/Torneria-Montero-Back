import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client.js';
import { success, fail } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { evaluateAndNotify } from '../services/KanbanMonitorService.js';
import { transitionEstado } from '../services/PedidoWorkflow.js';
import { computeSemaforoForPedido } from '../services/SemaforoService.js';

// Common select for kanban cards to ensure consistency
const kanbanCardSelect: Prisma.pedidosSelect = {
  id: true,
  titulo: true,
  descripcion: true,
  prioridad: true,
  estado: true,
  pagado: true,
  semaforo: true,
  fecha_estimada_fin: true,
  fecha_actualizacion: true,
  cliente: { select: { id: true, nombre: true, telefono: true } },
  responsable: { select: { id: true, usuario: { select: { id: true, nombre: true } } } },
  asignaciones: {
    select: { origen: true, id: true },
    orderBy: { id: Prisma.SortOrder.desc },
    take: 1,
  },
};

/**
 * Lists pedidos for the Kanban board, organized by status.
 * Accepts query params for filtering and searching.
 */
export const listarKanban = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, workerId, clientId, priority, limit = '50' } = req.query as Record<string, string | undefined>;

    const parsedLimitRaw = parseInt(String(limit), 10);
    const parsedLimit = Math.min(Number.isFinite(parsedLimitRaw) ? parsedLimitRaw : 50, 200);

    const baseWhere: any = { AND: [{ eliminado: false }] };
    const workerNum = Number(workerId);
    if (Number.isFinite(workerNum) && workerNum > 0) baseWhere.AND.push({ responsable_id: workerNum });
    const clientNum = Number(clientId);
    if (Number.isFinite(clientNum) && clientNum > 0) baseWhere.AND.push({ cliente_id: clientNum });
    const prio = priority ? String(priority).toUpperCase() : undefined;
    if (prio && ['BAJA','MEDIA','ALTA'].includes(prio)) baseWhere.AND.push({ prioridad: prio as any });
    if (q && String(q).trim()) {
      const searchQuery = {
        OR: [
          { descripcion: { contains: q as string, mode: 'insensitive' } },
          { titulo: { contains: q as string, mode: 'insensitive' } },
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

    const addAutoFlag = (arr: any[]) => arr.map((c: any) => {
      const lastAssign = Array.isArray(c.asignaciones) && c.asignaciones.length ? c.asignaciones[0] : null;
      const autoAsignado = lastAssign?.origen === 'SUGERIDO';
      const { asignaciones, ...rest } = c;
      return { ...rest, autoAsignado };
    });

    const [pendingRaw, inProgressRaw, qaRaw, deliveredRaw] = await Promise.all([
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('PENDIENTE') }, select: kanbanCardSelect, orderBy: [{ prioridad: 'desc' }, { fecha_actualizacion: 'desc' }], take: parsedLimit }),
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('EN_PROGRESO') }, select: kanbanCardSelect, orderBy: [{ prioridad: 'desc' }, { fecha_actualizacion: 'desc' }], take: parsedLimit }),
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('QA') }, select: kanbanCardSelect, orderBy: { fecha_actualizacion: 'desc' }, take: parsedLimit }),
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('ENTREGADO') }, select: kanbanCardSelect, orderBy: { fecha_actualizacion: 'desc' }, take: parsedLimit }),
    ]);

    const pending = addAutoFlag(pendingRaw);
    const inProgress = addAutoFlag(inProgressRaw);
    const qa = addAutoFlag(qaRaw);
    const delivered = addAutoFlag(deliveredRaw);

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
