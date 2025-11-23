import { prisma } from '../prisma/client.js';
import { predictTiempoSec } from './MLService.js';
import { normalizeSkills, parseDescripcion, skillOverlap } from './ml/features.js';

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
  onTimeScore: number;
  delayScore: number;
  prioridadScore: number;
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
  opts?: { includeUser?: boolean; includeEta?: boolean }
): Promise<CandidateProfile[]> {
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { prioridad: true, descripcion: true } });
  if (!pedido) return [];

  const trabajadores = await prisma.trabajadores.findMany({
    where: { estado: 'Activo' },
    include: opts?.includeUser ? { usuario: { select: { id: true, nombre: true, email: true } } } as any : undefined
  });
  if (!trabajadores.length) return [];

  const statsMap = await buildWorkerStats(trabajadores.map(t => t.id));
  const parsed = parseDescripcion(pedido.descripcion);
  const tags = [
    ...(parsed.materiales.acero ? ['acero'] : []),
    ...(parsed.materiales.aluminio ? ['aluminio'] : []),
    ...(parsed.materiales.bronce ? ['bronce'] : []),
    ...(parsed.materiales.inox ? ['inox'] : []),
    ...(parsed.materiales.plastico ? ['plastico'] : []),
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
  ];

  const wipMax = Math.max(1, Number(process.env.WIP_MAX || 5));
  const prioScore = prioridadScore(pedido.prioridad as any);

  const candidates: CandidateProfile[] = [];
  for (const t of trabajadores) {
    const stats = statsMap.get(t.id) ?? defaultStats();
    const skills = normalizeSkills((t as any).skills);
    const { score: overlap } = skillOverlap(skills, tags);
    const skillScore = tags.length ? overlap : 0.6;
    const wipActual = t.carga_actual || 0;
    const wipScore = Math.max(0, Math.min(1, 1 - (wipActual / Math.max(1, wipMax))));
    const desvioScore = stats.avgDesvio != null ? (1 - Math.min(1, Math.max(0, stats.avgDesvio))) : 0.5;
    const onTimeScore = stats.conFechaCompromiso > 0 ? (stats.onTime / Math.max(1, stats.conFechaCompromiso)) : null;
    const delayScore = stats.avgDelaySec != null ? Math.max(0, 1 - Math.min(1, stats.avgDelaySec / (4 * 3600))) : null;

    const historyWeight = stats.completados > 0 ? Math.min(0.85, stats.completados / (stats.completados + 3)) : 0;
    const baseNeutral = 0.5;
    const raw = (0.25 * skillScore)
      + (0.25 * wipScore)
      + (0.20 * desvioScore)
      + (0.15 * (onTimeScore ?? 0.5))
      + (0.10 * (delayScore ?? 0.5))
      + (0.05 * prioScore);

    const blended = stats.coldStart
      ? baseNeutral
        + ((skillScore - 0.5) * 0.15)
        + ((wipScore - 0.5) * 0.20)
        + ((prioScore - 0.5) * 0.05)
      : baseNeutral * (1 - historyWeight) + raw * historyWeight;

    const finalScore = Number(Math.max(0, Math.min(1, blended)).toFixed(4));

    let etaSec: number | null = null;
    let eta: CandidateProfile['eta'] = null;
    if (opts?.includeEta) {
      try {
        etaSec = await predictTiempoSec(pedidoId, t.id);
        const parts = formatEta(Date.now() + etaSec * 1000);
        eta = { display: parts.display, fecha: parts.fecha, hora: parts.hora, iso: parts.iso };
      } catch {}
    }

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
      etaSec,
      eta,
      disponibilidad: (t as any).disponibilidad ?? null,
      rol_tecnico: (t as any).rol_tecnico ?? null,
    });
  }

  return candidates
    .sort((a, b) => {
      if (a.saturado !== b.saturado) return Number(a.saturado) - Number(b.saturado);
      if (b.score !== a.score) return b.score - a.score;
      const ta = typeof a.etaSec === 'number' ? a.etaSec! : Number.POSITIVE_INFINITY;
      const tb = typeof b.etaSec === 'number' ? b.etaSec! : Number.POSITIVE_INFINITY;
      return ta - tb;
    })
    .slice(0, limit);
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
