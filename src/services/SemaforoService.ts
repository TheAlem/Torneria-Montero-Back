import { prisma } from '../prisma/client.js';
import { predictTiempoSecHybridDetailed } from './MLService.js';
import { parseDescripcion, computeComplexityScore } from './ml/features.js';
import RealtimeService from '../realtime/RealtimeService.js';
import ClientNotificationService from './ClientNotificationService.js';
import { getEffectiveDueDate } from './dueDates.js';
import { businessSecondsBetween, getWorkerSchedule } from './WorkCalendarService.js';

export { businessSecondsBetween, getWorkerSchedule };

export type SemaforoColor = 'VERDE' | 'AMARILLO' | 'ROJO';
export type SemaforoDecisionStatus = 'SIN_DATOS' | 'A_TIEMPO' | 'ATENCION' | 'RIESGO' | 'VENCIDO' | 'ENTREGADO';

export type SemaforoDecision = {
  status: SemaforoDecisionStatus;
  label: string;
  reason: string;
  notify: boolean;
};

export type SemaforoMetrics = {
  color: SemaforoColor;
  tRealSec: number;
  tEstimadoSec: number;
  tRestanteSec: number;
  slackSec: number;
  marginSec: number;
  ratio: number;
  ratioAdjusted: number;
  complexityScore: number;
  loadRatio: number;
  effectiveDueAt: string | null;
  thresholds: {
    yellow: number;
    red: number;
    redGraceSec: number;
    attentionMarginSec: number;
  };
  decision: SemaforoDecision;
  ml: {
    baseSec: number;
    adjustedSec: number;
    interval: { minSec: number; maxSec: number; bufferPct: number };
    modelVersion: string;
    source: string;
  } | null;
  heuristics: {
    reasons: string[];
    complexityScore: number;
    loadRatio: number;
  };
};

function getThresholds(prioridad: 'ALTA' | 'MEDIA' | 'BAJA'): { yellow: number; red: number } {
  const baseYellow = Number(process.env.SEMAFORO_RATIO_YELLOW ?? 0.75);
  const baseRed = Number(process.env.SEMAFORO_RATIO_RED ?? 1.05);
  if (prioridad === 'ALTA') {
    return {
      yellow: Number(process.env.SEMAFORO_RATIO_YELLOW_HIGH ?? 0.65),
      red: Number(process.env.SEMAFORO_RATIO_RED_HIGH ?? 1.02),
    };
  }
  return { yellow: baseYellow, red: baseRed };
}

const emptyMetrics = (decision: SemaforoDecision, color: SemaforoColor = 'VERDE'): SemaforoMetrics => ({
  color,
  tRealSec: 0,
  tEstimadoSec: 0,
  tRestanteSec: 0,
  slackSec: 0,
  marginSec: 0,
  ratio: 0,
  ratioAdjusted: 0,
  complexityScore: 0,
  loadRatio: 0,
  effectiveDueAt: null,
  thresholds: {
    yellow: 0,
    red: 0,
    redGraceSec: 0,
    attentionMarginSec: 0,
  },
  decision,
  ml: null,
  heuristics: {
    reasons: [],
    complexityScore: 0,
    loadRatio: 0,
  },
});

