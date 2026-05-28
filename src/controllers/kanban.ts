import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client.js';
import { success } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { envFlag, parseEnvBool } from '../utils/env.js';
import { evaluateAndNotify } from '../services/KanbanMonitorService.js';
import { transitionEstado } from '../services/PedidoWorkflow.js';
import { computeSemaforoForPedido } from '../services/SemaforoService.js';
import { clearReportCache } from './reportes.js';

const kanbanCardSelect: Prisma.pedidosSelect = {
  id: true,
  titulo: true,
  descripcion: true,
  prioridad: true,
  estado: true,
  pagado: true,
  semaforo: true,
  fecha_inicio: true,
  fecha_estimada_fin: true,
  fecha_actualizacion: true,
  tiempo_estimado_sec: true,
  tiempo_real_sec: true,
  cliente: { select: { id: true, nombre: true, telefono: true } },
  responsable: { select: { id: true, rol_tecnico: true, usuario: { select: { id: true, nombre: true } } } },
  asignaciones: {
    select: { origen: true, id: true },
    orderBy: { id: Prisma.SortOrder.desc },
    take: 1,
  },
};

const normalizeEstado = (estado: string) => {
  const map: Record<string, string> = {
    EN_PROCESO: 'EN_PROGRESO',
    EN_PROGRESO: 'EN_PROGRESO',
    PENDIENTE: 'PENDIENTE',
    ASIGNADO: 'ASIGNADO',
    QA: 'QA',
    ENTREGADO: 'ENTREGADO',
  };
  return map[estado] ?? estado;
};

async function formatKanbanCard(card: any, includeMetrics: boolean) {
  const lastAssign = Array.isArray(card.asignaciones) && card.asignaciones.length ? card.asignaciones[0] : null;
  const autoAsignado = lastAssign?.origen === 'SUGERIDO';
  const { asignaciones, ...rest } = card;

  if (!includeMetrics) {
    return {
      ...rest,
      semaforo: rest.estado === 'ENTREGADO' ? 'VERDE' : rest.semaforo,
      autoAsignado,
    };
  }

  try {
    const metrics = await computeSemaforoForPedido(card.id);
    return {
      ...rest,
      semaforo: metrics.color,
      lastSemaforo: metrics,
      autoAsignado,
    };
  } catch (err) {
    logger.warn({ msg: '[Kanban] metrics skipped', pedidoId: card.id, err: (err as any)?.message });
    return {
      ...rest,
      semaforo: rest.estado === 'ENTREGADO' ? 'VERDE' : rest.semaforo,
      autoAsignado,
    };
  }
}

export const listarKanban = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      q,
      workerId,
      clientId,
      priority,
      limit = '50',
      includeMetrics,
    } = req.query as Record<string, string | undefined>;

    const parsedLimitRaw = parseInt(String(limit), 10);
    const parsedLimit = Math.min(Number.isFinite(parsedLimitRaw) ? parsedLimitRaw : 50, 200);
    const withMetrics = parseEnvBool(includeMetrics, false);

    const baseWhere: any = { AND: [{ eliminado: false }] };
    const workerNum = Number(workerId);
    if (Number.isFinite(workerNum) && workerNum > 0) baseWhere.AND.push({ responsable_id: workerNum });
    const clientNum = Number(clientId);
    if (Number.isFinite(clientNum) && clientNum > 0) baseWhere.AND.push({ cliente_id: clientNum });
    const prio = priority ? String(priority).toUpperCase() : undefined;
    if (prio && ['BAJA', 'MEDIA', 'ALTA'].includes(prio)) baseWhere.AND.push({ prioridad: prio as any });
    if (q && String(q).trim()) {
      baseWhere.AND.push({
        OR: [
          { descripcion: { contains: q, mode: 'insensitive' } },
          { titulo: { contains: q, mode: 'insensitive' } },
          { cliente: { nombre: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    const orderActive = [{ prioridad: Prisma.SortOrder.desc }, { fecha_actualizacion: Prisma.SortOrder.desc }];
    const [pendingRaw, assignedRaw, inProgressRaw, qaRaw, deliveredRaw] = await Promise.all([
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('PENDIENTE') as any }, select: kanbanCardSelect, orderBy: orderActive, take: parsedLimit }),
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('ASIGNADO') as any }, select: kanbanCardSelect, orderBy: orderActive, take: parsedLimit }),
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('EN_PROGRESO') as any }, select: kanbanCardSelect, orderBy: orderActive, take: parsedLimit }),
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('QA') as any }, select: kanbanCardSelect, orderBy: { fecha_actualizacion: 'desc' }, take: parsedLimit }),
      prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('ENTREGADO') as any }, select: kanbanCardSelect, orderBy: { fecha_actualizacion: 'desc' }, take: parsedLimit }),
    ]);

    const [pending, assigned, inProgress, qa, delivered] = await Promise.all([
      Promise.all(pendingRaw.map((card) => formatKanbanCard(card, withMetrics))),
      Promise.all(assignedRaw.map((card) => formatKanbanCard(card, withMetrics))),
      Promise.all(inProgressRaw.map((card) => formatKanbanCard(card, withMetrics))),
      Promise.all(qaRaw.map((card) => formatKanbanCard(card, withMetrics))),
      Promise.all(deliveredRaw.map((card) => formatKanbanCard(card, withMetrics))),
    ]);

    return success(res, {
      columns: {
        PENDIENTE: pending,
        ASIGNADO: assigned,
        EN_PROGRESO: inProgress,
        QA: qa,
        ENTREGADO: delivered,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

export const cambiarEstado = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as any;
    const { newStatus, note, userId } = req.body || {};

    const pedido = await transitionEstado(Number(id), newStatus, { note, userId });
    clearReportCache();
    let semaforoMetrics: any = null;
    try {
      semaforoMetrics = await computeSemaforoForPedido(Number(id));
    } catch {}
    logger.info({ msg: '[Kanban] Estado cambiado', id, newStatus, userId });
    return success(res, { ok: true, pedido, semaforo: semaforoMetrics?.color ?? pedido?.semaforo ?? null, metrics: semaforoMetrics });
  } catch (err) {
    next(err);
  }
};

export const evaluarSemaforo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const monitorEnabled = envFlag('KANBAN_MONITOR_ENABLED', false);
    const force = parseEnvBool(typeof req.query?.force === 'string' ? req.query.force : undefined, false);
    if (monitorEnabled && !force) {
      return success(res, {
        processed: 0,
        delayed: 0,
        checked: 0,
        affectedCount: 0,
        total: 0,
        totalChecked: 0,
        requiresAttention: 0,
        affected: [],
        skipped: true,
        reason: 'monitor_enabled',
      }, 200, 'Evaluacion omitida (monitor activo)');
    }

    const autoReassign = String((req.query?.autoReassign as string) || 'true').toLowerCase() !== 'false';
    const result = await evaluateAndNotify({ autoReassign });
    const checked = Number((result as any)?.checked ?? 0);
    const affected = Array.isArray((result as any)?.affected) ? (result as any).affected : [];
    const affectedCount = affected.length;
    return success(res, {
      processed: checked,
      delayed: affectedCount,
      checked,
      affectedCount,
      total: checked,
      totalChecked: checked,
      requiresAttention: affectedCount,
      affected,
      result,
    }, 200, 'Evaluacion completada');
  } catch (err) {
    next(err);
  }
};
