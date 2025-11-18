import { prisma } from '../prisma/client.js';
import { predictTiempoSec } from './MLService.js';
import { applyAndEmitSemaforo, computeSemaforoForPedido } from './SemaforoService.js';
import RealtimeService from '../realtime/RealtimeService.js';
import { logger } from '../utils/logger.js';
import { parseDescripcion, normalizeSkills, skillOverlap } from './ml/features.js';

type Candidate = {
  trabajadorId: number;
  nombre: string | null;
  skills: string[];
  wipActual: number;
  wipMax: number;
  capacidadLibreMin: number; // placeholder (si no hay disponibilidad, queda 0)
  desvioHistorico: number;   // 0..1 (menor = mejor)
  etaSiToma: string | null;  // fecha/hora local sin año (dd/MM HH:mm)
  etaFecha?: string | null;  // dd/MM
  etaHora?: string | null;   // HH:mm
  etaIso?: string | null;    // ISO completa para cálculos/notificaciones
  saturado: boolean;
  score: number;
};

// Formatea ETA en piezas útiles (display, fecha, hora)
const formatEta = (ts: number) => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const fecha = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  const hora = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { display: `${fecha} ${hora}`, fecha, hora };
};

function weights() {
  return {
    W1: Number(process.env.ASSIGN_W1 ?? 0.30), // (1 - WIP/WIP_MAX)
    W2: Number(process.env.ASSIGN_W2 ?? 0.20), // capacidad libre normalizada
    W3: Number(process.env.ASSIGN_W3 ?? 0.25), // match de skill (placeholder)
    W4: Number(process.env.ASSIGN_W4 ?? 0.15), // (1 - desvío)
    W5: Number(process.env.ASSIGN_W5 ?? 0.10), // boost por prioridad
  };
}

function normalize(n: number, min: number, max: number) {
  if (!isFinite(n) || !isFinite(min) || !isFinite(max) || max <= min) return 0;
  const v = (n - min) / (max - min);
  return Math.max(0, Math.min(1, v));
}

function prioridadBoost(pr: string) {
  return pr === 'ALTA' ? 1 : pr === 'MEDIA' ? 0.6 : 0.3;
}

export async function suggestCandidates(pedidoId: number): Promise<Candidate[]> {
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { prioridad: true, descripcion: true } });
  if (!pedido) return [];

  const trabajadores = await prisma.trabajadores.findMany({
    where: { estado: 'Activo' },
    include: { usuario: { select: { nombre: true } } }
  });
  if (!trabajadores.length) return [];

  // desvío histórico por trabajador (promedio)
  const desvios = await prisma.predicciones_tiempo.groupBy({ by: ['trabajador_id'], _avg: { desvio: true } });
  const desvioMap = new Map<number, number>();
  desvios.forEach(d => desvioMap.set(d.trabajador_id, d._avg.desvio ?? 0.3));

  const { W1, W2, W3, W4, W5 } = weights();
  const maxWipObserved = Math.max(...trabajadores.map(t => t.carga_actual || 0), 1);
  const maxCap = 1; // placeholder si no hay disponibilidad
  const wipMaxEnv = Math.max(1, Number(process.env.WIP_MAX || 5));

  const out: (Candidate & { etaMs?: number })[] = [];
  // Tags derivados de la descripción del pedido para evaluar match de skills
  const _parsed = parseDescripcion(pedido.descripcion);
  const tags = [
    ...(_parsed.materiales.acero ? ['acero'] : []),
    ...(_parsed.materiales.aluminio ? ['aluminio'] : []),
    ...(_parsed.materiales.bronce ? ['bronce'] : []),
    ...(_parsed.materiales.inox ? ['inox'] : []),
    ...(_parsed.procesos.torneado ? ['torneado'] : []),
    ...(_parsed.procesos.fresado ? ['fresado'] : []),
    ...(_parsed.procesos.roscado ? ['roscado'] : []),
    ...(_parsed.procesos.taladrado ? ['taladrado'] : []),
    ...(_parsed.procesos.soldadura ? ['soldadura'] : []),
    ...(_parsed.procesos.pulido ? ['pulido'] : []),
  ];
  for (const t of trabajadores) {
    const wipActual = t.carga_actual || 0;
    const wipMax = wipMaxEnv; // si tienes un campo por trabajador, úsalo
    const capacidadLibreMin = 0; // TODO: derivar de disponibilidad si existe
    const desvioHistorico = desvioMap.get(t.id) ?? 0.3;
    const skillArr = normalizeSkills((t as any).skills);
    const { score: match } = skillOverlap(skillArr, tags);

    const wipScore = 1 - normalize(wipActual, 0, Math.max(wipMax, maxWipObserved));
    const capScore = normalize(capacidadLibreMin, 0, maxCap);
    const desvioSc = 1 - Math.max(0, Math.min(1, desvioHistorico));
    const prioBoost = prioridadBoost(String(pedido.prioridad));

    const score = (W1 * wipScore) + (W2 * capScore) + (W3 * match) + (W4 * desvioSc) + (W5 * prioBoost);

    let eta: string | null = null;
    let etaFecha: string | null = null;
    let etaHora: string | null = null;
    let etaIso: string | null = null;
    let etaMs: number | undefined;
    try {
      const est = await predictTiempoSec(pedidoId, t.id);
      etaMs = Date.now() + est * 1000;
      etaIso = new Date(etaMs).toISOString();
      const fmt = formatEta(etaMs);
      eta = fmt.display;
      etaFecha = fmt.fecha;
      etaHora = fmt.hora;
    } catch {}

    const skills = Array.isArray((t as any).skills) ? (t as any).skills as string[] : skillArr;
    const saturado = wipActual >= wipMax;
    out.push({
      trabajadorId: t.id,
      nombre: t.usuario?.nombre ?? null,
      skills,
      wipActual,
      wipMax,
      capacidadLibreMin,
      desvioHistorico,
      etaSiToma: eta,
      etaFecha,
      etaHora,
      etaIso,
      saturado,
      score: Number(score.toFixed(4)),
      etaMs,
    });
  }

  // Orden único con tie-breakers:
  // 1) No saturados primero
  // 2) Score descendente
  // 3) ETA ascendente (si ambos tienen)
  return out
    .sort((a, b) => {
      if (a.saturado !== b.saturado) return Number(a.saturado) - Number(b.saturado);
      if (b.score !== a.score) return b.score - a.score;
      const ta = typeof a.etaMs === 'number' ? a.etaMs : Number.POSITIVE_INFINITY;
      const tb = typeof b.etaMs === 'number' ? b.etaMs : Number.POSITIVE_INFINITY;
      return ta - tb;
    })
    .map(({ etaMs, ...rest }) => rest);
}

