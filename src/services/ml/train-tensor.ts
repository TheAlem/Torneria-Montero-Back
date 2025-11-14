// src/services/ml/train-tensor.ts
import type * as TF from '@tensorflow/tfjs';
import { prisma } from '../../prisma/client';
import { buildBaseAndExtraFeatures } from './features';
import { saveModel, saveModelToDB, type LinearModel } from './storage';

type TFModule = typeof TF;

const tfPromise = loadTensorFlow();

async function loadTensorFlow(): Promise<TFModule> {
  try {
    const tfNode = (await import('@tensorflow/tfjs-node')) as TFModule;
    return tfNode;
  } catch (err) {
    console.warn(
      '[ML] Falling back to @tensorflow/tfjs CPU backend because @tensorflow/tfjs-node failed to load',
      err
    );
    const tfJs = (await import('@tensorflow/tfjs')) as TFModule;
    await tfJs.setBackend('cpu');
    await tfJs.ready();
    return tfJs;
  }
}

export async function trainLinearDurationModelTF(limit = 1000) {
  const tf = await tfPromise;
  const rows = await prisma.tiempos.findMany({
    where: { estado: 'CERRADO', duracion_sec: { not: null } },
    include: {
      pedido: { select: { prioridad: true, precio: true, descripcion: true } },
      trabajador: { select: { skills: true, carga_actual: true, fecha_ingreso: true } },
    },
    orderBy: { id: 'desc' },
    take: limit,
  });

  if (!rows.length) {
    const model: LinearModel = {
      version: 'v1.2-tf',
      trainedAt: new Date().toISOString(),
      algo: 'linear-regression-v1',
      coef: [4 * 3600, 0, 0, 0],
      meta: { names: ['bias', 'prio_ALTA', 'prio_MEDIA', 'precio'], precioScale: null },
    };
    const path = saveModel(model);
    await saveModelToDB(model, { total: 0, mae: null });
    return { count: 0, path, model, mae: null } as any;
  }

  // 1) Construir features exactamente igual que en el trainer actual
  const samples = rows.map(r =>
    buildBaseAndExtraFeatures({
      pedido: r.pedido as any,
      tiempo: r as any,
      trabajador: (r as any).trabajador ?? null,
    })
  );

  const Xbase = samples.map(s => s.xBase); // [bias, isAlta, isMedia, precio]
  const extras = samples.map(s => s.extraX);
  const extraNames = samples[0]?.extraNames || [];
  const yBase = samples.map(s => s.y);

  // Clamp target para robustez (igual que código actual)
  const minSec = Number(process.env.ML_MIN_SECONDS ?? 180);
  const maxSec = Number(process.env.ML_MAX_SECONDS ?? 6 * 24 * 3600);
  const yClamped = yBase.map(v => Math.min(maxSec, Math.max(minSec, v)));

  // 2) Shuffle/split índices (80/20)
  const idx = Array.from({ length: Xbase.length }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const split = Math.max(1, Math.floor(0.8 * idx.length));
  const trainIdx = idx.slice(0, split);
  const validIdx = idx.slice(split);

  // 3) Escalar precio (solo en TRAIN) igual que antes
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

  const names = [
    'bias',
    'prio_ALTA',
    'prio_MEDIA',
    'precio',
    'precio2',
    'prio_ALTA_x_precio',
    'prio_MEDIA_x_precio',
    ...extraNames,
  ];

  const Xtr = trainIdx.map(i => [...mapRow(Xbase[i]), ...extras[i]]);
  const ytr = trainIdx.map(i => yClamped[i]);
  const Xva = validIdx.map(i => [...mapRow(Xbase[i]), ...extras[i]]);
  const yva = validIdx.map(i => yClamped[i]);

  const nFeatures = Xtr[0].length;

  // 4) Modelo TF: una capa densa = regresión lineal; useBias=false (ya hay bias en features)
  const lambda = Number(process.env.ML_RIDGE_LAMBDA || 0);
  const modelTF = tf.sequential();
  modelTF.add(
    tf.layers.dense({
      units: 1,
      inputShape: [nFeatures],
      useBias: false,
      kernelRegularizer:
        lambda && isFinite(lambda) && lambda > 0
          ? tf.regularizers.l2({ l2: lambda })
          : undefined,
    })
  );

  modelTF.compile({
    optimizer: tf.train.adam(0.01),
    loss: 'meanAbsoluteError',
  });

  const XtrTensor = tf.tensor2d(Xtr);
  const ytrTensor = tf.tensor2d(ytr, [ytr.length, 1]);

  // 5) Entrenar
  await modelTF.fit(XtrTensor, ytrTensor, {
    epochs: 80,
    batchSize: 32,
    validationSplit: 0,
    verbose: 0,
  });

  // 6) Evaluar en train y valid
  const XvaTensor = tf.tensor2d(Xva);
  const yvaTensor = tf.tensor2d(yva, [yva.length, 1]);
  const yhatVaTensor = modelTF.predict(XvaTensor) as TF.Tensor;
  const yhatVa = (await yhatVaTensor.array()) as number[][];
  const mae_valid =
    yhatVa.length === 0
      ? null
      : yhatVa.reduce((acc, row, i) => acc + Math.abs(row[0] - yva[i]), 0) / yhatVa.length;

  const yhatTrTensor = modelTF.predict(XtrTensor) as TF.Tensor;
  const yhatTr = (await yhatTrTensor.array()) as number[][];
  const mae_train = yhatTr.reduce((acc, row, i) => acc + Math.abs(row[0] - ytr[i]), 0) / yhatTr.length;

  // 7) Extraer pesos
  const dense = modelTF.layers[0];
  const [kernel] = dense.getWeights();
  const kernelArr = (await kernel.array()) as number[][];
  const coef = kernelArr.map(r => r[0]);

  // 8) Guardar modelo con el mismo formato
  const model: LinearModel = {
    version: 'v1.2-tf',
    trainedAt: new Date().toISOString(),
    algo: 'linear-regression-v1',
    coef,
    meta: { names, precioScale: { mean, std } },
  };

  const path = saveModel(model);
  await saveModelToDB(model, { total: rows.length, mae: mae_valid ?? null, precision: mae_train ?? null });

  // Liberar tensores
  tf.dispose([XtrTensor, ytrTensor, XvaTensor, yvaTensor, yhatVaTensor, yhatTrTensor]);

  return { count: rows.length, path, model, mae: mae_valid, mae_train, mae_valid } as any;
}
