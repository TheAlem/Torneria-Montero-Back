import fs from 'fs';
import path from 'path';
import { prisma } from '../../prisma/client.js';

export type LinearModel = {
  version: string;
  trainedAt: string;
  algo: 'linear-regression-v1';
  coef: number[]; // in same order as features meta
  meta: any;
};

export function modelsDir() {
  return path.resolve(process.cwd(), 'models');
}

export function ensureModelsDir() {
  const dir = modelsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function modelPath(name = 'linear-duration-v1.json') {
  return path.join(modelsDir(), name);
}

export function saveModel(model: LinearModel, name?: string) {
  ensureModelsDir();
  const p = modelPath(name);
  fs.writeFileSync(p, JSON.stringify(model, null, 2), { encoding: 'utf8' });
  return p;
}

export function loadModel(name?: string): LinearModel | null {
  const p = modelPath(name);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  try { return JSON.parse(raw) as LinearModel; } catch { return null; }
}

export async function saveModelToDB(
  model: LinearModel,
  opts?: { total?: number | null; mae?: number | null; precision?: number | null }
) {
  try {
    const rec = await prisma.historico_modelo.create({
      data: {
        fecha_entrenamiento: new Date(),
        total_pedidos: typeof opts?.total === 'number' ? opts!.total : null,
        mae: typeof opts?.mae === 'number' ? opts!.mae : null,
        precision: typeof opts?.precision === 'number' ? opts!.precision : null,
        parametros: model as any,
      }
    });
    return rec.id;
  } catch (_) { return null; }
}

export async function loadLatestModelFromDB(): Promise<LinearModel | null> {
  try {
    const rec = await prisma.historico_modelo.findFirst({ orderBy: { fecha_entrenamiento: 'desc' } });
    if (!rec || !rec.parametros) return null;
    return rec.parametros as any as LinearModel;
  } catch (_) { return null; }
}

// Helpers for ONNX provider (optional)
export function getModelPath() {
  return process.env.MODEL_PATH || path.join(modelsDir(), 'model-eta-v1.onnx');
}

export function getMinSeconds() {
  const v = Number(process.env.ML_MIN_SECONDS ?? 900);
  return Number.isFinite(v) ? v : 900;
}

export function getMaxSeconds() {
  const v = Number(process.env.ML_MAX_SECONDS ?? 172800); // 48h por defecto
  return Number.isFinite(v) ? v : 172800;
}

export function loadMetaFromFile(): any | null {
  try {
    const p = path.join(modelsDir(), 'meta.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}
