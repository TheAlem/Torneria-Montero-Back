import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { trainLinearDurationModelTF } from '../services/ml/train-tensor.js';
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
        modelPath: result.path,
        version: result.model.version,
      },
      201,
      'Modelo entrenado'
    );
  } catch (err) { next(err); }
};

export const status = (_req: Request, res: Response) => {
  const ok = fs.existsSync('models/linear-duration-v1.json');
  return success(res, { status: ok ? 'ready' : 'missing', provider: 'linear' });
};
