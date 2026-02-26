import { prisma } from '../prisma/client.js';
import { recalcPedidoEstimate } from './MLService.js';
import { applyAndEmitSemaforo } from './SemaforoService.js';
import RealtimeService from '../realtime/RealtimeService.js';
import { logger } from '../utils/logger.js';
import { envFlag } from '../utils/env.js';
import { buildCandidatesForPedido, buildSupportCandidatesForPedido } from './HeuristicsService.js';

type Candidate = {
  trabajadorId: number;
  nombre: string | null;
  skills: string[];
  wipActual: number;
  wipMax: number;
  capacidadLibreMin: number; // placeholder (si no hay disponibilidad, queda 0)
  desvioHistorico: number;   // 0..1 (menor = mejor)
  precision: number | null;  // 0..1 (mayor = mejor)
  materiales_experiencia?: { material: string; count: number }[];
  etaSiToma: string | null;  // fecha/hora local sin año (dd/MM HH:mm)
  etaFecha?: string | null;  // dd/MM
  etaHora?: string | null;   // HH:mm
  etaIso?: string | null;    // ISO completa para cálculos/notificaciones
  saturado: boolean;
  score: number;
  razones?: string[];
  hardConstraints?: string[];
  tiempo_estimado_sec?: number | null;
  tiempo_estimado_base_sec?: number | null;
  tiempo_estimado_rango?: { minSec: number; maxSec: number; bufferPct: number } | null;
};

export async function suggestCandidates(pedidoId: number): Promise<Candidate[]> {
  const candidates = await buildCandidatesForPedido(pedidoId, 10, { includeUser: true, includeEta: true });
  return candidates.map(c => ({
    trabajadorId: c.trabajadorId,
    nombre: c.nombre,
    skills: c.skills,
    wipActual: c.wipActual,
    wipMax: c.wipMax,
    capacidadLibreMin: 0,
    desvioHistorico: typeof c.desvioHistorico === 'number' ? c.desvioHistorico : null,
    precision: typeof c.precision === 'number' ? c.precision : null,
    materiales_experiencia: c.materiales_experiencia ?? [],
    etaSiToma: c.eta?.display ?? null,
    etaFecha: c.eta?.fecha ?? null,
    etaHora: c.eta?.hora ?? null,
    etaIso: c.eta?.iso ?? null,
    saturado: c.saturado,
    score: c.score,
    razones: c.reasons,
    hardConstraints: c.hardConstraints,
    tiempo_estimado_sec: c.etaSecAdjusted ?? c.etaSec ?? null,
    tiempo_estimado_base_sec: c.etaSecBase ?? null,
    tiempo_estimado_rango: c.etaInterval ?? null,
  })).sort((a, b) => {
    if (a.saturado !== b.saturado) return Number(a.saturado) - Number(b.saturado);
    if (b.score !== a.score) return b.score - a.score;
    return 0;
  });
}

export async function suggestAssignmentBundle(pedidoId: number): Promise<{ candidates: Candidate[]; apoyoManual: any[] }> {
  const [candidates, apoyoManual] = await Promise.all([
    suggestCandidates(pedidoId),
    buildSupportCandidatesForPedido(pedidoId),
  ]);
  return { candidates, apoyoManual };
}

export async function autoAssignIfEnabled(pedidoId: number): Promise<boolean> {
  if (!envFlag('AUTO_ASSIGN_ENABLED', false)) return false;
  return autoAssignForced(pedidoId);
}

export async function autoAssignForced(pedidoId: number): Promise<boolean> {
  const candidates = await suggestCandidates(pedidoId);
  if (!candidates.length) return false;
  const choice = candidates.find(c => !c.saturado) || candidates[0];
  if (!choice || choice.saturado) return false;

  await prisma.asignaciones.create({ data: { pedido_id: pedidoId, trabajador_id: choice.trabajadorId, origen: 'SUGERIDO', comentarios: 'AUTO_ASSIGN_TOP1' } }).catch(() => {});
  await prisma.pedidos.update({ where: { id: pedidoId }, data: { responsable_id: choice.trabajadorId } });
  try { await recalcPedidoEstimate(pedidoId, { trabajadorId: choice.trabajadorId, updateFechaEstimada: true }); } catch {}
  await applyAndEmitSemaforo(pedidoId);
  try { RealtimeService.emitToOperators('assignment:changed', { pedidoId, trabajadorId: choice.trabajadorId, ts: Date.now() }); } catch {}
  return true;
}

