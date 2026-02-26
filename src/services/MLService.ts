import { prisma } from '../prisma/client.js';
import { predictWithLinearModel, predictWithLatestModel, predictWithLatestModelInfo, predictWithLinearModelInfo } from './ml/predictor.js';
import { getMinSeconds, getMaxSeconds } from './ml/storage.js';
import { parseDescripcion } from './ml/features.js';
import { applyHeuristicAdjustments, buildEstimateInterval } from './heuristics/adjustments.js';
import { logger } from '../utils/logger.js';
import RealtimeService from '../realtime/RealtimeService.js';

const median = (arr: number[]) => {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

type Shift = { startMin: number; endMin: number };
type WorkerSchedule = { shifts: Shift[]; workdays?: Set<number> } | null;

const DEFAULT_WORK_DAYS = process.env.WORKDAYS || '1-6';
const DEFAULT_WORKDAY_SHIFTS = process.env.WORKDAY_SHIFTS || '08:00-12:00,13:00-17:00';
const DEFAULT_WORKDAY_SHIFTS_SAT = process.env.WORKDAY_SHIFTS_SAT || '08:00-12:00';
const ETA_TIMEZONE_OFFSET_MIN = Number(process.env.ETA_TIMEZONE_OFFSET_MIN ?? -240); // America/La_Paz (UTC-4)
const MAX_DAILY_WORK_MINUTES = Math.max(
  60,
  Math.min(24 * 60, Math.round((Number(process.env.WORKER_MAX_DAILY_HOURS ?? 8) || 8) * 60))
);
const ETA_TZ_OFFSET_MS = (Number.isFinite(ETA_TIMEZONE_OFFSET_MIN) ? ETA_TIMEZONE_OFFSET_MIN : -240) * 60 * 1000;

const capShiftsToDailyLimit = (shifts: Shift[]): Shift[] => {
  const ordered = [...shifts].sort((a, b) => a.startMin - b.startMin);
  const out: Shift[] = [];
  let remaining = MAX_DAILY_WORK_MINUTES;
  for (const sh of ordered) {
    if (remaining <= 0) break;
    const len = sh.endMin - sh.startMin;
    if (len <= 0) continue;
    if (len <= remaining) {
      out.push(sh);
      remaining -= len;
      continue;
    }
    out.push({ startMin: sh.startMin, endMin: sh.startMin + remaining });
    remaining = 0;
  }
  return out;
};

const parseHHMM = (v: string): { h: number; m: number } => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(v || '');
  if (!match) return { h: 8, m: 0 };
  const h = Math.min(23, Math.max(0, Number(match[1])));
  const m = Math.min(59, Math.max(0, Number(match[2])));
  return { h, m };
};

const parseShifts = (raw: string): Shift[] => {
  const out: Shift[] = [];
  const parts = (raw || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const [s, e] = p.split('-').map(x => (x || '').trim());
    if (!s || !e) continue;
    const sh = parseHHMM(s);
    const eh = parseHHMM(e);
    const startMin = sh.h * 60 + sh.m;
    const endMin = eh.h * 60 + eh.m;
    if (endMin > startMin) out.push({ startMin, endMin });
  }
  const capped = capShiftsToDailyLimit(out);
  if (!capped.length) return [{ startMin: 8 * 60, endMin: 16 * 60 }];
  return capped;
};

const parseWorkdays = (raw: string): Set<number> => {
  const parts = (raw || '').split(',').map(p => p.trim()).filter(Boolean);
  const set = new Set<number>();
  for (const p of parts) {
    if (p.includes('-')) {
      const [aRaw, bRaw] = p.split('-');
      const a = Number(aRaw);
      const b = Number(bRaw);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const start = Math.max(0, Math.min(6, a));
        const end = Math.max(0, Math.min(6, b));
        for (let d = start; d <= end; d++) set.add(d);
      }
      continue;
    }
    const n = Number(p);
    if (Number.isFinite(n)) set.add(Math.max(0, Math.min(6, n)));
  }
  if (!set.size) for (let d = 1; d <= 6; d++) set.add(d);
  return set;
};

const globalWorkdays = parseWorkdays(DEFAULT_WORK_DAYS);
const globalShifts = parseShifts(DEFAULT_WORKDAY_SHIFTS);
const saturdayShifts = parseShifts(DEFAULT_WORKDAY_SHIFTS_SAT);

