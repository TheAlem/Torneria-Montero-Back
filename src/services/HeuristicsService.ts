import { prisma } from '../prisma/client.js';
import { calculateSuggestedDueDate, predictTiempoSecHybridDetailed } from './MLService.js';
import { normalizeSkills, parseDescripcion, skillOverlap } from './ml/features.js';
import { buildHardRequirements, isAyudanteRole, workerMeetsRequirements } from './heuristics/requirements.js';
import { collectGeneralTasks } from './heuristics/adjustments.js';
import { businessSecondsBetween, getWorkerSchedule } from './SemaforoService.js';

type RankedTrabajador = { id: number; score: number };

type WorkerStats = {
  completados: number;
  conFechaCompromiso: number;
  onTime: number;
  avgDelaySec: number | null;
  avgDesvio: number | null;
  coldStart: boolean;
};

type MaterialExperience = { material: string; count: number };
type RangeSec = { minSec: number; maxSec: number; bufferPct: number };

export type CandidateProfile = {
  trabajadorId: number;
  nombre: string | null;
  email: string | null;
  skills: string[];
  wipActual: number;
  wipMax: number;
  score: number;
  coldStart: boolean;
  desvioHistorico: number | null;
  precision: number | null;
  onTimeRate: number | null;
  delayPromedio: number | null;
  saturado: boolean;
  skillScore: number;
  wipScore: number;
  desvioScore: number;
  roleScore: number;
  onTimeScore: number;
  delayScore: number;
  prioridadScore: number;
  hardConstraints: string[];
  reasons: string[];
  isAyudante: boolean;
  etaSecBase?: number | null;
  etaSecAdjusted?: number | null;
  etaInterval?: { minSec: number; maxSec: number; bufferPct: number } | null;
  etaSec?: number | null;
  etaDiagnostics?: {
    modelBaseSec: number;
    perfFactor: number;
    scoreFactor: number;
    workerAdjustedSec: number;
    queueSec: number;
    totalSec: number;
  } | null;
  eta?: { display: string; fecha: string; hora: string; iso: string } | null;
  disponibilidad?: any;
  rol_tecnico?: string | null;
  materiales_experiencia?: MaterialExperience[];
};

function defaultStats(): WorkerStats {
  return {
    completados: 0,
    conFechaCompromiso: 0,
    onTime: 0,
    avgDelaySec: null,
    avgDesvio: null,
    coldStart: true,
  };
}

async function buildWorkerStats(workerIds: number[]): Promise<Map<number, WorkerStats>> {
  const stats = new Map<number, WorkerStats>();
  workerIds.forEach(id => stats.set(id, defaultStats()));
  if (!workerIds.length) return stats;

  const preds = await prisma.predicciones_tiempo.findMany({
    where: {
      trabajador_id: { in: workerIds },
      t_real_sec: { not: null },
      t_estimado_sec: { not: null },
    },
    select: { trabajador_id: true, desvio: true, t_real_sec: true, t_estimado_sec: true }
  });

  const delays: Record<number, number[]> = {};
  const desvios: Record<number, number[]> = {};
  preds.forEach(p => {
    const arr = desvios[p.trabajador_id] ||= [];
    const val = typeof p.desvio === 'number' && isFinite(p.desvio)
      ? p.desvio
      : (p.t_estimado_sec && p.t_real_sec ? Math.abs(p.t_real_sec - p.t_estimado_sec) / Math.max(1, p.t_estimado_sec) : null);
    if (val != null && isFinite(val)) arr.push(val);
  });

  const entregados = await prisma.pedidos.findMany({
    where: { responsable_id: { in: workerIds }, estado: 'ENTREGADO' },
    select: { responsable_id: true, fecha_inicio: true, fecha_estimada_fin: true, tiempo_real_sec: true, fecha_actualizacion: true }
  });
  const workerScheduleCache = new Map<number, { shifts: { startMin: number; endMin: number }[]; workdays?: Set<number> } | null>();
  const getScheduleCached = async (workerId: number) => {
    if (!workerScheduleCache.has(workerId)) {
      workerScheduleCache.set(workerId, await getWorkerSchedule(workerId));
    }
    return workerScheduleCache.get(workerId) ?? null;
  };

  for (const p of entregados) {
    const s = stats.get(p.responsable_id!) ?? defaultStats();
    s.completados += 1;
    const tReal = p.tiempo_real_sec ?? null;
    if (p.fecha_estimada_fin) {
      s.conFechaCompromiso += 1;
      const fechaInicio = p.fecha_inicio ? new Date(p.fecha_inicio) : null;
      const finReal = fechaInicio && tReal
        ? new Date(fechaInicio.getTime() + Math.max(0, tReal) * 1000)
        : (p.fecha_actualizacion ? new Date(p.fecha_actualizacion) : new Date());
      const due = new Date(p.fecha_estimada_fin);
      const schedule = await getScheduleCached(p.responsable_id!);
      const signedBusinessDeltaSec = businessSecondsBetween(due, finReal, schedule?.shifts, schedule?.workdays);
      const delaySec = Math.max(0, signedBusinessDeltaSec);
      if (signedBusinessDeltaSec <= 0) s.onTime += 1;
      if (delaySec > 0) {
        (delays[p.responsable_id] ||= []).push(delaySec);
      }
    }
    stats.set(p.responsable_id!, s);
  }

  for (const id of workerIds) {
    const s = stats.get(id) ?? defaultStats();
    const d = delays[id];
    if (d && d.length) s.avgDelaySec = d.reduce((a, b) => a + b, 0) / d.length;
    const dv = desvios[id];
    if (dv && dv.length) s.avgDesvio = dv.reduce((a, b) => a + b, 0) / dv.length;
    s.coldStart = s.completados === 0;
    stats.set(id, s);
  }
  return stats;
}

