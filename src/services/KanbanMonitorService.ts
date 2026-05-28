import { prisma } from '../prisma/client.js';
import { logger } from '../utils/logger.js';
import { envFlag } from '../utils/env.js';
import RealtimeService from '../realtime/RealtimeService.js';
import { applyAndEmitSemaforo } from './SemaforoService.js';
import { suggestCandidates, maybeReassignIfEnabled, autoAssignIfEnabled } from './AssignmentService.js';

type EvaluateOptions = { autoReassign?: boolean; autoAssignPending?: boolean; pedidoIds?: number[] };

export async function evaluateAndNotify(options?: EvaluateOptions) {
  const ids = Array.isArray(options?.pedidoIds) ? options!.pedidoIds : [];
  const pedidoIds = Array.from(new Set(ids.map((id) => Number(id)))).filter((id) => Number.isFinite(id) && id > 0);
  const where: any = { eliminado: false, estado: { in: ['PENDIENTE', 'ASIGNADO', 'EN_PROGRESO', 'QA'] } };
  if (pedidoIds.length) where.id = { in: pedidoIds };

  const activos = await prisma.pedidos.findMany({
    where,
    select: { id: true, estado: true, responsable_id: true },
  });

  const affected: any[] = [];
  const allowAuto = options?.autoReassign !== false;

  for (const pedido of activos) {
    if ((options?.autoAssignPending ?? true) && pedido.estado === 'PENDIENTE' && !pedido.responsable_id) {
      try {
        await autoAssignIfEnabled(pedido.id);
      } catch (err) {
        logger.warn({ msg: '[KanbanMonitor] auto assign skipped', pedidoId: pedido.id, err: (err as any)?.message });
      }
      continue;
    }

    try {
      const result = await applyAndEmitSemaforo(pedido.id);
      if (result?.changed) {
        affected.push({
          id: pedido.id,
          semaforo: result.color,
          ratio: result.ratio,
          ratioAdjusted: result.ratioAdjusted,
          decision: result.decision,
        });
      }

      if (result?.color === 'ROJO') {
        if (allowAuto) {
          await maybeReassignIfEnabled(pedido.id, 'ROJO');
        } else {
          const candidates = await suggestCandidates(pedido.id);
          RealtimeService.emitToOperators('assignment:suggest', { pedidoId: pedido.id, candidates, ts: Date.now(), mode: 'manual' });
        }
      } else if (result?.color === 'AMARILLO') {
        const candidates = await suggestCandidates(pedido.id);
        RealtimeService.emitToOperators('assignment:suggest', { pedidoId: pedido.id, candidates, ts: Date.now() });
      }
    } catch (err) {
      logger.warn({ msg: '[KanbanMonitor] evaluate item error', pedidoId: pedido.id, err: (err as any)?.message });
    }
  }

  return { checked: activos.length, affected };
}

export function scheduleEvaluatePedidos(pedidoIds: number[] | number, options?: Omit<EvaluateOptions, 'pedidoIds'>) {
  if (!envFlag('KANBAN_MONITOR_ENABLED', false)) return;
  if (!envFlag('KANBAN_EVENT_EVAL_ENABLED', true)) return;

  const ids = Array.isArray(pedidoIds) ? pedidoIds : [pedidoIds];
  const uniqueIds = Array.from(new Set(ids.map((id) => Number(id)))).filter((id) => Number.isFinite(id) && id > 0);
  if (!uniqueIds.length) return;

  setTimeout(() => {
    evaluateAndNotify({ ...(options || {}), pedidoIds: uniqueIds }).catch((err) => {
      logger.error({ msg: '[KanbanMonitor] evaluate error', err: (err as any)?.message, pedidoIds: uniqueIds });
    });
  }, 0);
}