const getShiftsForDay = (dayIdx: number, schedule?: WorkerSchedule): Shift[] => {
  const workdays = schedule?.workdays && schedule.workdays.size ? schedule.workdays : globalWorkdays;
  if (!workdays.has(dayIdx)) return [];
  if (schedule?.shifts?.length) return schedule.shifts;
  if (dayIdx === 6 && saturdayShifts.length) return saturdayShifts;
  return globalShifts;
};

const dayStartAt = (d: Date, min: number) => {
  const dt = new Date(d);
  dt.setUTCHours(Math.floor(min / 60), min % 60, 0, 0);
  return dt;
};

const toEtaWallClock = (d: Date): Date => new Date(d.getTime() + ETA_TZ_OFFSET_MS);
const fromEtaWallClock = (d: Date): Date => new Date(d.getTime() - ETA_TZ_OFFSET_MS);

const nextBusinessStart = (from: Date, schedule?: WorkerSchedule): Date => {
  const base = new Date(from);
  for (let i = 0; i < 370; i++) {
    const day = new Date(base);
    day.setUTCDate(base.getUTCDate() + i);
    day.setUTCHours(0, 0, 0, 0);
    const shifts = getShiftsForDay(day.getUTCDay(), schedule);
    for (const sh of shifts) {
      const start = dayStartAt(day, sh.startMin);
      if (start.getTime() > from.getTime()) return start;
    }
  }
  return new Date(from);
};

function addBusinessSecondsFrom(start: Date, sec: number, schedule?: WorkerSchedule): Date {
  let remaining = Math.max(0, Math.round(sec));
  let cursor = new Date(start);
  if (remaining <= 0) return cursor;
  let guard = 0;

  while (remaining > 0 && guard < 5000) {
    const shifts = getShiftsForDay(cursor.getUTCDay(), schedule);
    let advancedInDay = false;

    for (const sh of shifts) {
      const wStart = dayStartAt(cursor, sh.startMin);
      const wEnd = dayStartAt(cursor, sh.endMin);
      if (cursor < wStart) cursor = new Date(wStart);
      if (cursor >= wEnd) continue;

      const slotSec = Math.floor((wEnd.getTime() - cursor.getTime()) / 1000);
      if (slotSec <= 0) continue;
      advancedInDay = true;

      if (remaining <= slotSec) {
        return new Date(cursor.getTime() + remaining * 1000);
      }
      remaining -= slotSec;
      cursor = new Date(wEnd);
    }

    if (remaining <= 0) break;
    if (!advancedInDay) {
      cursor = nextBusinessStart(cursor, schedule);
    } else {
      cursor = nextBusinessStart(new Date(cursor.getTime() + 1000), schedule);
    }
    guard++;
  }
  return cursor;
}

function businessSecondsBetweenSigned(a: Date, b: Date, schedule?: WorkerSchedule): number {
  if (a.getTime() === b.getTime()) return 0;
  const aa = toEtaWallClock(a);
  const bb = toEtaWallClock(b);
  const forward = (from: Date, to: Date) => {
    let total = 0;
    let cursor = new Date(from);
    let guard = 0;
    while (cursor < to && guard < 3700) {
      const shifts = getShiftsForDay(cursor.getUTCDay(), schedule);
      const day0 = new Date(cursor);
      day0.setUTCHours(0, 0, 0, 0);
      for (const sh of shifts) {
        const wStart = dayStartAt(day0, sh.startMin);
        const wEnd = dayStartAt(day0, sh.endMin);
        const fromPoint = cursor > wStart ? cursor : wStart;
        const toPoint = to < wEnd ? to : wEnd;
        if (toPoint > fromPoint) {
          total += Math.round((toPoint.getTime() - fromPoint.getTime()) / 1000);
        }
      }
      const nextDay = new Date(day0);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      cursor = nextDay;
      guard++;
    }
    return total;
  };
  if (bb > aa) return forward(aa, bb);
  return -forward(bb, aa);
}

