import { prisma } from '../prisma/client.js';
import NotificationService from './notificationService.js';
import { predictTiempoSec } from './MLService.js';
import { logger } from '../utils/logger.js';
import RealtimeService from '../realtime/RealtimeService.js';
import { applyAndEmitSemaforo } from './SemaforoService.js';
import { autoAssignIfEnabled, maybeReassignIfEnabled } from './AssignmentService.js';
import * as ClientNotificationService from './ClientNotificationService.js';

type Estado = 'PENDIENTE'|'ASIGNADO'|'EN_PROGRESO'|'QA'|'ENTREGADO';

const estadoCopy: Record<Estado, { title: string; body: string }> = {
  PENDIENTE: {
    title: 'Pedido recibido',
    body: 'Registramos tu pedido y está esperando su turno para iniciar.'
  },
  ASIGNADO: {
    title: 'Pedido asignado',
    body: 'Un técnico fue asignado a tu trabajo y prepara los materiales.'
  },
  EN_PROGRESO: {
    title: 'Estamos trabajando en tu pedido',
    body: 'Tu pieza está en proceso de fabricación en este momento.'
  },
  QA: {
    title: 'Control de calidad',
    body: 'Tu pedido está pasando por las pruebas y controles finales.'
  },
  ENTREGADO: {
    title: 'Pedido entregado',
    body: 'Tu pedido fue entregado. ¡Gracias!'
  }
};

export async function transitionEstado(pedidoId: number, newEstado: Estado, opts: { userId?: number; note?: string } = {}) {
  const now = new Date();
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
  if (!pedido) throw new Error('Pedido no encontrado');

  const prevEstado = pedido.estado as Estado;
  await prisma.pedidos.update({ where: { id: pedidoId }, data: { estado: newEstado } });

  // Abrir registro de tiempo cuando entra en EN_PROGRESO
  if (prevEstado !== 'EN_PROGRESO' && newEstado === 'EN_PROGRESO' && pedido.responsable_id) {
    try {
      await prisma.tiempos.create({
        data: {
          pedido_id: pedidoId,
          trabajador_id: pedido.responsable_id,
          categoria: 'Producción',
          inicio: now,
          estado: 'ABIERTO',
          registrado_por: opts.userId ?? null,
        }
      });
    } catch (_) { /* ignore */ }
  }

  // Cerrar registro de tiempo abierto al salir de EN_PROGRESO
  if (prevEstado === 'EN_PROGRESO' && newEstado !== 'EN_PROGRESO') {
    try {
      const abierto = await prisma.tiempos.findFirst({ where: { pedido_id: pedidoId, estado: 'ABIERTO' }, orderBy: { id: 'desc' } });
      if (abierto) {
        const fin = now;
        const duracion = abierto.inicio ? Math.max(1, Math.round((fin.getTime() - new Date(abierto.inicio).getTime()) / 1000)) : null;
        await prisma.tiempos.update({ where: { id: abierto.id }, data: { fin, duracion_sec: duracion, estado: 'CERRADO' } });
      }
    } catch (_) { /* ignore */ }
  }

  // Calcular lead time al ENTREGADO
  if (newEstado === 'ENTREGADO') {
    try {
      const inicio = pedido.fecha_inicio ? new Date(pedido.fecha_inicio) : null;
      const leadSec = inicio ? Math.max(1, Math.round((now.getTime() - inicio.getTime()) / 1000)) : null;
      await prisma.pedidos.update({ where: { id: pedidoId }, data: { tiempo_real_sec: leadSec, semaforo: 'VERDE' } });
            // Notificacion de entrega (persistencia + push)
      await ClientNotificationService.createNotification({
        pedidoId,
        clienteId: pedido.cliente_id,
        mensaje: estadoCopy.ENTREGADO.body,
        tipo: 'ENTREGA',
        title: estadoCopy.ENTREGADO.title,
      });
      // Alerta web para operadores
      try {
        RealtimeService.emitWebAlert('ENTREGA_COMPLETADA', `Pedido #${pedidoId} entregado`, { pedidoId });
      } catch {}
    } catch (_) { /* ignore */ }
  } else {
    // Evaluar semáforo para este pedido (riesgo de retraso)
    try {
      if (pedido.fecha_estimada_fin) {
        const remainingSec = Math.max(0, Math.round((new Date(pedido.fecha_estimada_fin).getTime() - now.getTime()) / 1000));
        const responsableId = pedido.responsable_id ?? 0;
        const estimSec = await predictTiempoSec(pedidoId, responsableId);
        if (estimSec > remainingSec) {
          await prisma.pedidos.update({ where: { id: pedidoId }, data: { semaforo: 'ROJO' } });
          const alertaNotif = await ClientNotificationService.createNotification({
          pedidoId,
          clienteId: pedido.cliente_id,
          mensaje: 'Tu pedido podría retrasarse. Estamos ajustando la planificación.',
          tipo: 'ALERTA',
          title: 'Riesgo de retraso',
        });
        if (alertaNotif) {
          RealtimeService.emitWebAlert('RETRASO', `Pedido #${pedidoId} en riesgo (ROJO)`, { pedidoId, reason: 'Riesgo de retraso detectado' });
          }
          await NotificationService.sendDelayNotice({
            clienteEmail: null,
            clienteTelefono: null,
            pedidoId,
            nuevaFecha: null,
            motivo: 'Riesgo de retraso detectado',
          });
        } else {
          await prisma.pedidos.update({ where: { id: pedidoId }, data: { semaforo: 'VERDE' } });
        }
      }
    } catch (e) {
      logger.warn({ msg: '[PedidoWorkflow] Error evaluando semáforo', pedidoId, err: (e as any)?.message });
    }
  }

  // Recalcular WIP (carga_actual) del responsable
  try {
    if (pedido.responsable_id) {
      const wip = await prisma.pedidos.count({ where: { responsable_id: pedido.responsable_id, estado: 'EN_PROGRESO' } });
      await prisma.trabajadores.update({ where: { id: pedido.responsable_id }, data: { carga_actual: wip } });
    }
  } catch (_) { /* ignore */ }

  // Reaplicar semáforo con cálculo real y emitir cambios (coherencia inmediata tras transición)
  try {
    const res = await applyAndEmitSemaforo(pedidoId);
    if (newEstado === 'EN_PROGRESO' && !pedido.responsable_id) {
      try { await autoAssignIfEnabled(pedidoId); } catch {}
    }
    const color = (res as any)?.color;
    if (color === 'ROJO') {
      try { await maybeReassignIfEnabled(pedidoId, 'ROJO'); } catch {}
    }
  } catch (_) { /* ignore */ }

  // Notificación informativa de cambio de estado
  try {
    const copy = estadoCopy[newEstado] ?? { title: 'Estado del pedido', body: `Estado actualizado a ${newEstado}` };
    await ClientNotificationService.createNotification({
      pedidoId,
      clienteId: pedido.cliente_id,
      mensaje: copy.body,
      tipo: 'INFO',
      title: copy.title,
    });
  } catch (_) { /* ignore */ }

  logger.info({ msg: '[PedidoWorkflow] Estado cambiado', pedidoId, prevEstado, newEstado, userId: opts.userId, note: opts.note });
  return await prisma.pedidos.findUnique({ where: { id: pedidoId }, include: { cliente: true, responsable: true } });
}

export default { transitionEstado };
