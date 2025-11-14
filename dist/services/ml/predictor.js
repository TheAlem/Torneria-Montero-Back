import { loadModel, loadLatestModelFromDB } from './storage';
import { featuresForPedido } from './features';
export function predictWithLinearModel(input) {
    // Try filesystem-backed model (sync)
    const model = loadModel();
    if (!model)
        return null;
    const x = featuresForPedido(input, model.meta);
    const yhat = model.coef.reduce((sum, c, i) => sum + c * (x[i] ?? 0), 0);
    if (!isFinite(yhat))
        return null;
    return Math.max(900, Math.round(yhat));
}
export async function predictWithLatestModel(input) {
    const model = await loadLatestModelFromDB();
    if (!model)
        return null;
    const x = featuresForPedido(input, model.meta);
    const yhat = model.coef.reduce((sum, c, i) => sum + c * (x[i] ?? 0), 0);
    if (!isFinite(yhat))
        return null;
    return Math.max(900, Math.round(yhat));
}
