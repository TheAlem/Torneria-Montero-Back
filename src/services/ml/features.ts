import { pedidos, tiempos } from '@prisma/client';

export type FeatureVector = number[];

export type FeatureMeta = {
  // names in order
  names: string[];
  // normalization info, if any
  precioScale?: { mean: number; std: number } | null;
};

export function buildFeaturesFromSample(sample: { pedido: Pick<pedidos, 'prioridad' | 'precio'>; tiempo: Pick<tiempos, 'duracion_sec'> }): { x: FeatureVector; y: number } {
  const pr = sample.pedido.prioridad;
  const isAlta = pr === 'ALTA' ? 1 : 0;
  const isMedia = pr === 'MEDIA' ? 1 : 0; // BAJA es baseline
  const precio = typeof sample.pedido.precio === 'object' || typeof sample.pedido.precio === 'string' ? Number(sample.pedido.precio as any) : (sample.pedido.precio ?? 0);
  const precioNum = isFinite(precio) ? Number(precio) : 0;

  const x = [1, isAlta, isMedia, precioNum];
  const y = Math.max(1, sample.tiempo.duracion_sec || 0);
  return { x, y };
}

export function normalizeFeatures(xs: FeatureVector[], meta?: FeatureMeta): { xs: FeatureVector[]; meta: FeatureMeta } {
  // columns: [bias, isAlta, isMedia, precio]
  const names = ['bias', 'prio_ALTA', 'prio_MEDIA', 'precio'];
  const precioCol = xs.map(row => row[3] ?? 0);
  const mean = precioCol.reduce((a, b) => a + b, 0) / (precioCol.length || 1);
  const variance = precioCol.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (precioCol.length || 1);
  const std = Math.sqrt(variance) || 1;
  const scaled = xs.map(row => [row[0], row[1], row[2], (row[3] - mean) / std]);
  return { xs: scaled, meta: { names, precioScale: { mean, std } } };
}

export function featuresForPedido(input: { prioridad: 'ALTA' | 'MEDIA' | 'BAJA'; precio?: number | null }, meta: FeatureMeta): FeatureVector {
  const isAlta = input.prioridad === 'ALTA' ? 1 : 0;
  const isMedia = input.prioridad === 'MEDIA' ? 1 : 0;
  const precioNum = isFinite(Number(input.precio)) ? Number(input.precio) : 0;
  const scaledPrecio = meta.precioScale ? (precioNum - meta.precioScale.mean) / meta.precioScale.std : precioNum;
  return [1, isAlta, isMedia, scaledPrecio];
}