export function decideSemaforoStatus(input: {
  estado?: string | null;
  hasDueDate: boolean;
  hasResponsable: boolean;
  slackSec: number;
  marginSec: number;
  ratioAdjusted: number;
  yellowThreshold: number;
  redThreshold: number;
  redGraceSec: number;
  attentionMarginSec: number;
}): { color: SemaforoColor; decision: SemaforoDecision } {
  const estado = String(input.estado || '').toUpperCase();
  if (estado === 'ENTREGADO') {
    return {
      color: 'VERDE',
      decision: { status: 'ENTREGADO', label: 'Entregado', reason: 'Trabajo terminado.', notify: false },
    };
  }

  if (!input.hasDueDate) {
    return {
      color: 'VERDE',
      decision: { status: 'SIN_DATOS', label: 'Sin fecha', reason: 'Falta fecha de entrega para evaluar el margen.', notify: false },
    };
  }

  if (!input.hasResponsable) {
    return {
      color: 'AMARILLO',
      decision: { status: 'ATENCION', label: 'Sin responsable', reason: 'Falta responsable para calcular segun su jornada.', notify: false },
    };
  }

  if (input.slackSec <= 0) {
    return {
      color: 'ROJO',
      decision: { status: 'VENCIDO', label: 'Vencido', reason: 'Ya paso la hora efectiva de entrega.', notify: true },
    };
  }

  if (input.marginSec < -input.redGraceSec) {
    return {
      color: 'ROJO',
      decision: { status: 'RIESGO', label: 'Riesgo alto', reason: 'El trabajo restante supera el margen laboral disponible.', notify: true },
    };
  }

  if (input.marginSec < 0) {
    return {
      color: 'AMARILLO',
      decision: { status: 'ATENCION', label: 'Margen ajustado', reason: 'Puede llegar, pero esta dentro de la tolerancia operativa.', notify: false },
    };
  }

  if (input.ratioAdjusted >= input.redThreshold && input.marginSec <= input.attentionMarginSec) {
    return {
      color: 'AMARILLO',
      decision: { status: 'ATENCION', label: 'Muy justo', reason: 'El margen existe, pero carga y complejidad lo vuelven ajustado.', notify: false },
    };
  }

  if (input.ratioAdjusted >= input.yellowThreshold || input.marginSec <= input.attentionMarginSec) {
    return {
      color: 'AMARILLO',
      decision: { status: 'ATENCION', label: 'Atencion', reason: 'Conviene vigilar el pedido por margen o carga del trabajador.', notify: false },
    };
  }

  return {
    color: 'VERDE',
    decision: { status: 'A_TIEMPO', label: 'A tiempo', reason: 'El tiempo laboral disponible cubre el trabajo restante.', notify: false },
  };
}

export async function getTiempoRealSec(pedidoId: number): Promise<number> {
  const now = new Date();
  const registros = await prisma.tiempos.findMany({
    where: { pedido_id: pedidoId },
    orderBy: { id: 'asc' },
    select: { duracion_sec: true, estado: true, inicio: true, fin: true, trabajador_id: true },
  });

  const scheduleCache = new Map<number, Awaited<ReturnType<typeof getWorkerSchedule>>>();
  const getScheduleCached = async (workerId: number) => {
    if (!scheduleCache.has(workerId)) {
      scheduleCache.set(workerId, await getWorkerSchedule(workerId));
    }
    return scheduleCache.get(workerId) ?? null;
  };

  let cerrados = 0;
  for (const registro of registros) {
    if (registro.estado !== 'CERRADO') continue;
    if (registro.inicio && registro.fin) {
      const schedule = await getScheduleCached(registro.trabajador_id);
      cerrados += businessSecondsBetween(new Date(registro.inicio), new Date(registro.fin), schedule?.shifts, schedule?.workdays);
      continue;
    }
    if (typeof registro.duracion_sec === 'number' && Number.isFinite(registro.duracion_sec)) {
      cerrados += Math.max(0, registro.duracion_sec || 0);
    }
  }

  const abierto = registros.find((registro) => registro.estado === 'ABIERTO');
  let abiertoSec = 0;
  if (abierto?.inicio) {
    const schedule = await getScheduleCached(abierto.trabajador_id);
    abiertoSec = businessSecondsBetween(new Date(abierto.inicio), now, schedule?.shifts, schedule?.workdays);
  }

  return cerrados + abiertoSec;
}

