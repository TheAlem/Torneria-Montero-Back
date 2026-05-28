import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client.js';
import { recalcPedidoEstimate, upsertResultadoPrediccion } from './MLService.js';
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
    body: 'Registramos tu pedido y esta esperando su turno para iniciar.',
  },
  ASIGNADO: {
    title: 'Pedido asignado',
    body: 'Un tecnico fue asignado a tu trabajo y prepara los materiales.',
  },
  EN_PROGRESO: {
    title: 'Estamos trabajando en tu pedido',
    body: 'Tu pieza esta en proceso de fabricacion en este momento.',
  },
  QA: {
    title: 'Control de calidad',
    body: 'Tu pedido esta pasando por las pruebas y controles finales.',
  },
  ENTREGADO: {
    title: 'Pedido entregado',
    body: 'Tu pedido fue entregado. Gracias.',
  },
};

const kanbanRealtimeSelect: Prisma.pedidosSelect = {
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
    orderBy: { id: 'desc' },
    take: 1,
  },
};

async function emitKanbanPedidoUpsert(pedidoId: number, prevEstado: Estado, reason: string) {
  const card = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: kanbanRealtimeSelect });
  if (!card) return;

  let lastSemaforo: any = null;
  try {
    lastSemaforo = await applyAndEmitSemaforo(pedidoId);
  } catch {}

  const lastAssign = Array.isArray((card as any).asignaciones) && (card as any).asignaciones.length
    ? (card as any).asignaciones[0]
    : null;
  const autoAsignado = lastAssign?.origen === 'SUGERIDO';
  const { asignaciones, ...rest } = card as any;
  const payload = {
    pedidoId,
    prevEstado,
    newEstado: card.estado,
    reason,
    ts: Date.now(),
    card: {
      ...rest,
      semaforo: lastSemaforo?.color ?? rest.semaforo,
      lastSemaforo,
      autoAsignado,
    },
  };

  RealtimeService.emitToOperators('kanban:pedido-upsert', payload);
  if (prevEstado !== (card.estado as Estado)) {
    RealtimeService.emitToOperators('kanban:pedido-moved', payload);
  }
}

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
    const err: any = new Error(`Transicion no permitida de ${prevEstado} a ${newEstado}`);
    err.code = 'INVALID_TRANSITION';
    err.status = 400;
    err.allowed = allowed;
    throw err;
  }

  const updateData: any = { estado: newEstado };
  if (newEstado === 'ENTREGADO') updateData.pagado = true;
  if (prevEstado !== 'EN_PROGRESO' && newEstado === 'EN_PROGRESO') updateData.fecha_inicio = now;

  await prisma.pedidos.update({ where: { id: pedidoId }, data: updateData });
  pedido = { ...pedido, ...updateData };

  try {
    await emitKanbanPedidoUpsert(pedidoId, prevEstado, 'status_transition');
  } catch {}

  if (newEstado === 'EN_PROGRESO' && !pedido.responsable_id) {
    try {
      const assigned = await autoAssignIfEnabled(pedidoId);
      if (assigned) {
        const refreshed = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
        if (refreshed) pedido = refreshed;
      }
    } catch {}
  }

  if (prevEstado !== 'EN_PROGRESO' && newEstado === 'EN_PROGRESO' && pedido.responsable_id) {
    try {
      await prisma.tiempos.create({
        data: {
          pedido_id: pedidoId,
          trabajador_id: pedido.responsable_id,
          categoria: 'Produccion',
          inicio: now,
          estado: 'ABIERTO',
          registrado_por: opts.userId ?? null,
        },
      });
    } catch {}

    try {
      await recalcPedidoEstimate(pedidoId, { trabajadorId: pedido.responsable_id, updateFechaEstimada: true });
    } catch {}
  }

  if (prevEstado === 'EN_PROGRESO' && newEstado !== 'EN_PROGRESO') {
    try {
      const abierto = await prisma.tiempos.findFirst({
        where: { pedido_id: pedidoId, estado: 'ABIERTO' },
        orderBy: { id: 'desc' },
      });
      if (abierto) {
        const fin = now;
        let duracion = null;
        if (abierto.inicio) {
          const schedule = await getWorkerSchedule(abierto.trabajador_id);
          duracion = Math.max(1, businessSecondsBetween(new Date(abierto.inicio), fin, schedule?.shifts, schedule?.workdays));
        }
        await prisma.tiempos.update({ where: { id: abierto.id }, data: { fin, duracion_sec: duracion, estado: 'CERRADO' } });
      }
    } catch {}
  }

  const runSideEffects = async () => {
    if (newEstado === 'ENTREGADO') {
      try {
        const estimSec = pedido.tiempo_estimado_sec
          ?? await recalcPedidoEstimate(pedidoId, { trabajadorId: pedido.responsable_id ?? null, updateFechaEstimada: false })
          ?? null;
        const tRealSec = await getTiempoRealSec(pedidoId);
        const inicio = pedido.fecha_inicio ? new Date(pedido.fecha_inicio) : null;
        const leadSec = inicio ? Math.max(1, businessSecondsBetween(inicio, now)) : null;
        const finalReal = tRealSec ?? leadSec ?? null;

        await prisma.pedidos.update({
          where: { id: pedidoId },
          data: { tiempo_real_sec: finalReal ?? null, semaforo: 'VERDE' },
        });
        await upsertResultadoPrediccion(pedidoId, pedido.responsable_id ?? null, finalReal, estimSec ?? null);
        await ClientNotificationService.createNotification({
          pedidoId,
          clienteId: pedido.cliente_id,
          mensaje: estadoCopy.ENTREGADO.body,
          tipo: 'ENTREGA',
          title: estadoCopy.ENTREGADO.title,
        });
        try {
          RealtimeService.emitWebAlert('ENTREGA_COMPLETADA', `Pedido #${pedidoId} entregado`, { pedidoId });
        } catch {}
      } catch {}
    } else {
      try {
        const refreshed = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
        if (refreshed) pedido = refreshed;
      } catch {}
    }

    try {
      const refreshed = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
      if (refreshed) pedido = refreshed;
      if (pedido.responsable_id) {
        const wip = await prisma.pedidos.count({ where: { responsable_id: pedido.responsable_id, estado: 'EN_PROGRESO' } });
        await prisma.trabajadores.update({ where: { id: pedido.responsable_id }, data: { carga_actual: wip } });
      }
    } catch {}

    try {
      const result = await applyAndEmitSemaforo(pedidoId);
      if (newEstado !== 'ENTREGADO' && result?.color === 'ROJO') {
        try {
          await maybeReassignIfEnabled(pedidoId, 'ROJO');
        } catch {}
      }
    } catch {}

    try {
      const copy = estadoCopy[newEstado] ?? { title: 'Estado del pedido', body: `Estado actualizado a ${newEstado}` };
      await ClientNotificationService.createNotification({
        pedidoId,
        clienteId: pedido.cliente_id,
        mensaje: copy.body,
        tipo: 'INFO',
        title: copy.title,
      });
    } catch {}

    try {
      await emitKanbanPedidoUpsert(pedidoId, prevEstado, 'post_side_effects');
    } catch {}
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
