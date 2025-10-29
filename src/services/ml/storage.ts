import fs from 'fs';
import path from 'path';

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

