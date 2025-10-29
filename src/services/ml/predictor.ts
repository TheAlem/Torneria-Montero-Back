import { loadModel, loadLatestModelFromDB, type LinearModel } from './storage';
import { featuresForPedido } from './features';

export function predictWithLinearModel(input: { prioridad: 'ALTA'|'MEDIA'|'BAJA'; precio?: number|null }): number | null {
  // Try filesystem-backed model (sync)
  const model: LinearModel | null = loadModel();
  if (!model) return null;
  const x = featuresForPedido(input, model.meta);
  const yhat = model.coef.reduce((sum: number, c: number, i: number) => sum + c * (x[i] ?? 0), 0);
  if (!isFinite(yhat)) return null;
  return Math.max(900, Math.round(yhat));
}

export async function predictWithLatestModel(input: { prioridad: 'ALTA'|'MEDIA'|'BAJA'; precio?: number|null }): Promise<number | null> {
  const model: LinearModel | null = await loadLatestModelFromDB();
  if (!model) return null;
  const x = featuresForPedido(input, model.meta);
  const yhat = model.coef.reduce((sum: number, c: number, i: number) => sum + c * (x[i] ?? 0), 0);
  if (!isFinite(yhat)) return null;
  return Math.max(900, Math.round(yhat));
}
