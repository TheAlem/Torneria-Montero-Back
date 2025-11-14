import fs from 'fs';
import { trainLinearDurationModelTF } from '../services/ml/train-tensor';
import { success } from '../utils/response';
export const train = async (req, res, next) => {
    try {
        const { limit } = (req.body || {});
        const lim = Number(limit) || Number(process.env.ML_TRAIN_LIMIT) || 1000;
        const result = await trainLinearDurationModelTF(lim);
        return success(res, {
            provider: 'linear',
            trained: result.count,
            mae_sec: typeof result.mae === 'number' ? Math.round(result.mae) : null,
            mae_train_sec: typeof result.mae_train === 'number' ? Math.round(result.mae_train) : null,
            mae_valid_sec: typeof result.mae_valid === 'number' ? Math.round(result.mae_valid) : (typeof result.mae === 'number' ? Math.round(result.mae) : null),
            modelPath: result.path,
            version: result.model.version,
        }, 201, 'Modelo entrenado');
    }
    catch (err) {
        next(err);
    }
};
export const status = (_req, res) => {
    const ok = fs.existsSync('models/linear-duration-v1.json');
    return success(res, { status: ok ? 'ready' : 'missing', provider: 'linear' });
};