export async function maybeReassignIfEnabled(pedidoId: number, color: 'VERDE'|'AMARILLO'|'ROJO', options?: { minScoreDelta?: number }) {
  if (color !== 'ROJO') return false;
  const autoReassignEnabled = envFlag('AUTO_REASSIGN_ENABLED', true);
  if (!autoReassignEnabled) {
    try { RealtimeService.emitToOperators('assignment:auto-keep', { pedidoId, reason: 'auto_reassign_disabled', ts: Date.now() }); } catch {}
    return false;
  }

  // Política operativa: ROJO alerta riesgo, pero solo reasignar cuando ya venció la fecha comprometida.
  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: { id: true, estado: true, fecha_estimada_fin: true, responsable_id: true }
  });
  if (!pedido) {
    try { RealtimeService.emitToOperators('assignment:auto-keep', { pedidoId, reason: 'pedido_missing', ts: Date.now() }); } catch {}
    return false;
  }
  if (String(pedido.estado).toUpperCase() === 'ENTREGADO') {
    try { RealtimeService.emitToOperators('assignment:auto-keep', { pedidoId, reason: 'already_delivered', ts: Date.now() }); } catch {}
    return false;
  }

  const onlyIfOverdue = envFlag('AUTO_REASSIGN_ONLY_IF_OVERDUE', true);
  const graceMin = Math.max(0, Number(process.env.AUTO_REASSIGN_OVERDUE_GRACE_MINUTES ?? 0));
  const dueAt = pedido.fecha_estimada_fin ? new Date(pedido.fecha_estimada_fin) : null;
  const dueWithGrace = dueAt ? new Date(dueAt.getTime() + graceMin * 60 * 1000) : null;
  const isOverdue = dueWithGrace ? Date.now() > dueWithGrace.getTime() : false;
  if (onlyIfOverdue && !isOverdue) {
    try {
      RealtimeService.emitToOperators('assignment:auto-keep', {
        pedidoId,
        reason: 'not_overdue_yet',
        dueAt: dueAt ? dueAt.toISOString() : null,
        graceMin,
        ts: Date.now()
      });
    } catch {}
    return false;
  }

  const candidates = await suggestCandidates(pedidoId);
  if (!candidates.length) {
    try { RealtimeService.emitToOperators('assignment:auto-keep', { pedidoId, reason: 'no_candidates', ts: Date.now() }); } catch {}
    return false;
  }

  // Evitar re-asignaciones en bucle: enfriar por N minutos desde la última AUTO_REASSIGN_DELAY
  const cooldownMin = Number(process.env.AUTO_REASSIGN_COOLDOWN_MINUTES ?? 60);
  if (cooldownMin > 0) {
    const cutoff = new Date(Date.now() - cooldownMin * 60 * 1000);
    const recent = await prisma.asignaciones.findFirst({
      where: { pedido_id: pedidoId, comentarios: 'AUTO_REASSIGN_DELAY', fecha_asignacion: { gte: cutoff } },
      orderBy: { fecha_asignacion: 'desc' }
    });
    if (recent) {
      try { RealtimeService.emitToOperators('assignment:auto-keep', { pedidoId, reason: 'cooldown', cooldownMin, ts: Date.now() }); } catch {}
      return false;
    }
  }

  const currentId = pedido.responsable_id ?? null;
  const currentCandidate = currentId ? candidates.find(c => c.trabajadorId === currentId) : undefined;
  const bestAvailable = candidates.find(c => !c.saturado) ?? candidates[0];
  const alternative = candidates.find(c => !c.saturado && c.trabajadorId !== currentId) ?? candidates.find(c => c.trabajadorId !== currentId);
  const target = alternative ?? bestAvailable;
  if (!target) {
    try { RealtimeService.emitToOperators('assignment:auto-keep', { pedidoId, reason: 'no_best', ts: Date.now(), currentId }); } catch {}
    return false;
  }

  const minDelta = typeof options?.minScoreDelta === 'number'
    ? options!.minScoreDelta
    : Number(process.env.AUTO_REASSIGN_MIN_DELTA ?? 0.1);
  const deltaScore = currentCandidate ? target.score - currentCandidate.score : target.score;
  const forceOnDelay = envFlag('AUTO_REASSIGN_FORCE_ON_DELAY', true);
  const maxDrop = Number(process.env.AUTO_REASSIGN_MAX_SCORE_DROP ?? 0.05); // límite para no saltar a alguien claramente peor
  const allowForce = forceOnDelay && currentId !== null && target.trabajadorId !== currentId && deltaScore >= -maxDrop;

  if (!currentId || target.trabajadorId === currentId || (deltaScore < minDelta && !allowForce)) {
    try {
      RealtimeService.emitToOperators('assignment:auto-keep', {
        pedidoId,
        reason: target.trabajadorId === currentId ? 'already_best' : 'delta_low',
        deltaScore,
        currentId,
        best: target,
        ts: Date.now()
      });
    } catch {}
    return false;
  }

  await prisma.asignaciones.create({
    data: {
      pedido_id: pedidoId,
      trabajador_id: target.trabajadorId,
      origen: 'MANUAL',
      comentarios: 'AUTO_REASSIGN_DELAY'
    }
  }).catch(() => {});

  await prisma.pedidos.update({
    where: { id: pedidoId },
    data: { responsable_id: target.trabajadorId }
  });

  await applyAndEmitSemaforo(pedidoId);

  const payload = {
    pedidoId,
    from: currentId,
    to: target.trabajadorId,
    deltaScore,
    ts: Date.now(),
    best: target,
    forced: allowForce
  };

  logger.info({ msg: '[Assignment] Auto reasignación por retraso', ...payload });
  try {
    RealtimeService.emitToOperators('assignment:auto-reassign', payload);
    RealtimeService.emitToOperators('assignment:changed', payload);
  } catch {}
  try {
    RealtimeService.emitWebAlert(
      'ASIGNACION',
      `Pedido #${pedidoId} reasignado automáticamente por retraso`,
      { pedidoId, from: currentId, to: target.trabajadorId, deltaScore }
    );
  } catch {}
  return true;
}

export default { suggestCandidates, autoAssignIfEnabled, maybeReassignIfEnabled };
