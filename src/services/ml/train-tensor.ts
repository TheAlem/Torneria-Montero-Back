// src/services/ml/train-tensor.ts
import type * as TF from '@tensorflow/tfjs';
import { prisma } from '../../prisma/client.js';
import { buildBaseAndExtraFeatures } from './features.js';
import { getMaxSeconds, getMinSeconds, saveModel, saveModelToDB, type LinearModel } from './storage.js';

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
  const rawRows = await prisma.tiempos.findMany({
    where: { estado: 'CERRADO', duracion_sec: { not: null } },
    include: {
      pedido: { select: { id: true, prioridad: true, precio: true, descripcion: true, estado: true } },
      trabajador: { select: { skills: true, carga_actual: true, fecha_ingreso: true } },
    },
    orderBy: { id: 'desc' },
    take: Math.max(limit * 4, limit),
  });

  const grouped = new Map<string, {
    pedido: { prioridad: 'ALTA' | 'MEDIA' | 'BAJA'; precio: any; descripcion: string | null };
    trabajador: { skills: any; carga_actual: number | null; fecha_ingreso: Date | null } | null;
    duracion_sec: number;
    maxId: number;
  }>();
  for (const r of rawRows) {
    if (!r.pedido || r.pedido.estado !== 'ENTREGADO') continue;
    const key = `${r.pedido_id}:${r.trabajador_id}`;
    const prev = grouped.get(key) ?? {
      pedido: {
        prioridad: r.pedido.prioridad as any,
        precio: r.pedido.precio,
        descripcion: r.pedido.descripcion ?? null,
      },
      trabajador: (r as any).trabajador ?? null,
      duracion_sec: 0,
      maxId: 0,
    };
    prev.duracion_sec += Number(r.duracion_sec || 0);
    prev.maxId = Math.max(prev.maxId, r.id);
    grouped.set(key, prev);
  }

  const rows = Array.from(grouped.values())
    .sort((a, b) => b.maxId - a.maxId)
    .slice(0, limit)
    .map(r => ({
      pedido: r.pedido,
      trabajador: r.trabajador,
      duracion_sec: r.duracion_sec,
    }));

  if (!rows.length) {
    const priors = { ALTA: 8 * 3600, MEDIA: 6 * 3600, BAJA: 5 * 3600 };
    const model: LinearModel = {
      version: 'v1.2-tf',
      trainedAt: new Date().toISOString(),
      algo: 'linear-regression-v1',
      coef: [4 * 3600, 0, 0, 0],
      meta: { names: ['bias', 'prio_ALTA', 'prio_MEDIA', 'precio'], precioScale: null, priors },
    };
    const path = saveModel(model);
    await saveModelToDB(model, { total: 0, mae: null });
    return { count: 0, path, model, mae: null } as any;
  }

  // 1) Construir features y filtrar outliers por rango operativo
  const rawSamples = rows.map(r =>
    buildBaseAndExtraFeatures({
      pedido: r.pedido as any,
      tiempo: r as any,
      trabajador: (r as any).trabajador ?? null,
    })
  );
  const minSec = getMinSeconds();
  const maxSec = getMaxSeconds();
  const samples = rawSamples.filter(s => Number.isFinite(s.y) && s.y >= minSec && s.y <= maxSec);
  if (!samples.length) {
    const priors = { ALTA: 8 * 3600, MEDIA: 6 * 3600, BAJA: 5 * 3600 };
    const model: LinearModel = {
      version: 'v1.2-tf',
      trainedAt: new Date().toISOString(),
      algo: 'linear-regression-v1',
      coef: [4 * 3600, 0, 0, 0],
      meta: { names: ['bias', 'prio_ALTA', 'prio_MEDIA', 'precio'], precioScale: null, priors },
    };
    const path = saveModel(model);
    await saveModelToDB(model, { total: 0, mae: null });
    return { count: 0, path, model, mae: null } as any;
  }

  const Xbase = samples.map(s => s.xBase); // [bias, isAlta, isMedia, precio]
  const extras = samples.map(s => s.extraX);
  const extraNames = samples[0]?.extraNames || [];
  const yBase = samples.map(s => s.y);
  const median = (arr: number[]) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const defaultPriors = { ALTA: 8 * 3600, MEDIA: 6 * 3600, BAJA: 5 * 3600 };
  const yAlta = samples.filter(s => s.xBase[1] === 1).map(s => s.y);
  const yMedia = samples.filter(s => s.xBase[2] === 1).map(s => s.y);
  const yBaja = samples.filter(s => s.xBase[1] === 0 && s.xBase[2] === 0).map(s => s.y);
  const priors = {
    ALTA: median(yAlta) ?? defaultPriors.ALTA,
    MEDIA: median(yMedia) ?? defaultPriors.MEDIA,
    BAJA: median(yBaja) ?? defaultPriors.BAJA,
  };
  const needAnchors = samples.length < 60;
  if (needAnchors) {
    const anchorPrice = median(Xbase.map(r => r[3] ?? 0)) ?? 0;
    const anchorExtras = Array(extras[0]?.length || 0).fill(0);
    const repeats = Math.max(3, Math.ceil(30 / Math.max(1, samples.length)));
    const addAnchor = (prio: 'ALTA'|'MEDIA'|'BAJA', target: number) => {
      const isAlta = prio === 'ALTA' ? 1 : 0;
      const isMedia = prio === 'MEDIA' ? 1 : 0;
      for (let i = 0; i < repeats; i++) {
        Xbase.push([1, isAlta, isMedia, anchorPrice]);
        yBase.push(target);
        extras.push([...anchorExtras]);
      }
    };
    addAnchor('ALTA', priors.ALTA);
    addAnchor('MEDIA', priors.MEDIA);
    addAnchor('BAJA', priors.BAJA);
  }

  // Ya filtrado por rango operativo
  const yClamped = yBase;

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
  const mape_valid =
    yhatVa.length === 0
      ? null
      : yhatVa.reduce((acc, row, i) => acc + Math.abs(row[0] - yva[i]) / Math.max(1, yva[i]), 0) / yhatVa.length;

  const yhatTrTensor = modelTF.predict(XtrTensor) as TF.Tensor;
  const yhatTr = (await yhatTrTensor.array()) as number[][];
  const mae_train = yhatTr.reduce((acc, row, i) => acc + Math.abs(row[0] - ytr[i]), 0) / yhatTr.length;
  const mape_train = yhatTr.reduce((acc, row, i) => acc + Math.abs(row[0] - ytr[i]) / Math.max(1, ytr[i]), 0) / yhatTr.length;

  const buildMetricsByTag = () => {
    const metrics: Record<string, { mae: number; mape: number; count: number }> = {};
    const idxMap = (name: string) => extraNames.indexOf(name);
    const tagNames = [
      'mat_acero',
      'mat_acero_1045',
      'mat_bronce',
      'mat_bronce_fundido',
      'mat_bronce_laminado',
      'mat_bronce_fosforado',
      'mat_inox',
      'mat_fundido',
      'mat_teflon',
      'mat_nylon',
      'mat_aluminio',
      'proc_torneado',
      'proc_fresado',
      'proc_roscado',
      'proc_taladrado',
      'proc_soldadura',
      'proc_pulido',
    ];
    for (const tag of tagNames) {
      const idxTag = idxMap(tag);
      if (idxTag < 0) continue;
      const ys: number[] = [];
      const yh: number[] = [];
      validIdx.forEach((sampleIdx, i) => {
        if ((extras[sampleIdx]?.[idxTag] ?? 0) > 0) {
          ys.push(yva[i]);
          yh.push(yhatVa[i]?.[0] ?? 0);
        }
      });
      if (!ys.length) continue;
      const mae = ys.reduce((acc, y, i) => acc + Math.abs(yh[i] - y), 0) / ys.length;
      const mape = ys.reduce((acc, y, i) => acc + Math.abs(yh[i] - y) / Math.max(1, y), 0) / ys.length;
      metrics[tag] = { mae, mape, count: ys.length };
    }
    return metrics;
  };

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
    meta: {
      names,
      precioScale: { mean, std },
      priors,
      metrics: {
        mae_train,
        mae_valid,
        mape_train,
        mape_valid,
        byTag: buildMetricsByTag(),
      },
    },
  };

  const path = saveModel(model);
  await saveModelToDB(model, { total: samples.length, mae: mae_valid ?? null, precision: mae_train ?? null });

  // Liberar tensores
  tf.dispose([XtrTensor, ytrTensor, XvaTensor, yvaTensor, yhatVaTensor, yhatTrTensor]);

  return { count: samples.length, path, model, mae: mae_valid, mae_train, mae_valid, mape_valid } as any;
}
