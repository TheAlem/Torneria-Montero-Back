import { prisma } from '../prisma/client.js';
import NotificationService from './notificationService.js';
import { predictTiempoSecHybridDetailed, recalcPedidoEstimate, upsertResultadoPrediccion } from './MLService.js';
import { logger } from '../utils/logger.js';
import RealtimeService from '../realtime/RealtimeService.js';
import { applyAndEmitSemaforo, getTiempoRealSec, businessSecondsBetween, getWorkerSchedule } from './SemaforoService.js';
import { autoAssignIfEnabled, maybeReassignIfEnabled } from './AssignmentService.js';
import * as ClientNotificationService from './ClientNotificationService.js';

type Estado = 'PENDIENTE' | 'ASIGNADO' | 'EN_PROGRESO' | 'QA' | 'ENTREGADO';
const allowedTransitions: Record<Estado, Estado[]> = {
  PENDIENTE: ['ASIGNADO', 'EN_PROGRESO'],
  ASIGNADO: ['PENDIENTE', 'EN_PROGRESO'],
  EN_PROGRESO: ['QA', 'ENTREGADO', 'ASIGNADO', 'PENDIENTE'],
  QA: ['EN_PROGRESO', 'ENTREGADO'],
  ENTREGADO: [],
};

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

export async function transitionEstado(
  pedidoId: number,
  newEstado: Estado,
  opts: { userId?: number; note?: string; backgroundSideEffects?: boolean } = {}
) {
  const now = new Date();
  let pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
  if (!pedido) throw new Error('Pedido no encontrado');

  const prevEstado = pedido.estado as Estado;
  if (prevEstado === newEstado) {
    logger.info({ msg: '[PedidoWorkflow] Estado sin cambios, se omiten side-effects', pedidoId, estado: newEstado });
    return await prisma.pedidos.findUnique({ where: { id: pedidoId }, include: { cliente: true, responsable: true } });
  }
  const allowed = allowedTransitions[prevEstado] || [];
  if (!allowed.includes(newEstado)) {
    const err: any = new Error(`Transición no permitida de ${prevEstado} a ${newEstado}`);
    err.code = 'INVALID_TRANSITION';
    err.status = 400;
    err.allowed = allowed;
    throw err;
  }
  const updateData: any = { estado: newEstado };
  if (newEstado === 'ENTREGADO') {
    updateData.pagado = true; // al entregar, se marca pagado automáticamente
  }
  if (prevEstado !== 'EN_PROGRESO' && newEstado === 'EN_PROGRESO') {
    updateData.fecha_inicio = now;
  }
  await prisma.pedidos.update({ where: { id: pedidoId }, data: updateData });
  pedido = { ...pedido, ...updateData };

  // Auto-asignar antes de abrir tiempos para no perder tracking
  if (newEstado === 'EN_PROGRESO' && !pedido.responsable_id) {
    try {
      const assigned = await autoAssignIfEnabled(pedidoId);
      if (assigned) {
        const refreshed = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
        if (refreshed) pedido = refreshed;
      }
    } catch { }
  }

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
    // Aprendizaje online: estimar y fijar fecha si no existe
    try { await recalcPedidoEstimate(pedidoId, { trabajadorId: pedido.responsable_id, updateFechaEstimada: true }); } catch { }
  }

  // Cerrar registro de tiempo abierto al salir de EN_PROGRESO
  if (prevEstado === 'EN_PROGRESO' && newEstado !== 'EN_PROGRESO') {
    try {
      const abierto = await prisma.tiempos.findFirst({ where: { pedido_id: pedidoId, estado: 'ABIERTO' }, orderBy: { id: 'desc' } });
      if (abierto) {
        const fin = now;
        let duracion = null;
        if (abierto.inicio) {
          const schedule = await getWorkerSchedule(abierto.trabajador_id);
          duracion = Math.max(1, businessSecondsBetween(new Date(abierto.inicio), fin, schedule?.shifts, schedule?.workdays));
        }
        await prisma.tiempos.update({ where: { id: abierto.id }, data: { fin, duracion_sec: duracion, estado: 'CERRADO' } });
      }
    } catch (_) { /* ignore */ }
  }

  const runSideEffects = async () => {
    // Calcular lead time y cierre al ENTREGADO
    if (newEstado === 'ENTREGADO') {
      try {
        const estimSec = pedido.tiempo_estimado_sec ?? await recalcPedidoEstimate(pedidoId, { trabajadorId: pedido.responsable_id ?? null, updateFechaEstimada: false }) ?? null;
        const tRealSec = await getTiempoRealSec(pedidoId);
        const inicio = pedido.fecha_inicio ? new Date(pedido.fecha_inicio) : null;
        const leadSec = inicio ? Math.max(1, businessSecondsBetween(inicio, now)) : null;
        const finalReal = tRealSec ?? leadSec ?? null;
        await prisma.pedidos.update({ where: { id: pedidoId }, data: { tiempo_real_sec: finalReal ?? null, semaforo: 'VERDE' } });
        await upsertResultadoPrediccion(pedidoId, pedido.responsable_id ?? null, finalReal, estimSec ?? null);
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
        } catch { }
      } catch (_) { /* ignore */ }
    } else {
      try {
        const refreshed = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
        if (refreshed) pedido = refreshed;
      } catch { }
      // Evaluar semáforo para este pedido (riesgo de retraso)
      try {
        if (pedido.fecha_estimada_fin) {
          const remainingSec = Math.max(0, Math.round((new Date(pedido.fecha_estimada_fin).getTime() - now.getTime()) / 1000));
          const responsableId = pedido.responsable_id ?? 0;
          const estimSec = await predictTiempoSecHybridDetailed(pedidoId, responsableId);
          const estimadoSec = estimSec.adjustedSec;
          if (estimadoSec > remainingSec) {
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
      const refreshed = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
      if (refreshed) pedido = refreshed;
      if (pedido.responsable_id) {
        const wip = await prisma.pedidos.count({ where: { responsable_id: pedido.responsable_id, estado: 'EN_PROGRESO' } });
        await prisma.trabajadores.update({ where: { id: pedido.responsable_id }, data: { carga_actual: wip } });
      }
    } catch (_) { /* ignore */ }

    // Reaplicar semáforo con cálculo real y emitir cambios (coherencia inmediata tras transición)
    try {
      const res = await applyAndEmitSemaforo(pedidoId);
      const color = (res as any)?.color;
      if (newEstado !== 'ENTREGADO' && color === 'ROJO') {
        try { await maybeReassignIfEnabled(pedidoId, 'ROJO'); } catch { }
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
  };

  if (opts.backgroundSideEffects !== false) {
    setTimeout(() => {
      runSideEffects().catch((err) => logger.warn({ msg: '[PedidoWorkflow] Side effects error', pedidoId, err: (err as any)?.message }));
    }, 0);
  } else {
    await runSideEffects();
  }

  logger.info({ msg: '[PedidoWorkflow] Estado cambiado', pedidoId, prevEstado, newEstado, userId: opts.userId, note: opts.note });
  return await prisma.pedidos.findUnique({ where: { id: pedidoId }, include: { cliente: true, responsable: true } });
}

export default { transitionEstado };