function prioridadScore(pr: string) {
  if (pr === 'ALTA') return 1;
  if (pr === 'MEDIA') return 0.7;
  return 0.4;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const ETA_COMBINED_FACTOR_MIN = Math.max(0.5, Number(process.env.ETA_COMBINED_FACTOR_MIN ?? 0.72));
const ETA_COMBINED_FACTOR_MAX = Math.min(2.5, Math.max(ETA_COMBINED_FACTOR_MIN, Number(process.env.ETA_COMBINED_FACTOR_MAX ?? 1.8)));
const ETA_SCORE_FACTOR_STRENGTH = Math.max(0.1, Number(process.env.ETA_SCORE_FACTOR_STRENGTH ?? 0.5));
const ETA_SCORE_FACTOR_MIN = Math.max(0.6, Number(process.env.ETA_SCORE_FACTOR_MIN ?? 0.8));
const ETA_SCORE_FACTOR_MAX = Math.min(1.5, Math.max(ETA_SCORE_FACTOR_MIN, Number(process.env.ETA_SCORE_FACTOR_MAX ?? 1.25)));
const ETA_INTERVAL_STRENGTH = Math.max(0.1, Number(process.env.ETA_INTERVAL_STRENGTH ?? 0.45));
const ETA_INTERVAL_FACTOR_MIN = Math.max(0.7, Number(process.env.ETA_INTERVAL_FACTOR_MIN ?? 0.9));
const ETA_INTERVAL_FACTOR_MAX = Math.min(2.2, Math.max(ETA_INTERVAL_FACTOR_MIN, Number(process.env.ETA_INTERVAL_FACTOR_MAX ?? 1.8)));

function fallbackPrioritySec(prioridad: string | null | undefined): number {
  if (prioridad === 'ALTA') return 3 * 3600;
  if (prioridad === 'MEDIA') return 6 * 3600;
  return 8 * 3600;
}

function estimateRemainingSecFromActivePedido(p: { tiempo_estimado_sec: number | null; tiempo_real_sec: number | null; prioridad: string | null }): number {
  const estimated = typeof p.tiempo_estimado_sec === 'number' && isFinite(p.tiempo_estimado_sec)
    ? p.tiempo_estimado_sec
    : fallbackPrioritySec(p.prioridad);
  const real = typeof p.tiempo_real_sec === 'number' && isFinite(p.tiempo_real_sec)
    ? Math.max(0, p.tiempo_real_sec)
    : 0;
  return Math.max(15 * 60, Math.round(estimated - real));
}

function workerPerformanceFactor(stats: WorkerStats): number {
  const desvio = stats.avgDesvio ?? 0.25;
  const onTime = stats.conFechaCompromiso > 0 ? (stats.onTime / Math.max(1, stats.conFechaCompromiso)) : 0.6;
  const delayNorm = stats.avgDelaySec != null ? Math.min(1, stats.avgDelaySec / (4 * 3600)) : 0.35;
  const raw = 1 + ((desvio - 0.25) * 0.4) + ((0.65 - onTime) * 0.3) + (delayNorm * 0.15);
  return clamp(raw, 0.8, 1.3);
}

function skillEtaFactor(skillScore: number): number {
  // Mayor afinidad técnica => menor tiempo esperado para ejecutar este trabajo.
  // 0.5 (neutral) => ~1.00 ; 1.0 => ~0.85 ; 0.0 => ~1.15
  const raw = 1 + ((0.5 - clamp(skillScore, 0, 1)) * 0.3);
  return clamp(raw, 0.85, 1.15);
}

function scoreEtaFactor(score: number): number {
  // Mejor score global => ejecución esperada algo más eficiente.
  // score=0.65 => ~1.00. Menor score incrementa ETA de forma más visible para evitar empates.
  const raw = 1 + ((0.65 - clamp(score, 0, 1)) * ETA_SCORE_FACTOR_STRENGTH);
  return clamp(raw, ETA_SCORE_FACTOR_MIN, ETA_SCORE_FACTOR_MAX);
}

function intervalEtaFactor(stats: WorkerStats, score: number): number {
  // Rango más amplio cuando el trabajador tiene mayor variabilidad/retraso histórico o score más bajo.
  const desvio = clamp(stats.avgDesvio ?? 0.35, 0, 1);
  const onTime = stats.conFechaCompromiso > 0 ? (stats.onTime / Math.max(1, stats.conFechaCompromiso)) : 0.55;
  const delayNorm = stats.avgDelaySec != null ? Math.min(1, stats.avgDelaySec / (4 * 3600)) : 0.35;
  const scorePenalty = clamp(0.65 - clamp(score, 0, 1), -0.2, 0.65);
  const coldPenalty = stats.coldStart ? 0.18 : 0;
  const raw = 1
    + ((desvio - 0.25) * ETA_INTERVAL_STRENGTH)
    + ((0.65 - onTime) * 0.25)
    + (delayNorm * 0.15)
    + (scorePenalty * 0.25)
    + coldPenalty;
  return clamp(raw, ETA_INTERVAL_FACTOR_MIN, ETA_INTERVAL_FACTOR_MAX);
}

function personalizeInterval(interval: RangeSec, factor: number): RangeSec {
  const min = Math.max(15 * 60, Math.round(interval.minSec));
  const max = Math.max(min + 60, Math.round(interval.maxSec));
  const mid = (min + max) / 2;
  const half = Math.max(60, ((max - min) / 2) * Math.max(0.5, factor));
  const minSec = Math.max(15 * 60, Math.round(mid - half));
  const maxSec = Math.max(minSec + 60, Math.round(mid + half));
  return {
    minSec,
    maxSec,
    bufferPct: Number((interval.bufferPct * Math.max(0.5, factor)).toFixed(3)),
  };
}

function shiftIntervalByQueue(interval: RangeSec, queueSec: number): RangeSec {
  const q = Math.max(0, Math.round(queueSec));
  return {
    minSec: interval.minSec + q,
    maxSec: interval.maxSec + q,
    bufferPct: interval.bufferPct,
  };
}

function normalizeRol(rol?: string | null): string {
  if (!rol) return '';
  const r = rol.toLowerCase().trim();
  if (r.includes('torner')) return 'torneado';
  if (r.includes('torno')) return 'torneado';
  if (r.includes('fres')) return 'fresado';
  if (r.includes('sold')) return 'soldadura';
  if (r.includes('ayud')) return 'ayudante';
  if (r.includes('pulid') || r.includes('acab')) return 'pulido';
  return r;
}

function roleMatchScore(rolToken: string, required: string[]): number {
  if (!rolToken) return 0.5;
  if (rolToken === 'ayudante') return 0.6; // puede asistir pero no liderar
  if (!required.length) return 0.5;
  return required.includes(rolToken) ? 1 : 0.4;
}

// Formatea ETA en piezas útiles (display, fecha, hora)
const formatEta = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fecha = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  const hora = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { display: `${fecha} ${hora}`, fecha, hora, iso: d.toISOString() };
};