async function getWorkerScheduleForEta(workerId?: number | null): Promise<WorkerSchedule> {
  if (!workerId) return null;
  const worker = await prisma.trabajadores.findUnique({
    where: { id: workerId },
    select: { disponibilidad: true },
  }).catch(() => null);
  const disp = worker?.disponibilidad as any;
  if (!disp || typeof disp !== 'object') return null;

  const shifts = Array.isArray(disp.shifts) ? parseShifts(disp.shifts.join(',')) : [];
  const days = Array.isArray(disp.days)
    ? new Set<number>(disp.days.map((d: any) => Number(d)).filter((d: number) => Number.isFinite(d) && d >= 0 && d <= 6))
    : undefined;
  if (!shifts.length) return null;
  return { shifts, workdays: days };
}

export async function calculateSuggestedDueDate(
  estimatedSec: number,
  workerId?: number | null,
  fromDate = new Date()
): Promise<Date> {
  const schedule = await getWorkerScheduleForEta(workerId);
  const startWallClock = toEtaWallClock(fromDate);
  const dueWallClock = addBusinessSecondsFrom(startWallClock, estimatedSec, schedule);
  return fromEtaWallClock(dueWallClock);
}

export async function predictTiempoSecDetailed(
  pedidoId: number,
  trabajadorId?: number | null
): Promise<{ sec: number; modelVersion: string; source: string }> {
  const MIN_SEC = getMinSeconds();
  const MAX_SEC = getMaxSeconds();
  const HISTORY_MIN_SAME_PRIORITY = Math.max(1, Number(process.env.ML_HISTORY_MIN_SAME_PRIORITY ?? 5));
  const HISTORY_MIN_GENERAL = Math.max(HISTORY_MIN_SAME_PRIORITY, Number(process.env.ML_HISTORY_MIN_GENERAL ?? 8));
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
  if (!pedido) return { sec: 4 * 60 * 60, modelVersion: 'fallback', source: 'pedido_missing' }; // 4h fallback
  const workerId = trabajadorId && trabajadorId > 0 ? trabajadorId : null;
  const trabajador = workerId
    ? await prisma.trabajadores.findUnique({ where: { id: workerId }, select: { skills: true, carga_actual: true, fecha_ingreso: true } }).catch(() => null)
    : null;

  // Histórico robusto: sumar por pedido+trabajador para evitar sesgo por tramos de tiempos.
  const tiemposTrab = workerId
    ? await prisma.tiempos.findMany({
      where: {
        trabajador_id: workerId,
        estado: 'CERRADO',
        duracion_sec: { not: null },
        pedido: { estado: 'ENTREGADO' },
      },
      select: { id: true, pedido_id: true, duracion_sec: true, pedido: { select: { prioridad: true } } },
      orderBy: { id: 'desc' },
      take: 250,
    })
    : [];

  const byPedido = new Map<number, { totalSec: number; prioridad: string | null; maxId: number }>();
  for (const t of tiemposTrab) {
    const current = byPedido.get(t.pedido_id) ?? { totalSec: 0, prioridad: t.pedido?.prioridad ?? null, maxId: 0 };
    current.totalSec += Number(t.duracion_sec || 0);
    current.maxId = Math.max(current.maxId, t.id);
    if (!current.prioridad && t.pedido?.prioridad) current.prioridad = t.pedido.prioridad;
    byPedido.set(t.pedido_id, current);
  }

  const historico = Array.from(byPedido.values())
    .sort((a, b) => b.maxId - a.maxId)
    .slice(0, 50)
    .map(x => ({ totalSec: x.totalSec, prioridad: x.prioridad }));

  const mismos = historico
    .filter(h => h.prioridad === pedido.prioridad)
    .map(h => h.totalSec)
    .filter(v => typeof v === 'number' && isFinite(v) && v >= MIN_SEC && v <= MAX_SEC);
  const generales = historico
    .map(h => h.totalSec)
    .filter(v => typeof v === 'number' && isFinite(v) && v >= MIN_SEC && v <= MAX_SEC);

  if (mismos.length >= HISTORY_MIN_SAME_PRIORITY || generales.length >= HISTORY_MIN_GENERAL) {
    const arr = mismos.length >= HISTORY_MIN_SAME_PRIORITY ? mismos : generales;
    const med = median(arr) ?? arr[0];
    if (typeof med === 'number' && isFinite(med)) {
      return { sec: Math.min(MAX_SEC, Math.max(MIN_SEC, Math.round(med))), modelVersion: 'historico', source: 'historico' };
    }
  }

  // Intentar modelo entrenado (si existe)
  const precioNum = typeof (pedido as any).precio === 'object' || typeof (pedido as any).precio === 'string' ? Number((pedido as any).precio as any) : ((pedido as any).precio ?? 0);
  const descripcion = (pedido as any).descripcion ?? null;
  const workerSkills = trabajador?.skills ?? null;
  const cargaActual = trabajador?.carga_actual ?? null;
  const fechaIngreso = trabajador?.fecha_ingreso ?? null;

  // Linear model (DB then FS)
  {
    const modelPredDB = await predictWithLatestModelInfo({ prioridad: pedido.prioridad as any, precio: precioNum, descripcion, workerSkills, cargaActual, fechaIngreso });
    if (modelPredDB) return { sec: Math.min(MAX_SEC, Math.max(MIN_SEC, modelPredDB.value)), modelVersion: modelPredDB.version, source: 'db_model' };
    const modelPredFS = predictWithLinearModelInfo({ prioridad: pedido.prioridad as any, precio: precioNum, descripcion, workerSkills, cargaActual, fechaIngreso });
    if (modelPredFS) return { sec: Math.min(MAX_SEC, Math.max(MIN_SEC, modelPredFS.value)), modelVersion: modelPredFS.version, source: 'fs_model' };
  }

  // Fallback por prioridad
  if (pedido.prioridad === 'ALTA') return { sec: Math.min(MAX_SEC, 3 * 60 * 60), modelVersion: 'fallback', source: 'fallback_alta' };
  if (pedido.prioridad === 'MEDIA') return { sec: Math.min(MAX_SEC, 6 * 60 * 60), modelVersion: 'fallback', source: 'fallback_media' };
  return { sec: Math.min(MAX_SEC, 8 * 60 * 60), modelVersion: 'fallback', source: 'fallback_baja' };
}

