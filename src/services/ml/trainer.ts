import { prisma } from '../../prisma/client';
import { buildBaseAndExtraFeatures } from './features';
import { saveModel, saveModelToDB } from './storage';

function transpose(A: number[][]): number[][] {
  return A[0].map((_, i) => A.map(row => row[i]));
}

function matmul(A: number[][], B: number[][]): number[][] {
  const n = A.length, m = B[0].length, k = B.length;
  const C = Array.from({ length: n }, () => Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let t = 0; t < k; t++) sum += A[i][t] * B[t][j];
      C[i][j] = sum;
    }
  }
  return C;
}

function invert2x2(M: number[][]): number[][] | null {
  const [[a, b], [c, d]] = M as any;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  return [[ d * invDet, -b * invDet], [ -c * invDet, a * invDet ]];
}

function invertMatrix(M: number[][]): number[][] | null {
  const n = M.length;
  if (n === 2) return invert2x2(M);
  // Gauss-Jordan for small matrices
  const A = M.map(row => row.slice());
  const I = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) I[i][i] = 1;
  for (let i = 0; i < n; i++) {
    let pivot = A[i][i];
    if (Math.abs(pivot) < 1e-12) {
      // find row
      let swap = i + 1;
      while (swap < n && Math.abs(A[swap][i]) < 1e-12) swap++;
      if (swap === n) return null;
      [A[i], A[swap]] = [A[swap], A[i]];
      [I[i], I[swap]] = [I[swap], I[i]];
      pivot = A[i][i];
    }
    const invPivot = 1 / pivot;
    for (let j = 0; j < n; j++) { A[i][j] *= invPivot; I[i][j] *= invPivot; }
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = A[r][i];
      for (let c = 0; c < n; c++) {
        A[r][c] -= factor * A[i][c];
        I[r][c] -= factor * I[i][c];
      }
    }
  }
  return I;
}

export async function trainLinearDurationModel(limit = 1000) {
  const rows = await prisma.tiempos.findMany({
    where: { estado: 'CERRADO', duracion_sec: { not: null } },
    include: {
      pedido: { select: { prioridad: true, precio: true, descripcion: true } },
      trabajador: { select: { skills: true, carga_actual: true, fecha_ingreso: true } }
    },
    orderBy: { id: 'desc' },
    take: limit,
  });
  if (!rows.length) {
    const model = {
      version: 'v1.1', trainedAt: new Date().toISOString(), algo: 'linear-regression-v1' as const,
      coef: [4 * 3600, 0, 0, 0], meta: { names: ['bias','prio_ALTA','prio_MEDIA','precio'], precioScale: null }
    };
    const path = saveModel(model);
    await saveModelToDB(model, { total: 0, mae: null });
    return { count: 0, path, model, mae: null } as any;
  }

  // Build base (4) + extra features and target
  const samples = rows.map(r => buildBaseAndExtraFeatures({ pedido: r.pedido as any, tiempo: r as any, trabajador: (r as any).trabajador ?? null }));
  const Xbase = samples.map(s => s.xBase); // [bias, isAlta, isMedia, precio]
  const yBase = samples.map(s => s.y);
  const extras = samples.map(s => s.extraX);
  const extraNames = samples[0]?.extraNames || [];

  // Clamp target for robustness
  const minSec = Number(process.env.ML_MIN_SECONDS ?? 180);
  const maxSec = Number(process.env.ML_MAX_SECONDS ?? 6 * 24 * 3600);
  const yClamped = yBase.map(v => Math.min(maxSec, Math.max(minSec, v)));

  // Shuffle/split indices (80/20)
  const idx = Array.from({ length: Xbase.length }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const split = Math.max(1, Math.floor(0.8 * idx.length));
  const trainIdx = idx.slice(0, split);
  const validIdx = idx.slice(split);

  // Compute scaling from TRAIN only
  const precioTrain = trainIdx.map(i => Xbase[i][3] ?? 0);
  const mean = precioTrain.reduce((a, b) => a + b, 0) / (precioTrain.length || 1);
  const variance = precioTrain.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (precioTrain.length || 1);
  const std = Math.sqrt(variance) || 1;
  const mapRow = (row: number[]) => {
    const bias = row[0];
    const isAlta = row[1];
    const isMedia = row[2];
    const scaledPrecio = ((row[3] ?? 0) - mean) / std;
    const precio2 = scaledPrecio * scaledPrecio;
    const altaXP = isAlta * scaledPrecio;
    const mediaXP = isMedia * scaledPrecio;
    return [bias, isAlta, isMedia, scaledPrecio, precio2, altaXP, mediaXP];
  };
  const names = ['bias', 'prio_ALTA', 'prio_MEDIA', 'precio', 'precio2', 'prio_ALTA_x_precio', 'prio_MEDIA_x_precio', ...extraNames];
  const Xtr = trainIdx.map(i => [...mapRow(Xbase[i]), ...extras[i]]);
  const ytr = trainIdx.map(i => [yClamped[i]]);
  const Xva = validIdx.map(i => [...mapRow(Xbase[i]), ...extras[i]]);
  const yva = validIdx.map(i => [yClamped[i]]);

  // Normal equation on TRAIN (ridge optional)
  const Xt_tr = transpose(Xtr);
  const XtX = matmul(Xt_tr, Xtr);
  const lambda = Number(process.env.ML_RIDGE_LAMBDA || 0);
  if (lambda && isFinite(lambda) && lambda > 0) {
    for (let i = 0; i < XtX.length; i++) {
      if (i === 0) continue; // do not regularize bias
      XtX[i][i] += lambda;
    }
  }
  const XtXInv = invertMatrix(XtX);
  if (!XtXInv) {
    const model = {
      version: 'v1.1', trainedAt: new Date().toISOString(), algo: 'linear-regression-v1' as const,
      coef: [4 * 3600, 0, 0, 0], meta: { names, precioScale: { mean, std } }
    };
    const path = saveModel(model);
    await saveModelToDB(model, { total: rows.length, mae: null });
    return { count: rows.length, path, model, mae: null } as any;
  }
  const XtY_tr = matmul(Xt_tr, ytr);
  const B = matmul(XtXInv, XtY_tr); // shape (p x 1)
  const coef = B.map(r => r[0]);

  const predict = (X: number[][]) => X.map(row => coef.reduce((s, c, i) => s + c * (row[i] ?? 0), 0));
  const yhat_tr = predict(Xtr);
  const mae_train = yhat_tr.reduce((acc, yh, i) => acc + Math.abs(yh - ytr[i][0]), 0) / yhat_tr.length;
  const yhat_va = predict(Xva);
  const mae_valid = yhat_va.length ? (yhat_va.reduce((acc, yh, i) => acc + Math.abs(yh - yva[i][0]), 0) / yhat_va.length) : mae_train;

  // Persist model with training scale (used at inference)
  const model = { version: 'v1.1', trainedAt: new Date().toISOString(), algo: 'linear-regression-v1' as const, coef, meta: { names, precioScale: { mean, std } } };
  const path = saveModel(model);
  await saveModelToDB(model, { total: rows.length, mae: mae_valid, precision: mae_train });
  return { count: rows.length, path, model, mae: mae_valid, mae_train, mae_valid } as any;
}
