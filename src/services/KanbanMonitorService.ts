import { prisma } from '../prisma/client.js';
import NotificationService from './notificationService.js';
import { predictTiempoSec } from './MLService.js';
import { logger } from '../utils/logger.js';
import RealtimeService from '../realtime/RealtimeService.js';
import { applyAndEmitSemaforo } from './SemaforoService.js';
import { suggestCandidates, maybeReassignIfEnabled } from './AssignmentService.js';
export async function evaluateAndNotify(options?: { suggestOnly?: boolean }) {
  const now = new Date();
  const activos = await prisma.pedidos.findMany({
    where: { eliminado: false, estado: { in: ['PENDIENTE','ASIGNADO','EN_PROGRESO','QA'] } },
    include: { cliente: true, responsable: true }
  });
  const affected: any[] = [];
  for (const p of activos) {
    // Nueva lógica de semáforo real (ratio por trabajador y fecha/hora):
    try {
      const res = await applyAndEmitSemaforo(p.id);
      if (res && (res as any).changed) {
        affected.push({ id: p.id, semaforo: (res as any).color, ratio: (res as any).ratio });
      }
      // Sugerencias / reasignación en riesgo
      const color = (res as any)?.color;
      if (color === 'ROJO') {
        if (!options?.suggestOnly) {
          await maybeReassignIfEnabled(p.id, color);
        } else {
          try {
            const candidates = await suggestCandidates(p.id);
            RealtimeService.emitToOperators('assignment:suggest', { pedidoId: p.id, candidates, ts: Date.now() });
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

    // si la estimación supera el tiempo restante, riesgo de retraso
    if (estimSec > remainingSec) {
      // actualizar semáforo a ROJO
      await prisma.pedidos.update({ where: { id: p.id }, data: { semaforo: 'ROJO' } });

      // calcular nueva fecha sugerida
      const nuevaFecha = new Date(now.getTime() + estimSec * 1000);

      // crear notificación al cliente
      try {
        await prisma.notificaciones.create({
          data: {
            pedido_id: p.id,
            cliente_id: p.cliente_id,
            mensaje: `Retraso estimado. Nueva fecha sugerida: ${nuevaFecha.toISOString()}`,
            tipo: 'ALERTA',
          }
        });
      } catch {}

      // Emitir en tiempo real (mejor esfuerzo)
      try {
        const notif = await prisma.notificaciones.findFirst({ where: { pedido_id: p.id, cliente_id: p.cliente_id }, orderBy: { id: 'desc' } });
        if (notif) {
          RealtimeService.emitToClient(p.cliente_id, 'notification:new', notif);
          RealtimeService.emitToOperators('kanban:semaforo-changed', { pedidoId: p.id, semaforo: 'ROJO', suggestedDue: nuevaFecha.toISOString() });
          RealtimeService.emitWebAlert('RETRASO', `Pedido #${p.id} en riesgo (ROJO)`, { pedidoId: p.id, suggestedDue: nuevaFecha.toISOString() });
        }
      } catch {}

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
            const upcoming = lastUpcoming ?? await prisma.notificaciones.create({
              data: { pedido_id: p.id, cliente_id: p.cliente_id, mensaje: msg, tipo: 'INFO' }
            }).catch(() => null);
            if (upcoming) {
              RealtimeService.emitToClient(p.cliente_id, 'notification:new', upcoming);
            }
            RealtimeService.emitWebAlert('PROXIMA_ENTREGA', `Pedido #${p.id} - ${msg}`, { pedidoId: p.id, inHours: hours });
          } catch {}
        }
      }
    }
  }
  return { checked: activos.length, affected };
}
