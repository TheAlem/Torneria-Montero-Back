import { loadModel, loadLatestModelFromDB, type LinearModel } from './storage.js';
import { featuresForPedido } from './features.js';

function applyPriors(yhat: number, input: { prioridad: 'ALTA'|'MEDIA'|'BAJA' }, meta: any): number {
  if (!meta?.priors) return yhat;
  const pri = meta.priors as Record<string, number>;
  const priorVal = pri[input.prioridad] ?? null;
  if (!priorVal) return yhat;
  // Mezcla suavizada: 70% predicción, 30% prior para estabilizar en cold-start
  const blend = (0.7 * yhat) + (0.3 * priorVal);
  return blend;
}

export function predictWithLinearModel(input: { prioridad: 'ALTA'|'MEDIA'|'BAJA'; precio?: number|null; descripcion?: string|null; workerSkills?: any; cargaActual?: number|null; fechaIngreso?: string|Date|null }): number | null {
  // Try filesystem-backed model (sync)
  const model: LinearModel | null = loadModel();
  if (!model) return null;
  const x = featuresForPedido(input, model.meta);
  const raw = model.coef.reduce((sum: number, c: number, i: number) => sum + c * (x[i] ?? 0), 0);
  const yhat = applyPriors(raw, input, model.meta);
  if (!isFinite(yhat)) return null;
  return Math.max(900, Math.round(yhat));
}

export function predictWithLinearModelInfo(input: { prioridad: 'ALTA'|'MEDIA'|'BAJA'; precio?: number|null; descripcion?: string|null; workerSkills?: any; cargaActual?: number|null; fechaIngreso?: string|Date|null }): { value: number; version: string } | null {
  const model: LinearModel | null = loadModel();
  if (!model) return null;
  const x = featuresForPedido(input, model.meta);
  const raw = model.coef.reduce((sum: number, c: number, i: number) => sum + c * (x[i] ?? 0), 0);
  const yhat = applyPriors(raw, input, model.meta);
  if (!isFinite(yhat)) return null;
  return { value: Math.max(900, Math.round(yhat)), version: model.version || 'fs' };
}

export async function predictWithLatestModel(input: { prioridad: 'ALTA'|'MEDIA'|'BAJA'; precio?: number|null; descripcion?: string|null; workerSkills?: any; cargaActual?: number|null; fechaIngreso?: string|Date|null }): Promise<number | null> {
  const model: LinearModel | null = await loadLatestModelFromDB();
  if (!model) return null;
  const x = featuresForPedido(input, model.meta);
  const raw = model.coef.reduce((sum: number, c: number, i: number) => sum + c * (x[i] ?? 0), 0);
  const yhat = applyPriors(raw, input, model.meta);
  if (!isFinite(yhat)) return null;
  return Math.max(900, Math.round(yhat));
}

export async function predictWithLatestModelInfo(input: { prioridad: 'ALTA'|'MEDIA'|'BAJA'; precio?: number|null; descripcion?: string|null; workerSkills?: any; cargaActual?: number|null; fechaIngreso?: string|Date|null }): Promise<{ value: number; version: string } | null> {
  const model: LinearModel | null = await loadLatestModelFromDB();
  if (!model) return null;
  const x = featuresForPedido(input, model.meta);
  const raw = model.coef.reduce((sum: number, c: number, i: number) => sum + c * (x[i] ?? 0), 0);
  const yhat = applyPriors(raw, input, model.meta);
  if (!isFinite(yhat)) return null;
  return { value: Math.max(900, Math.round(yhat)), version: model.version || 'db' };
}