export async function predictTiempoSec(pedidoId: number, trabajadorId?: number | null): Promise<number> {
  const result = await predictTiempoSecDetailed(pedidoId, trabajadorId);
  return result.sec;
}

export async function predictTiempoSecHybridDetailed(
  pedidoId: number,
  trabajadorId?: number | null
): Promise<{
  baseSec: number;
  adjustedSec: number;
  interval: { minSec: number; maxSec: number; bufferPct: number };
  reasons: string[];
  modelVersion: string;
  source: string;
}> {
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { descripcion: true } });
  const base = await predictTiempoSecDetailed(pedidoId, trabajadorId);
  const parsed = parseDescripcion(pedido?.descripcion ?? '');
  const adjustments = applyHeuristicAdjustments(parsed, base.sec);
  const adjustedSec = Math.max(getMinSeconds(), Math.min(getMaxSeconds(), Math.round(base.sec * adjustments.multiplier + adjustments.addSec)));
  const interval = buildEstimateInterval(adjustedSec, parsed);
  logger.info({
    msg: '[HybridEstimate] Predicción híbrida',
    pedidoId,
    trabajadorId: trabajadorId ?? null,
    baseSec: base.sec,
    adjustedSec,
    modelVersion: base.modelVersion,
    source: base.source,
    reasons: adjustments.reasons,
    parsed,
  });
  return {
    baseSec: base.sec,
    adjustedSec,
    interval,
    reasons: adjustments.reasons,
    modelVersion: base.modelVersion,
    source: base.source,
  };
}

export async function storePrediccion(pedidoId: number, trabajadorId: number, tEstimadoSec: number, modeloVersion = 'v1.0') {
  if (!trabajadorId) return;
  try {
    await prisma.predicciones_tiempo.create({
      data: {
        pedido_id: pedidoId,
        trabajador_id: trabajadorId,
        t_estimado_sec: tEstimadoSec,
        modelo_version: modeloVersion,
      },
    });
  } catch (_) { /* swallow */ }
}