export async function autoAssignIfEnabled(pedidoId: number): Promise<boolean> {
  if (String(process.env.AUTO_ASSIGN_ENABLED ?? 'false') !== 'true') return false;
  return autoAssignForced(pedidoId);
}

export async function autoAssignForced(pedidoId: number): Promise<boolean> {
  const candidates = await suggestCandidates(pedidoId);
  if (!candidates.length) return false;
  const choice = candidates.find(c => !c.saturado) || candidates[0];
  if (!choice || choice.saturado) return false;

  await prisma.asignaciones.create({ data: { pedido_id: pedidoId, trabajador_id: choice.trabajadorId, origen: 'SUGERIDO', comentarios: 'AUTO_ASSIGN_TOP1' } }).catch(() => {});
  await prisma.pedidos.update({ where: { id: pedidoId }, data: { responsable_id: choice.trabajadorId } });
  await applyAndEmitSemaforo(pedidoId);
  try { RealtimeService.emitToOperators('assignment:changed', { pedidoId, trabajadorId: choice.trabajadorId, ts: Date.now() }); } catch {}
  return true;
}

export async function maybeReassignIfEnabled(pedidoId: number, color: 'VERDE'|'AMARILLO'|'ROJO', options?: { minScoreDelta?: number }) {
  if (color !== 'ROJO') return false;
  const candidates = await suggestCandidates(pedidoId);
  if (!candidates.length) {
    try { RealtimeService.emitToOperators('assignment:auto-keep', { pedidoId, reason: 'no_candidates', ts: Date.now() }); } catch {}
    return false;
  }

  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    include: {
      responsable: { include: { usuario: { select: { id: true, nombre: true } } } },
      cliente: { select: { id: true, nombre: true } }
    }
  });

  const currentId = pedido?.responsable_id ?? null;
  const best = candidates.find(c => !c.saturado) ?? candidates[0];
  const currentCandidate = currentId ? candidates.find(c => c.trabajadorId === currentId) : undefined;
  if (!best) {
    try { RealtimeService.emitToOperators('assignment:auto-keep', { pedidoId, reason: 'no_best', ts: Date.now(), currentId }); } catch {}
    return false;
  }

  const minDelta = typeof options?.minScoreDelta === 'number'
    ? options!.minScoreDelta
    : Number(process.env.AUTO_REASSIGN_MIN_DELTA ?? 0.1);
  const deltaScore = currentCandidate ? best.score - currentCandidate.score : best.score;

  if (!currentId || currentId === best.trabajadorId || deltaScore < minDelta) {
    try {
      RealtimeService.emitToOperators('assignment:auto-keep', {
        pedidoId,
        reason: currentId === best.trabajadorId ? 'already_best' : 'delta_low',
        deltaScore,
        currentId,
        best,
        ts: Date.now()
      });
    } catch {}
    return false;
  }

  await prisma.asignaciones.create({
    data: {
      pedido_id: pedidoId,
      trabajador_id: best.trabajadorId,
      origen: 'MANUAL',
      comentarios: 'AUTO_REASSIGN_DELAY'
    }
  }).catch(() => {});

  await prisma.pedidos.update({
    where: { id: pedidoId },
    data: { responsable_id: best.trabajadorId }
  });

  await applyAndEmitSemaforo(pedidoId);

  const payload = {
    pedidoId,
    from: currentId,
    to: best.trabajadorId,
    deltaScore,
    ts: Date.now(),
    best
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
      { pedidoId, from: currentId, to: best.trabajadorId, deltaScore }
    );
  } catch {}
  return true;
}

export default { suggestCandidates, autoAssignIfEnabled, maybeReassignIfEnabled };