export async function buildCandidatesForPedido(
  pedidoId: number,
  limit = 5,
  opts?: { includeUser?: boolean; includeEta?: boolean; includeAyudantes?: boolean }
): Promise<CandidateProfile[]> {
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { prioridad: true, descripcion: true } });
  if (!pedido) return [];

  const trabajadores = await prisma.trabajadores.findMany({
    where: { estado: { equals: 'Activo', mode: 'insensitive' } },
    include: opts?.includeUser ? { usuario: { select: { id: true, nombre: true, email: true } } } as any : undefined
  });
  if (!trabajadores.length) return [];

  const statsMap = await buildWorkerStats(trabajadores.map(t => t.id));
  // WIP real por responsable (Estados activos: PENDIENTE, ASIGNADO, EN_PROGRESO, QA). Si no hay, usamos carga_actual como fallback.
  const activeStates = ['PENDIENTE', 'ASIGNADO', 'EN_PROGRESO', 'QA'];
  const workerIds = trabajadores.map(t => t.id);
  const wipCounts = new Map<number, number>();
  workerIds.forEach(id => wipCounts.set(id, 0));
  const activos = await prisma.pedidos.findMany({
    where: { responsable_id: { in: workerIds }, estado: { in: activeStates as any } },
    select: { id: true, responsable_id: true, tiempo_estimado_sec: true, tiempo_real_sec: true, prioridad: true }
  });
  const queueSecByWorker = new Map<number, number>();
  for (const p of activos) {
    if (p.id === pedidoId) continue;
    const rid = p.responsable_id;
    wipCounts.set(rid, (wipCounts.get(rid) || 0) + 1);
    const rem = estimateRemainingSecFromActivePedido({
      tiempo_estimado_sec: p.tiempo_estimado_sec ?? null,
      tiempo_real_sec: p.tiempo_real_sec ?? null,
      prioridad: (p as any).prioridad ?? null,
    });
    queueSecByWorker.set(rid, (queueSecByWorker.get(rid) || 0) + rem);
  }

  const parsed = parseDescripcion(pedido.descripcion);
  const tags = [
    ...(parsed.materiales.acero ? ['acero'] : []),
    ...(parsed.materiales.acero_1045 ? ['acero_1045'] : []),
    ...(parsed.materiales.bronce ? ['bronce'] : []),
    ...(parsed.materiales.bronce_fundido ? ['bronce_fundido'] : []),
    ...(parsed.materiales.bronce_laminado ? ['bronce_laminado'] : []),
    ...(parsed.materiales.bronce_fosforado ? ['bronce_fosforado'] : []),
    ...(parsed.materiales.inox ? ['inox'] : []),
    ...(parsed.materiales.fundido ? ['fundido'] : []),
    ...(parsed.materiales.teflon ? ['teflon'] : []),
    ...(parsed.materiales.nylon ? ['nylon'] : []),
    ...(parsed.materiales.aluminio ? ['aluminio'] : []),
    ...(parsed.procesos.torneado ? ['torneado'] : []),
    ...(parsed.procesos.fresado ? ['fresado'] : []),
    ...(parsed.procesos.roscado ? ['roscado'] : []),
    ...(parsed.procesos.taladrado ? ['taladrado'] : []),
    ...(parsed.procesos.soldadura ? ['soldadura'] : []),
    ...(parsed.procesos.pulido ? ['pulido'] : []),
    ...(parsed.domain.rodamiento ? ['rodamiento'] : []),
    ...(parsed.domain.palier ? ['palier'] : []),
    ...(parsed.domain.buje ? ['buje'] : []),
    ...(parsed.domain.bandeja ? ['bandeja'] : []),
    ...(parsed.domain.tren_delantero ? ['tren_delantero'] : []),
    ...(parsed.domain.engranaje ? ['engranaje'] : []),
    ...(parsed.domain.corona ? ['corona'] : []),
    ...(parsed.domain.rellenado ? ['rellenado'] : []),
    ...(parsed.domain.recargue ? ['recargue'] : []),
    ...(parsed.domain.prensa ? ['prensa'] : []),
    ...(parsed.domain.alineado ? ['alineado'] : []),
    ...(parsed.domain.torneado_base ? ['torneado_base'] : []),
    ...(parsed.domain.amolado ? ['amolado'] : []),
    ...(parsed.domain.esmerilado ? ['esmerilado'] : []),
    ...(parsed.domain.corte ? ['corte'] : []),
    ...(parsed.domain.taladro_simple ? ['taladro_simple'] : []),
  ];
  const { requiredSkills, reasons: hardConstraintReasons } = buildHardRequirements(parsed);

  const wipMax = Math.max(1, Number(process.env.WIP_MAX || 5));
  const prioScore = prioridadScore(pedido.prioridad as any);

  const materialHistoryLimit = Number(process.env.ML_MATERIAL_HISTORY_LIMIT ?? 500);
  const materialByWorker = new Map<number, Record<string, number>>();
  if (materialHistoryLimit > 0) {
    const history = await prisma.pedidos.findMany({
      where: {
        responsable_id: { in: workerIds },
        estado: 'ENTREGADO',
      },
      select: { responsable_id: true, descripcion: true, fecha_actualizacion: true },
      orderBy: { fecha_actualizacion: 'desc' },
      take: materialHistoryLimit,
    });
    const addMat = (workerId: number, key: string) => {
      const bucket = materialByWorker.get(workerId) ?? {};
      bucket[key] = (bucket[key] || 0) + 1;
      materialByWorker.set(workerId, bucket);
    };
    for (const h of history) {
      if (!h.responsable_id) continue;
      const p = parseDescripcion(h.descripcion ?? '');
      const mats = p.materiales;
      if (mats.acero) addMat(h.responsable_id, 'acero');
      if (mats.acero_1045) addMat(h.responsable_id, 'acero_1045');
      if (mats.bronce) addMat(h.responsable_id, 'bronce');
      if (mats.bronce_fundido) addMat(h.responsable_id, 'bronce_fundido');
      if (mats.bronce_laminado) addMat(h.responsable_id, 'bronce_laminado');
      if (mats.bronce_fosforado) addMat(h.responsable_id, 'bronce_fosforado');
      if (mats.inox) addMat(h.responsable_id, 'inox');
      if (mats.fundido) addMat(h.responsable_id, 'fundido');
      if (mats.teflon) addMat(h.responsable_id, 'teflon');
      if (mats.nylon) addMat(h.responsable_id, 'nylon');
      if (mats.aluminio) addMat(h.responsable_id, 'aluminio');
    }
  }
  const getMaterialExperience = (workerId: number): MaterialExperience[] => {
    const bucket = materialByWorker.get(workerId);
    if (!bucket) return [];
    return Object.entries(bucket)
      .map(([material, count]) => ({ material, count }))
      .sort((a, b) => b.count - a.count);
  };

  const candidates: CandidateProfile[] = [];
  for (const t of trabajadores) {
    const stats = statsMap.get(t.id) ?? defaultStats();
    const baseSkills = normalizeSkills((t as any).skills);
    const rolToken = normalizeRol((t as any).rol_tecnico);
    const skills = rolToken ? Array.from(new Set([...baseSkills, rolToken])) : baseSkills;
    const { score: overlap } = skillOverlap(skills, tags);
    const skillScore = tags.length ? overlap : 0.6;
    const wipActual = wipCounts.get(t.id) ?? 0;
    // Penaliza más rápido por WIP: 0->1, 1->0.5, 2->0.33, 3->0.25
    const wipScore = Math.max(0, Math.min(1, 1 / (1 + Math.max(0, wipActual))));
    const roleScore = roleMatchScore(rolToken, requiredSkills);
    const desvioClamped = stats.avgDesvio != null ? Math.min(1, Math.max(0, stats.avgDesvio)) : null;
    const desvioScore = desvioClamped != null ? (1 - desvioClamped) : 0.5;
    const precision = desvioClamped != null ? (1 - desvioClamped) : null;
    const onTimeScore = stats.conFechaCompromiso > 0 ? (stats.onTime / Math.max(1, stats.conFechaCompromiso)) : null;
    const delayScore = stats.avgDelaySec != null ? Math.max(0, 1 - Math.min(1, stats.avgDelaySec / (4 * 3600))) : null;

    const isAyudante = isAyudanteRole(skills, rolToken);
    const meetsHard = workerMeetsRequirements(skills, rolToken, requiredSkills);
    if (!meetsHard) continue;
    if (isAyudante && !opts?.includeAyudantes) continue;

    const historyWeight = stats.completados > 0 ? Math.min(0.85, stats.completados / (stats.completados + 3)) : 0;
    const baseNeutral = 0.5;
    const raw = (0.20 * skillScore)
      + (0.20 * wipScore)
      + (0.20 * desvioScore)
      + (0.15 * roleScore)
      + (0.10 * (onTimeScore ?? 0.5))
      + (0.10 * (delayScore ?? 0.5))
      + (0.05 * prioScore);

    const blended = stats.coldStart
      ? baseNeutral
        + ((skillScore - 0.5) * 0.15)
        + ((wipScore - 0.5) * 0.20)
        + ((prioScore - 0.5) * 0.05)
      : baseNeutral * (1 - historyWeight) + raw * historyWeight;

    // Penalización adicional por WIP acumulado para empujar a quienes tienen menos trabajo
    const wipPenalty = Math.min(0.3, Math.max(0, wipActual) * 0.1); // 0.1 por trabajo, cap 0.3
    const finalScore = Number(Math.max(0, Math.min(1, blended - wipPenalty)).toFixed(4));

    let etaSec: number | null = null;
    let eta: CandidateProfile['eta'] = null;
    let etaSecBase: number | null = null;
    let etaSecAdjusted: number | null = null;
    let etaInterval: CandidateProfile['etaInterval'] = null;
    let etaDiagnostics: CandidateProfile['etaDiagnostics'] = null;
    let etaReasons: string[] = [];
    if (opts?.includeEta) {
      try {
        const estim = await predictTiempoSecHybridDetailed(pedidoId, t.id);
        const perfFactor = workerPerformanceFactor(stats);
        const skillFactor = skillEtaFactor(skillScore);
        const qualityFactor = scoreEtaFactor(finalScore);
        const combinedFactor = clamp(perfFactor * skillFactor * qualityFactor, ETA_COMBINED_FACTOR_MIN, ETA_COMBINED_FACTOR_MAX);
        const queueSec = queueSecByWorker.get(t.id) ?? 0;
        const baseWorkerSec = Math.round(estim.baseSec * combinedFactor);
        const adjustedWorkerSec = Math.round(estim.adjustedSec * combinedFactor);
        const totalSec = adjustedWorkerSec + queueSec;
        etaSecBase = baseWorkerSec;
        etaSecAdjusted = totalSec;
        etaDiagnostics = {
          modelBaseSec: estim.baseSec,
          perfFactor: combinedFactor,
          scoreFactor: qualityFactor,
          workerAdjustedSec: adjustedWorkerSec,
          queueSec,
          totalSec,
        };
        const intervalBase = shiftIntervalByQueue({
          minSec: Math.round(estim.interval.minSec * combinedFactor),
          maxSec: Math.round(estim.interval.maxSec * combinedFactor),
          bufferPct: estim.interval.bufferPct,
        }, queueSec);
        const intervalFactor = intervalEtaFactor(stats, finalScore);
        etaInterval = personalizeInterval(intervalBase, intervalFactor);
        etaReasons = estim.reasons;
        etaSec = totalSec;
        const due = await calculateSuggestedDueDate(totalSec, t.id);
        const parts = formatEta(due);
        eta = { display: parts.display, fecha: parts.fecha, hora: parts.hora, iso: parts.iso };
        if (queueSec > 0) etaReasons.push(`Cola actual del trabajador (+${Math.round(queueSec / 60)}m)`);
        if (Math.abs(combinedFactor - 1) >= 0.05) etaReasons.push(`Ajuste por desempeño/skill (x${combinedFactor.toFixed(2)})`);
        if (Math.abs(qualityFactor - 1) >= 0.03) etaReasons.push(`Ajuste por score candidato (x${qualityFactor.toFixed(2)})`);
        if (Math.abs(intervalFactor - 1) >= 0.05) etaReasons.push(`Ajuste de rango por incertidumbre (x${intervalFactor.toFixed(2)})`);
      } catch {}
    }

    const reasons: string[] = [];
    if (requiredSkills.length) reasons.push(...hardConstraintReasons);
    if (rolToken) reasons.push(`Rol técnico: ${rolToken}`);
    if (skillScore >= 0.8) reasons.push('Alta compatibilidad de skills');
    if (wipScore < 0.5) reasons.push('Carga actual alta');
    if (etaReasons.length) reasons.push(...etaReasons.slice(0, 3));

    candidates.push({
      trabajadorId: t.id,
      nombre: (t as any).usuario?.nombre ?? null,
      email: (t as any).usuario?.email ?? null,
      skills,
      wipActual,
      wipMax,
      score: finalScore,
      coldStart: historyWeight === 0,
      desvioHistorico: stats.avgDesvio,
      precision,
      onTimeRate: onTimeScore,
      delayPromedio: stats.avgDelaySec,
      saturado: wipActual >= wipMax,
      skillScore,
      wipScore,
      desvioScore,
      onTimeScore: onTimeScore ?? 0.5,
      delayScore: delayScore ?? 0.5,
      prioridadScore: prioScore,
      hardConstraints: hardConstraintReasons,
      reasons,
      isAyudante,
      etaSecBase,
      etaSecAdjusted,
      etaInterval,
      etaSec,
      etaDiagnostics,
      eta,
      disponibilidad: (t as any).disponibilidad ?? null,
      rol_tecnico: (t as any).rol_tecnico ?? null,
      roleScore,
      materiales_experiencia: getMaterialExperience(t.id),
    });
  }

  return candidates
    .sort((a, b) => {
      if (a.saturado !== b.saturado) return Number(a.saturado) - Number(b.saturado);
      if (b.score !== a.score) {
        // si están cercanos (<0.05), prioriza menor WIP
        const diff = b.score - a.score;
        if (Math.abs(diff) < 0.05) {
          if (a.wipActual !== b.wipActual) return a.wipActual - b.wipActual;
        }
        return diff > 0 ? 1 : -1;
      }
      const ta = typeof a.etaSec === 'number' ? a.etaSec! : Number.POSITIVE_INFINITY;
      const tb = typeof b.etaSec === 'number' ? b.etaSec! : Number.POSITIVE_INFINITY;
      return ta - tb;
    })
    .slice(0, limit);
}

