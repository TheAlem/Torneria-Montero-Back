import type { Request, Response, NextFunction } from 'express';
import { trainLinearDurationModel } from '../services/ml/trainer';
import { success } from '../utils/response';

export const train = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit } = req.body || {};
    const result = await trainLinearDurationModel(Number(limit) || Number(process.env.ML_TRAIN_LIMIT) || 1000);
    return success(res, { trained: result.count, modelPath: result.path, version: result.model.version }, 201, 'Modelo entrenado');
  } catch (err) { next(err); }
};
