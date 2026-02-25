import { prisma } from '../src/prisma/client.js';

type PredRow = {
  modelo_version: string;
  t_estimado_sec: number;
  t_real_sec: number;
};

type Metrics = {
  count: number;
  maeSec: number;
  rmseSec: number;
  mape: number;
  biasSec: number;
  underPct: number;
  overPct: number;
};

function summarize(rows: PredRow[]): Metrics {
  const n = rows.length || 1;
  let sumAbs = 0;
  let sumSq = 0;
  let sumPct = 0;
  let sumBias = 0;
  let under = 0;
  let over = 0;

  for (const r of rows) {
    const err = r.t_real_sec - r.t_estimado_sec; // positivo = subestimamos
    const abs = Math.abs(err);
    sumAbs += abs;
    sumSq += err * err;
    sumPct += abs / Math.max(1, r.t_real_sec);
    sumBias += err;
    if (err > 0) under += 1;
    if (err < 0) over += 1;
  }

  return {
    count: rows.length,
    maeSec: sumAbs / n,
    rmseSec: Math.sqrt(sumSq / n),
    mape: sumPct / n,
    biasSec: sumBias / n,
    underPct: under / n,
    overPct: over / n,
  };
}

function fmtSec(sec: number) {
  const h = sec / 3600;
  return `${Math.round(sec)}s (${h.toFixed(2)}h)`;
}

async function main() {
  const take = Math.max(100, Number(process.env.ML_DIAG_LIMIT ?? 5000));
  const rows = await prisma.predicciones_tiempo.findMany({
    where: {
      t_estimado_sec: { not: null },
      t_real_sec: { not: null },
    },
    select: {
      id: true,
      pedido_id: true,
      trabajador_id: true,
      modelo_version: true,
      t_estimado_sec: true,
      t_real_sec: true,
    },
    orderBy: { id: 'desc' },
    take,
  });

  const valid = rows
    .map(r => ({
      modelo_version: r.modelo_version || 'unknown',
      t_estimado_sec: Number(r.t_estimado_sec || 0),
      t_real_sec: Number(r.t_real_sec || 0),
    }))
    .filter(r => Number.isFinite(r.t_estimado_sec) && Number.isFinite(r.t_real_sec) && r.t_estimado_sec > 0 && r.t_real_sec > 0);

  if (!valid.length) {
    console.log('No hay datos suficientes en predicciones_tiempo para diagnosticar.');
    return;
  }

  const overall = summarize(valid);
  console.log(`Muestras analizadas: ${valid.length}`);
  console.log(`MAE: ${fmtSec(overall.maeSec)}`);
  console.log(`RMSE: ${fmtSec(overall.rmseSec)}`);
  console.log(`MAPE: ${(overall.mape * 100).toFixed(2)}%`);
  console.log(`Bias (real-estimado): ${fmtSec(overall.biasSec)} => ${overall.biasSec > 0 ? 'subestimación' : 'sobreestimación'}`);
  console.log(`Subestimados: ${(overall.underPct * 100).toFixed(1)}% | Sobreestimados: ${(overall.overPct * 100).toFixed(1)}%`);

  const byVersion = new Map<string, PredRow[]>();
  for (const r of valid) {
    const key = r.modelo_version || 'unknown';
    const arr = byVersion.get(key) ?? [];
    arr.push(r);
    byVersion.set(key, arr);
  }

  const table = Array.from(byVersion.entries())
    .map(([version, items]) => {
      const m = summarize(items);
      return {
        version,
        n: m.count,
        mae_h: Number((m.maeSec / 3600).toFixed(2)),
        rmse_h: Number((m.rmseSec / 3600).toFixed(2)),
        mape_pct: Number((m.mape * 100).toFixed(2)),
        bias_h: Number((m.biasSec / 3600).toFixed(2)),
        under_pct: Number((m.underPct * 100).toFixed(1)),
        over_pct: Number((m.overPct * 100).toFixed(1)),
      };
    })
    .sort((a, b) => b.n - a.n);

  console.log('\nResumen por modelo_version');
  console.table(table);

  const outliers = rows
    .map(r => {
      const estim = Number(r.t_estimado_sec || 0);
      const real = Number(r.t_real_sec || 0);
      const absErr = Math.abs(real - estim);
      return {
        id: (r as any).id,
        pedido_id: (r as any).pedido_id,
        trabajador_id: (r as any).trabajador_id,
        modelo_version: r.modelo_version || 'unknown',
        estim_h: Number((estim / 3600).toFixed(2)),
        real_h: Number((real / 3600).toFixed(2)),
        abs_err_h: Number((absErr / 3600).toFixed(2)),
      };
    })
    .sort((a, b) => b.abs_err_h - a.abs_err_h)
    .slice(0, 10);

  console.log('\nTop 10 outliers (error absoluto)');
  console.table(outliers);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