export async function upsertResultadoPrediccion(
  pedidoId: number,
  trabajadorId: number | null | undefined,
  tRealSec: number | null,
  tEstimadoSec?: number | null,
  modeloVersion = 'v1.0'
) {
  if (!trabajadorId) return { updated: false };
  const est = tEstimadoSec ?? null;
  const desvio = est && tRealSec != null
    ? Math.min(1, Math.abs(tRealSec - est) / Math.max(1, est))
    : null;

  const existing = await prisma.predicciones_tiempo.findFirst({
    where: { pedido_id: pedidoId, trabajador_id: trabajadorId },
    orderBy: { id: 'desc' },
  });

  if (existing) {
    await prisma.predicciones_tiempo.update({
      where: { id: existing.id },
      data: { t_real_sec: tRealSec, t_estimado_sec: est ?? existing.t_estimado_sec, desvio: desvio ?? existing.desvio ?? undefined }
    });
    return { updated: true, desvio };
  }

  await prisma.predicciones_tiempo.create({
    data: {
      pedido_id: pedidoId,
      trabajador_id: trabajadorId,
      t_estimado_sec: est,
      t_real_sec: tRealSec,
      desvio,
      modelo_version: modeloVersion,
    }
  });
  return { updated: true, desvio };
}

export async function recalcPedidoEstimate(pedidoId: number, opts?: { trabajadorId?: number | null; updateFechaEstimada?: boolean }) {
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { responsable_id: true, fecha_estimada_fin: true } });
  if (!pedido) return null;
  const workerId = opts?.trabajadorId ?? pedido.responsable_id ?? null;
  const estimado = await predictTiempoSecHybridDetailed(pedidoId, workerId);
  const data: any = { tiempo_estimado_sec: estimado.adjustedSec };
  const previousDue = pedido.fecha_estimada_fin ? new Date(pedido.fecha_estimada_fin) : null;
  const schedule = await getWorkerScheduleForEta(workerId);
  const suggestedDue = await calculateSuggestedDueDate(estimado.adjustedSec, workerId ?? undefined, new Date());
  const askedToUpdateFecha = opts?.updateFechaEstimada === true
    || (opts?.updateFechaEstimada !== false && !pedido.fecha_estimada_fin);
  const etaAutoUpdateEnabled = String(process.env.ETA_AUTO_UPDATE_ENABLED ?? 'false').toLowerCase() === 'true';
  const minSuggestDeltaSec = Math.max(60, Number(process.env.ETA_SUGGEST_MIN_DELTA_SEC ?? 300));
  const deltaSec = previousDue ? businessSecondsBetweenSigned(previousDue, suggestedDue, schedule) : 0;
  const absDeltaSec = Math.abs(deltaSec);
  const shouldUpdateFecha = askedToUpdateFecha && (!previousDue || etaAutoUpdateEnabled);

  if (shouldUpdateFecha) {
    data.fecha_estimada_fin = suggestedDue;
  }
  await prisma.pedidos.update({ where: { id: pedidoId }, data }).catch(() => {});

  if (askedToUpdateFecha) {
    if (!previousDue && shouldUpdateFecha) {
      // Primera ETA registrada automáticamente para iniciar el seguimiento.
      try {
        await RealtimeService.emitWebAlert(
          'ETA_INICIAL',
          `Pedido #${pedidoId} ETA inicial: ${suggestedDue.toISOString()}`,
          { pedidoId, newDue: suggestedDue.toISOString(), source: 'ml_recalc' }
        );
      } catch {}
    } else if (previousDue && shouldUpdateFecha && absDeltaSec >= minSuggestDeltaSec) {
      try {
        await RealtimeService.emitWebAlert(
          'ETA_ACTUALIZADA',
          `Pedido #${pedidoId} ETA actualizada de ${previousDue.toISOString()} a ${suggestedDue.toISOString()} (delta ${deltaSec}s)`,
          { pedidoId, oldDue: previousDue.toISOString(), newDue: suggestedDue.toISOString(), deltaSec, source: 'ml_recalc' }
        );
      } catch {}
    } else if (previousDue && !shouldUpdateFecha && absDeltaSec >= minSuggestDeltaSec) {
      // Modo recomendado: no auto mover ETA; solo sugerir para aprobación manual.
      try {
        await RealtimeService.emitWebAlert(
          'ETA_SUGERIDA',
          `Pedido #${pedidoId} sugerencia ETA: ${previousDue.toISOString()} -> ${suggestedDue.toISOString()} (delta ${deltaSec}s). Requiere confirmación manual.`,
          { pedidoId, currentDue: previousDue.toISOString(), suggestedDue: suggestedDue.toISOString(), deltaSec, source: 'ml_recalc' }
        );
      } catch {}
    }
  }

  if (workerId) await storePrediccion(pedidoId, workerId, estimado.adjustedSec, `${estimado.modelVersion}+heur`);
  return estimado.adjustedSec;
}
