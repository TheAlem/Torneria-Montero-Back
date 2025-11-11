import { prisma } from '../../prisma/client';
import { buildFeaturesFromSample, normalizeFeatures } from './features';
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
    include: { pedido: { select: { prioridad: true, precio: true } } },
    orderBy: { id: 'desc' },
    take: limit,
  });
  if (!rows.length) {
    const model = {
      version: 'v1.0', trainedAt: new Date().toISOString(), algo: 'linear-regression-v1' as const,
      coef: [4 * 3600, 0, 0, 0], meta: { names: ['bias','prio_ALTA','prio_MEDIA','precio'], precioScale: null }
    };
    const path = saveModel(model);
    await saveModelToDB(model);
    return { count: 0, path, model };
  }

  const samples = rows.map(r => buildFeaturesFromSample({ pedido: r.pedido as any, tiempo: r }));
  const Xraw = samples.map(s => s.x);
  const y = samples.map(s => [s.y]);
  const { xs: X, meta } = normalizeFeatures(Xraw);

  // Normal equation: beta = (X^T X)^-1 X^T y
  const Xt = transpose(X);
  const XtX = matmul(Xt, X);
  // Ridge regularization (λI) except do not penalize bias term
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
      version: 'v1.0', trainedAt: new Date().toISOString(), algo: 'linear-regression-v1' as const,
      coef: [4 * 3600, 0, 0, 0], meta
    };
    const path = saveModel(model);
    return { count: rows.length, path, model };
  }
  const XtY = matmul(Xt, y);
  const B = matmul(XtXInv, XtY); // shape (p x 1)
  const coef = B.map(r => r[0]);
  const model = { version: 'v1.0', trainedAt: new Date().toISOString(), algo: 'linear-regression-v1' as const, coef, meta };
  const path = saveModel(model);
  await saveModelToDB(model);
  return { count: rows.length, path, model };
}