export type SupportSuggestion = {
  trabajadorId: number;
  nombre: string | null;
  email: string | null;
  skills: string[];
  rol_tecnico: string | null;
  tareas_generales: string[];
  motivo: string;
};

export async function buildSupportCandidatesForPedido(pedidoId: number): Promise<SupportSuggestion[]> {
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { descripcion: true } });
  if (!pedido) return [];
  const parsed = parseDescripcion(pedido.descripcion);
  const generalTasks = collectGeneralTasks(parsed);
  if (!generalTasks.length) return [];

  const trabajadores = await prisma.trabajadores.findMany({
    where: { estado: 'Activo' },
    include: { usuario: { select: { id: true, nombre: true, email: true } } }
  });

  return trabajadores
    .map(t => {
      const skills = normalizeSkills((t as any).skills);
      const rolToken = normalizeRol((t as any).rol_tecnico);
      return {
        trabajadorId: t.id,
        nombre: (t as any).usuario?.nombre ?? null,
        email: (t as any).usuario?.email ?? null,
        skills,
        rol_tecnico: (t as any).rol_tecnico ?? null,
        tareas_generales: generalTasks,
        motivo: 'Apoyo manual sugerido (tareas generales)',
        isAyudante: isAyudanteRole(skills, rolToken),
      };
    })
    .filter(t => t.isAyudante)
    .map(({ isAyudante, ...rest }) => rest);
}

