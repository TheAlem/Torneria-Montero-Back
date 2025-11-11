import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { trainLinearDurationModel } from '../services/ml/trainer';
import { trainOnnxModel } from '../services/ml/onnxTrainer';
import { success } from '../utils/response';

export const train = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit, provider: providerReq } = (req.body || {}) as { limit?: number; provider?: string };
    const provider = String(providerReq || process.env.ML_PROVIDER || 'linear').toLowerCase();
    const lim = Number(limit) || Number(process.env.ML_TRAIN_LIMIT) || 1000;

    if (provider === 'onnx') {
      const r = await trainOnnxModel(lim);
      return success(res, { provider: 'onnx', ok: r.ok, mae_sec: r.mae_sec, paths: { onnx: r.pathOnnx, meta: r.pathMeta } }, 201, 'ONNX entrenado');
    }

    const result = await trainLinearDurationModel(lim);
    return success(res, { provider: 'linear', trained: result.count, modelPath: result.path, version: result.model.version }, 201, 'Modelo entrenado');
  } catch (err) { next(err); }
};

export const status = (_req: Request, res: Response) => {
  const ok = fs.existsSync('models/model-eta-v1.onnx') && fs.existsSync('models/meta.json');
  return success(res, { status: ok ? 'ready' : 'missing' });
};

export const trainOnnx = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit } = req.body || {};
    const r = await trainOnnxModel(Number(limit) || Number(process.env.ML_TRAIN_LIMIT) || 1000);
    return success(res, { ok: r.ok, mae_sec: r.mae_sec, paths: { onnx: r.pathOnnx, meta: r.pathMeta } }, 201, 'ONNX entrenado');
  } catch (err) { next(err); }
};
