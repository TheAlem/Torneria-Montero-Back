import { prisma } from '../prisma/client.js';
import NotificationService from './notificationService.js';
import { predictTiempoSec } from './MLService.js';
import { logger } from '../utils/logger.js';
import { envFlag } from '../utils/env.js';
import RealtimeService from '../realtime/RealtimeService.js';
import { applyAndEmitSemaforo } from './SemaforoService.js';
import { suggestCandidates, maybeReassignIfEnabled, autoAssignIfEnabled } from './AssignmentService.js';
import * as ClientNotificationService from './ClientNotificationService.js';

type EvaluateOptions = { autoReassign?: boolean; autoAssignPending?: boolean; pedidoIds?: number[] };

export async function evaluateAndNotify(options?: EvaluateOptions) {
  const now = new Date();
  const ids = Array.isArray(options?.pedidoIds) ? options!.pedidoIds : [];
  const pedidoIds = Array.from(new Set(ids.map(id => Number(id)))).filter(id => Number.isFinite(id) && id > 0);
  const where: any = { eliminado: false, estado: { in: ['PENDIENTE','ASIGNADO','EN_PROGRESO','QA'] } };
  if (pedidoIds.length) where.id = { in: pedidoIds };
  const activos = await prisma.pedidos.findMany({
    where,
    include: { cliente: true, responsable: true }
  });
  const affected: any[] = [];
  const allowAuto = options?.autoReassign !== false;
  for (const p of activos) {
    // Si hay trabajos sin responsable en PENDIENTE, intentar auto-asignarlos antes de evaluar retrasos
    if ((options?.autoAssignPending ?? true) && p.estado === 'PENDIENTE' && !p.responsable_id) {
      try { await autoAssignIfEnabled(p.id); } catch {}
      // luego de auto-asignar, seguimos al próximo; se evaluará en el siguiente ciclo
      continue;
    }
    // Nueva lógica de semáforo real (ratio por trabajador y fecha/hora):
    try {
      const res = await applyAndEmitSemaforo(p.id);
      if (res && (res as any).changed) {
        affected.push({ id: p.id, semaforo: (res as any).color, ratio: (res as any).ratio });
      }
      // Sugerencias / reasignación en riesgo
      const color = (res as any)?.color;
      if (color === 'ROJO') {
        if (allowAuto) {
          await maybeReassignIfEnabled(p.id, color);
        } else {
          try {
            const candidates = await suggestCandidates(p.id);
            RealtimeService.emitToOperators('assignment:suggest', { pedidoId: p.id, candidates, ts: Date.now(), mode: 'manual' });
          } catch {}
        }
      } else if (color === 'AMARILLO') {
        try {
          const candidates = await suggestCandidates(p.id);
          RealtimeService.emitToOperators('assignment:suggest', { pedidoId: p.id, candidates, ts: Date.now() });
        } catch {}
      }
      // Evitar duplicados con la lógica legacy
      continue;
    } catch {}
    if (!p.fecha_estimada_fin) continue;
    const remainingMs = p.fecha_estimada_fin.getTime() - now.getTime();
    const remainingSec = Math.max(0, Math.round(remainingMs / 1000));

    const responsableId = p.responsable_id ?? 0;
    const estimSec = await predictTiempoSec(p.id, responsableId);

    // si la estimacion supera el tiempo restante, riesgo de retraso
    if (estimSec > remainingSec) {
      await prisma.pedidos.update({ where: { id: p.id }, data: { semaforo: 'ROJO' } });
      const nuevaFecha = new Date(now.getTime() + estimSec * 1000);

      await ClientNotificationService.createNotification({
        pedidoId: p.id,
        clienteId: p.cliente_id,
        mensaje: `Retraso estimado. Nueva fecha sugerida: ${nuevaFecha.toISOString()}`,
        tipo: 'ALERTA',
        title: 'Retraso detectado',
        data: { suggestedDue: nuevaFecha.toISOString() },
      });
      RealtimeService.emitToOperators('kanban:semaforo-changed', { pedidoId: p.id, semaforo: 'ROJO', suggestedDue: nuevaFecha.toISOString() });
      RealtimeService.emitWebAlert('RETRASO', `Pedido #${p.id} en riesgo (ROJO)`, { pedidoId: p.id, suggestedDue: nuevaFecha.toISOString() });

      await NotificationService.sendDelayNotice({
        clienteEmail: p.cliente?.email ?? null,
        clienteTelefono: p.cliente?.telefono ?? null,
        pedidoId: p.id,
        nuevaFecha: nuevaFecha.toISOString(),
        motivo: 'Capacidad insuficiente para cumplir el plazo actual',
      });

      affected.push({ id: p.id, oldDue: p.fecha_estimada_fin, suggestedDue: nuevaFecha });
      logger.info({ msg: '[KanbanMonitor] Pedido en riesgo', pedidoId: p.id, suggestedDue: nuevaFecha.toISOString() });
    } else {
      // si está en verde y ok, asegurar semáforo en VERDE (no forzamos amarillos aquí)
      if (p.semaforo !== 'VERDE') {
        await prisma.pedidos.update({ where: { id: p.id }, data: { semaforo: 'VERDE' } });
      }

      // Próximas entregas (ventana de <= 2 días)
      if (p.fecha_estimada_fin) {
        const hours = Math.ceil(remainingSec / 3600);
        if (remainingSec > 0 && remainingSec <= 48 * 3600) {
          // Registrar notificación al cliente (opcional) y emitir para web
          try {
            const msg = hours <= 24 ? `Entrega en ${hours} horas` : `Entrega en ${Math.ceil(hours/24)} días`;
            // Evitar spam: solo una notificación UPCOMING cada 6h por pedido
            const sixHoursAgo = new Date(now.getTime() - 6 * 3600 * 1000);
            const lastUpcoming = await prisma.notificaciones.findFirst({
              where: { pedido_id: p.id, tipo: 'INFO', mensaje: { contains: 'Entrega en' }, fecha_creacion: { gte: sixHoursAgo } },
              orderBy: { id: 'desc' }
            });
            if (!lastUpcoming) {
              await ClientNotificationService.createNotification({
                pedidoId: p.id,
                clienteId: p.cliente_id,
                mensaje: msg,
                tipo: 'INFO',
                title: 'Proxima entrega',
                data: { etaHours: String(hours) },
              });
            }
            RealtimeService.emitWebAlert('PROXIMA_ENTREGA', `Pedido #${p.id} - ${msg}`, { pedidoId: p.id, inHours: hours });
          } catch {}
        }
      }
    }
  }
  return { checked: activos.length, affected };
}

export function scheduleEvaluatePedidos(pedidoIds: number[] | number, options?: Omit<EvaluateOptions, 'pedidoIds'>) {
  if (!envFlag('KANBAN_MONITOR_ENABLED', false)) return;
  if (!envFlag('KANBAN_EVENT_EVAL_ENABLED', true)) return;
  const ids = Array.isArray(pedidoIds) ? pedidoIds : [pedidoIds];
  const uniqueIds = Array.from(new Set(ids.map(id => Number(id)))).filter(id => Number.isFinite(id) && id > 0);
  if (!uniqueIds.length) return;
  setTimeout(() => {
    evaluateAndNotify({ ...(options || {}), pedidoIds: uniqueIds }).catch((err) => {
      logger.error({ msg: '[KanbanMonitor] evaluate error', err: (err as any)?.message, pedidoIds: uniqueIds });
    });
  }, 0);
}