export async function computeSemaforoForPedido(pedidoId: number): Promise<SemaforoMetrics> {
  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: {
      estado: true,
      fecha_estimada_fin: true,
      prioridad: true,
      responsable_id: true,
      descripcion: true,
    },
  });

  if (!pedido) {
    return emptyMetrics({ status: 'SIN_DATOS', label: 'Sin datos', reason: 'Pedido no encontrado.', notify: false });
  }

  if (String(pedido.estado).toUpperCase() === 'ENTREGADO') {
    return emptyMetrics({ status: 'ENTREGADO', label: 'Entregado', reason: 'Trabajo terminado.', notify: false });
  }

  if (!pedido.fecha_estimada_fin) {
    return emptyMetrics({ status: 'SIN_DATOS', label: 'Sin fecha', reason: 'Falta fecha de entrega para evaluar el margen.', notify: false });
  }

  const responsableId = pedido.responsable_id ?? null;
  const schedule = responsableId ? await getWorkerSchedule(responsableId) : null;
  const effectiveDueAt = getEffectiveDueDate(pedido.fecha_estimada_fin, schedule?.shifts);
  if (!effectiveDueAt) {
    return emptyMetrics({ status: 'SIN_DATOS', label: 'Sin fecha', reason: 'La fecha de entrega no es valida.', notify: false });
  }

  const [tRealSec, estim] = await Promise.all([
    getTiempoRealSec(pedidoId),
    predictTiempoSecHybridDetailed(pedidoId, responsableId ?? 0),
  ]);

  const tEstimadoSec = estim.adjustedSec;
  const tRestanteSec = Math.max(0, tEstimadoSec - tRealSec);
  const slackSec = businessSecondsBetween(new Date(), effectiveDueAt, schedule?.shifts, schedule?.workdays);
  const marginSec = slackSec - tRestanteSec;
  const ratio = slackSec > 0 ? tRestanteSec / slackSec : Number.POSITIVE_INFINITY;

  const parsed = parseDescripcion(pedido.descripcion ?? '');
  const complexityScore = computeComplexityScore(parsed);
  const activeStates = ['PENDIENTE', 'ASIGNADO', 'EN_PROGRESO', 'QA'];
  const wipActual = responsableId
    ? await prisma.pedidos.count({ where: { responsable_id: responsableId, estado: { in: activeStates as any } } })
    : 0;
  const wipMax = Math.max(1, Number(process.env.WIP_MAX || 5));
  const loadRatio = Math.min(1, wipActual / wipMax);
  const ratioAdjusted = ratio * (1 + complexityScore * 0.25 + loadRatio * 0.15);
  const thresholds = getThresholds(pedido.prioridad as any);
  const redGraceSec = Math.max(0, Number(process.env.SEMAFORO_RED_GRACE_MINUTES ?? 15) * 60);
  const attentionMarginSec = Math.max(0, Number(process.env.SEMAFORO_ATTENTION_MARGIN_MINUTES ?? 30) * 60);
  const { color, decision } = decideSemaforoStatus({
    estado: pedido.estado,
    hasDueDate: true,
    hasResponsable: Boolean(responsableId),
    slackSec,
    marginSec,
    ratioAdjusted,
    yellowThreshold: thresholds.yellow,
    redThreshold: thresholds.red,
    redGraceSec,
    attentionMarginSec,
  });

  return {
    color,
    tRealSec,
    tEstimadoSec,
    tRestanteSec,
    slackSec,
    marginSec,
    ratio,
    ratioAdjusted,
    complexityScore,
    loadRatio,
    effectiveDueAt: effectiveDueAt.toISOString(),
    thresholds: {
      yellow: thresholds.yellow,
      red: thresholds.red,
      redGraceSec,
      attentionMarginSec,
    },
    decision,
    ml: {
      baseSec: estim.baseSec,
      adjustedSec: estim.adjustedSec,
      interval: estim.interval,
      modelVersion: estim.modelVersion,
      source: estim.source,
    },
    heuristics: {
      reasons: estim.reasons,
      complexityScore,
      loadRatio,
    },
  };
}

export async function applyAndEmitSemaforo(
  pedidoId: number,
): Promise<(SemaforoMetrics & { changed: boolean; prev?: SemaforoColor }) | null> {
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, include: { cliente: true } });
  if (!pedido) return null;

  const metrics = await computeSemaforoForPedido(pedidoId);
  const prev = pedido.semaforo as SemaforoColor;
  const color = metrics.color;

  if (prev !== color) {
    await prisma.pedidos.update({ where: { id: pedidoId }, data: { semaforo: color } }).catch(() => {});
  }

  try {
    if (prev !== color) {
      RealtimeService.emitToOperators('kanban:semaforo-changed', { pedidoId, semaforo: color, ...metrics });
    }

    if (color === 'ROJO' && metrics.decision.notify) {
      RealtimeService.emitWebAlert('RETRASO', `Pedido #${pedidoId} en riesgo (${metrics.decision.label})`, {
        pedidoId,
        ratio: metrics.ratio,
        ratioAdjusted: metrics.ratioAdjusted,
        marginSec: metrics.marginSec,
        decision: metrics.decision,
      });

      try {
        const cutoff = new Date(Date.now() - 30 * 60 * 1000);
        const recent = await prisma.notificaciones.findFirst({
          where: { pedido_id: pedidoId, tipo: 'ALERTA', fecha_creacion: { gte: cutoff } },
          orderBy: { id: 'desc' },
        });
        if (!recent) {
          await ClientNotificationService.createNotification({
            pedidoId,
            clienteId: pedido.cliente_id,
            mensaje: 'Tu pedido podria retrasarse. Estamos ajustando la planificacion.',
            tipo: 'ALERTA',
            title: 'Riesgo de retraso',
          });
        }
      } catch {}
    }
  } catch {}

  return { changed: prev !== color, prev, ...metrics };
}

export default { computeSemaforoForPedido, applyAndEmitSemaforo, getTiempoRealSec, businessSecondsBetween, getWorkerSchedule };
