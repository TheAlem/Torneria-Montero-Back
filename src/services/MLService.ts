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
  const suggestedDue = new Date(Date.now() + estimado.adjustedSec * 1000);
  const askedToUpdateFecha = opts?.updateFechaEstimada === true
    || (opts?.updateFechaEstimada !== false && !pedido.fecha_estimada_fin);
  const etaAutoUpdateEnabled = String(process.env.ETA_AUTO_UPDATE_ENABLED ?? 'false').toLowerCase() === 'true';
  const minSuggestDeltaSec = Math.max(60, Number(process.env.ETA_SUGGEST_MIN_DELTA_SEC ?? 300));
  const deltaSec = previousDue ? Math.round((suggestedDue.getTime() - previousDue.getTime()) / 1000) : 0;
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
