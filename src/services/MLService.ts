import { prisma } from '../prisma/client';
import { predictWithLinearModel, predictWithLatestModel } from './ml/predictor';
import { getMinSeconds, getMaxSeconds } from './ml/storage';

export async function predictTiempoSec(pedidoId: number, trabajadorId: number): Promise<number> {
  const MIN_SEC = getMinSeconds();
  const MAX_SEC = getMaxSeconds();
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
  if (!pedido) return 4 * 60 * 60; // 4h fallback

  // Preferir histórico del trabajador en pedidos de misma prioridad
  const tiemposTrab = await prisma.tiempos.findMany({
    where: { trabajador_id: trabajadorId, estado: 'CERRADO' },
    select: { duracion_sec: true, pedido: { select: { prioridad: true } } },
    orderBy: { id: 'desc' },
    take: 50,
  });

  const mismos = tiemposTrab.filter(t => !!t.duracion_sec && t.pedido?.prioridad === pedido.prioridad).map(t => t.duracion_sec!)
    .filter(v => typeof v === 'number');
  const generales = tiemposTrab.filter(t => !!t.duracion_sec).map(t => t.duracion_sec!)
    .filter(v => typeof v === 'number');

  const arr = (mismos.length >= 5 ? mismos : generales);
  if (arr.length) {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.min(MAX_SEC, Math.max(MIN_SEC, Math.round(avg)));
  }

  // Intentar modelo entrenado (si existe)
  const precioNum = typeof (pedido as any).precio === 'object' || typeof (pedido as any).precio === 'string' ? Number((pedido as any).precio as any) : ((pedido as any).precio ?? 0);

  // Linear model (DB then FS)
  {
    const modelPredDB = await predictWithLatestModel({ prioridad: pedido.prioridad as any, precio: precioNum });
    if (modelPredDB) return Math.min(MAX_SEC, Math.max(MIN_SEC, modelPredDB));
    const modelPredFS = predictWithLinearModel({ prioridad: pedido.prioridad as any, precio: precioNum });
    if (modelPredFS) return Math.min(MAX_SEC, Math.max(MIN_SEC, modelPredFS));
  }

  // Fallback por prioridad
  if (pedido.prioridad === 'ALTA') return Math.min(MAX_SEC, 3 * 60 * 60);
  if (pedido.prioridad === 'MEDIA') return Math.min(MAX_SEC, 6 * 60 * 60);
  return Math.min(MAX_SEC, 8 * 60 * 60);
}

export async function storePrediccion(pedidoId: number, trabajadorId: number, tEstimadoSec: number) {
  try {
    await prisma.predicciones_tiempo.create({
      data: {
        pedido_id: pedidoId,
        trabajador_id: trabajadorId,
        t_estimado_sec: tEstimadoSec,
        modelo_version: 'v1.0',
      },
    });
  } catch (_) { /* swallow */ }
}
