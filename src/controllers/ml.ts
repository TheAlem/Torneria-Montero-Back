import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { trainLinearDurationModel } from '../services/ml/trainer';
import { success } from '../utils/response';

export const train = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit } = (req.body || {}) as { limit?: number };
    const lim = Number(limit) || Number(process.env.ML_TRAIN_LIMIT) || 1000;

    const result = await trainLinearDurationModel(lim);
    return success(
      res,
      {
        provider: 'linear',
        trained: result.count,
        mae_sec: typeof result.mae === 'number' ? Math.round(result.mae) : null,
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
