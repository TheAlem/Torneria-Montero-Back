import { prisma } from '../prisma/client.js';
import { predictTiempoSecHybridDetailed } from './MLService.js';
import { normalizeSkills, parseDescripcion, skillOverlap } from './ml/features.js';
import { buildHardRequirements, isAyudanteRole, workerMeetsRequirements } from './heuristics/requirements.js';
import { collectGeneralTasks } from './heuristics/adjustments.js';

type RankedTrabajador = { id: number; score: number };

type WorkerStats = {
  completados: number;
  conFechaCompromiso: number;
  onTime: number;
  avgDelaySec: number | null;
  avgDesvio: number | null;
  coldStart: boolean;
};

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
  eta?: { display: string; fecha: string; hora: string; iso: string } | null;
  disponibilidad?: any;
  rol_tecnico?: string | null;
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
      const delaySec = Math.max(0, Math.round((finReal.getTime() - new Date(p.fecha_estimada_fin).getTime()) / 1000));
      if (delaySec === 0) s.onTime += 1;
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
const formatEta = (ts: number) => {
  const d = new Date(ts);
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
    where: { estado: 'Activo' },
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
    select: { responsable_id: true }
  });
  for (const p of activos) {
    const rid = p.responsable_id;
    wipCounts.set(rid, (wipCounts.get(rid) || 0) + 1);
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

  const candidates: CandidateProfile[] = [];
  for (const t of trabajadores) {
    const stats = statsMap.get(t.id) ?? defaultStats();
    const skills = normalizeSkills((t as any).skills);
    const { score: overlap } = skillOverlap(skills, tags);
    const skillScore = tags.length ? overlap : 0.6;
    const wipActual = wipCounts.get(t.id) ?? 0;
    // Penaliza más rápido por WIP: 0->1, 1->0.5, 2->0.33, 3->0.25
    const wipScore = Math.max(0, Math.min(1, 1 / (1 + Math.max(0, wipActual))));
    const rolToken = normalizeRol((t as any).rol_tecnico);
    const roleScore = roleMatchScore(rolToken, requiredSkills);
    const desvioScore = stats.avgDesvio != null ? (1 - Math.min(1, Math.max(0, stats.avgDesvio))) : 0.5;
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
    let etaReasons: string[] = [];
    if (opts?.includeEta) {
      try {
        const estim = await predictTiempoSecHybridDetailed(pedidoId, t.id);
        etaSecBase = estim.baseSec;
        etaSecAdjusted = estim.adjustedSec;
        etaInterval = estim.interval;
        etaReasons = estim.reasons;
        etaSec = estim.adjustedSec;
        const parts = formatEta(Date.now() + estim.adjustedSec * 1000);
        eta = { display: parts.display, fecha: parts.fecha, hora: parts.hora, iso: parts.iso };
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
      eta,
      disponibilidad: (t as any).disponibilidad ?? null,
      rol_tecnico: (t as any).rol_tecnico ?? null,
      roleScore,
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
    disponibilidad: c.disponibilidad,
    carga_actual: c.wipActual,
    wipMax: c.wipMax,
    sobrecargado: c.saturado,
    score: c.score,
    tiempo_estimado_sec: c.etaSec,
    desvio_promedio: typeof c.desvioHistorico === 'number' ? Number(c.desvioHistorico.toFixed(3)) : null,
    onTimeRate: c.onTimeRate,
    delayPromedio: c.delayPromedio,
    coldStart: c.coldStart,
  }));
}
