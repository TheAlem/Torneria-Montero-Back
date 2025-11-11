import { pedidos, tiempos } from '@prisma/client';

export type FeatureVector = number[];

export type FeatureMeta = {
  // names in order
  names: string[];
  // normalization info, if any
  precioScale?: { mean: number; std: number } | null;
};

/**
 * Base features from a DB sample. We initially return minimal columns
 * [1, isAlta, isMedia, precio] and let normalizeFeatures expand/scale
 * into richer features (precio^2, interactions) for training.
 */
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

/**
 * Scales precio and expands features to include polynomial and interactions:
 * names: ['bias','prio_ALTA','prio_MEDIA','precio','precio2','prio_ALTA_x_precio','prio_MEDIA_x_precio']
 */
export function normalizeFeatures(xs: FeatureVector[], meta?: FeatureMeta): { xs: FeatureVector[]; meta: FeatureMeta } {
  // xs columns (incoming): [bias, isAlta, isMedia, precio]
  const precioCol = xs.map(row => row[3] ?? 0);
  const mean = precioCol.reduce((a, b) => a + b, 0) / (precioCol.length || 1);
  const variance = precioCol.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (precioCol.length || 1);
  const std = Math.sqrt(variance) || 1;
  const scaled = xs.map(row => {
    const bias = row[0];
    const isAlta = row[1];
    const isMedia = row[2];
    const scaledPrecio = ((row[3] ?? 0) - mean) / std;
    const precio2 = scaledPrecio * scaledPrecio;
    const altaXP = isAlta * scaledPrecio;
    const mediaXP = isMedia * scaledPrecio;
    return [bias, isAlta, isMedia, scaledPrecio, precio2, altaXP, mediaXP];
  });
  const names = ['bias', 'prio_ALTA', 'prio_MEDIA', 'precio', 'precio2', 'prio_ALTA_x_precio', 'prio_MEDIA_x_precio'];
  return { xs: scaled, meta: { names, precioScale: { mean, std } } };
}

/**
 * Build an inference feature vector based on meta.names to keep
 * backward compatibility with older models (4 features) and
 * support newer expanded models (7 features).
 */
export function featuresForPedido(input: { prioridad: 'ALTA' | 'MEDIA' | 'BAJA'; precio?: number | null }, meta: FeatureMeta): FeatureVector {
  const isAlta = input.prioridad === 'ALTA' ? 1 : 0;
  const isMedia = input.prioridad === 'MEDIA' ? 1 : 0;
  const precioNum = isFinite(Number(input.precio)) ? Number(input.precio) : 0;
  const scaledPrecio = meta.precioScale ? (precioNum - meta.precioScale.mean) / meta.precioScale.std : precioNum;

  const map: Record<string, number> = {
    'bias': 1,
    'prio_ALTA': isAlta,
    'prio_MEDIA': isMedia,
    'precio': scaledPrecio,
    'precio2': scaledPrecio * scaledPrecio,
    'prio_ALTA_x_precio': isAlta * scaledPrecio,
    'prio_MEDIA_x_precio': isMedia * scaledPrecio,
  };
  const names = Array.isArray(meta?.names) && meta.names.length ? meta.names : ['bias','prio_ALTA','prio_MEDIA','precio'];
  return names.map(n => (n in map ? map[n] : 0));
}

