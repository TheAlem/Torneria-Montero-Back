import type { Request, Response, NextFunction } from 'express';
import { trainLinearDurationModelTF } from '../services/ml/train-tensor.js';
import { loadLatestModelFromDB, loadModel, modelPath } from '../services/ml/storage.js';
import { success } from '../utils/response.js';

export const train = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit } = (req.body || {}) as { limit?: number };
    const lim = Number(limit) || Number(process.env.ML_TRAIN_LIMIT) || 1000;

    const result = await trainLinearDurationModelTF(lim);
    return success(
      res,
      {
        provider: 'linear',
        trained: result.count,
        mae_sec: typeof result.mae === 'number' ? Math.round(result.mae) : null,
        mae_train_sec: typeof (result as any).mae_train === 'number' ? Math.round((result as any).mae_train) : null,
        mae_valid_sec: typeof (result as any).mae_valid === 'number' ? Math.round((result as any).mae_valid) : (typeof result.mae === 'number' ? Math.round(result.mae) : null),
        mape_valid: typeof (result as any).mape_valid === 'number' ? Number((result as any).mape_valid.toFixed(4)) : null,
        n_train: typeof (result as any).n_train === 'number' ? (result as any).n_train : null,
        n_valid: typeof (result as any).n_valid === 'number' ? (result as any).n_valid : null,
        n_anchor: typeof (result as any).n_anchor === 'number' ? (result as any).n_anchor : null,
        split_seed: typeof (result as any).split_seed === 'number' ? (result as any).split_seed : null,
        modelPath: result.path,
        version: result.model.version,
      },
      201,
      'Modelo entrenado'
    );
  } catch (err) { next(err); }
};

export const status = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const fileModel = loadModel();
    const dbModel = fileModel ? null : await loadLatestModelFromDB();
    const model = fileModel || dbModel;

    return success(res, {
      status: model ? 'ready' : 'missing',
      provider: 'linear',
      source: fileModel ? 'filesystem' : dbModel ? 'database' : 'none',
      version: model?.version ?? null,
      trainedAt: model?.trainedAt ?? null,
      modelPath: fileModel ? modelPath() : null,
    });
  } catch (err) {
    next(err);
  }
};