export async function rankTrabajadoresForPedido(pedidoId: number, limit = 5): Promise<RankedTrabajador[]> {
  const candidates = await buildCandidatesForPedido(pedidoId, limit);
  return candidates.map(c => ({ id: c.trabajadorId, score: c.score }));
}

export async function suggestTopTrabajador(pedidoId: number): Promise<RankedTrabajador | null> {
  const ranked = await rankTrabajadoresForPedido(pedidoId, 1);
  return ranked[0] ?? null;
}

export async function candidatesDetailsForPedido(pedidoId: number, limit = 5) {
  const candidates = await buildCandidatesForPedido(pedidoId, limit, { includeUser: true, includeEta: true });
  return candidates.map(c => ({
    trabajadorId: c.trabajadorId,
    nombre: c.nombre,
    email: c.email,
    rol_tecnico: c.rol_tecnico || null,
    skills: c.skills,
    materiales_experiencia: c.materiales_experiencia ?? [],
    disponibilidad: c.disponibilidad,
    carga_actual: c.wipActual,
    wipMax: c.wipMax,
    sobrecargado: c.saturado,
    score: c.score,
    tiempo_estimado_sec: c.etaSec,
    desvio_promedio: typeof c.desvioHistorico === 'number' ? Number(c.desvioHistorico.toFixed(3)) : null,
    precision: typeof c.precision === 'number' ? Number(c.precision.toFixed(3)) : null,
    onTimeRate: c.onTimeRate,
    delayPromedio: c.delayPromedio,
    coldStart: c.coldStart,
    tiempo_estimado_diagnostico: c.etaDiagnostics ?? null,
  }));
}
