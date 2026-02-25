import { prisma } from '../src/prisma/client.js';

type OutlierRow = {
  id: number;
  pedido_id: number;
  trabajador_id: number;
  duracion_sec: number | null;
  inicio: Date | null;
  fin: Date | null;
};

const toNum = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const minSec = Math.max(1, toNum(process.env.ML_CLEAN_MIN_SECONDS ?? process.env.ML_MIN_SECONDS, 900));
const maxSec = Math.max(minSec, toNum(process.env.ML_CLEAN_MAX_SECONDS ?? process.env.ML_MAX_SECONDS, 172800));
const sampleLimit = Math.max(1, toNum(process.env.ML_CLEAN_SAMPLE_LIMIT, 20));
const apply = process.argv.includes('--apply');

function fmtHours(sec?: number | null) {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return 'null';
  return `${(sec / 3600).toFixed(2)}h`;
}

async function fetchOutliers(): Promise<OutlierRow[]> {
  return prisma.tiempos.findMany({
    where: {
      estado: 'CERRADO',
      duracion_sec: { not: null },
      OR: [
        { duracion_sec: { lt: minSec } },
        { duracion_sec: { gt: maxSec } },
      ],
    },
    select: {
      id: true,
      pedido_id: true,
      trabajador_id: true,
      duracion_sec: true,
      inicio: true,
      fin: true,
    },
    orderBy: { id: 'desc' },
  });
}

async function recomputePedidoRealAndPreds() {
  const delivered = await prisma.pedidos.findMany({
    where: { estado: 'ENTREGADO' },
    select: { id: true, responsable_id: true },
  });
  if (!delivered.length) return { pedidosUpdated: 0, predsUpdated: 0 };

  const pedidoIds = delivered.map(p => p.id);
  const sums = await prisma.tiempos.groupBy({
    by: ['pedido_id'],
    where: {
      pedido_id: { in: pedidoIds },
      estado: 'CERRADO',
      duracion_sec: { not: null },
    },
    _sum: { duracion_sec: true },
  });
  const realByPedido = new Map<number, number | null>();
  for (const p of delivered) realByPedido.set(p.id, null);
  for (const s of sums) {
    realByPedido.set(s.pedido_id, typeof s._sum.duracion_sec === 'number' ? s._sum.duracion_sec : null);
  }

  let pedidosUpdated = 0;
  let predsUpdated = 0;

  for (const p of delivered) {
    const real = realByPedido.get(p.id) ?? null;
    await prisma.pedidos.update({
      where: { id: p.id },
      data: { tiempo_real_sec: real },
    });
    pedidosUpdated += 1;

    if (!p.responsable_id || real == null) continue;
    const pred = await prisma.predicciones_tiempo.findFirst({
      where: { pedido_id: p.id, trabajador_id: p.responsable_id },
      orderBy: { id: 'desc' },
      select: { id: true, t_estimado_sec: true },
    });
    if (!pred) continue;

    const est = typeof pred.t_estimado_sec === 'number' ? pred.t_estimado_sec : null;
    const desvio = est && est > 0 ? Math.min(1, Math.abs(real - est) / Math.max(1, est)) : null;
    await prisma.predicciones_tiempo.update({
      where: { id: pred.id },
      data: { t_real_sec: real, desvio },
    });
    predsUpdated += 1;
  }

  return { pedidosUpdated, predsUpdated };
}

async function main() {
  const outliers = await fetchOutliers();
  console.log(`Rango válido configurado: ${minSec}s (${fmtHours(minSec)}) .. ${maxSec}s (${fmtHours(maxSec)})`);
  console.log(`Registros outlier encontrados en tiempos: ${outliers.length}`);

  const sample = outliers.slice(0, sampleLimit).map(o => ({
    id: o.id,
    pedido_id: o.pedido_id,
    trabajador_id: o.trabajador_id,
    duracion_sec: o.duracion_sec,
    duracion_h: fmtHours(o.duracion_sec ?? null),
    inicio: o.inicio ? o.inicio.toISOString() : null,
    fin: o.fin ? o.fin.toISOString() : null,
  }));
  if (sample.length) {
    console.log('\nMuestra de outliers');
    console.table(sample);
  }

  if (!apply) {
    console.log('\nDry-run: no se aplicaron cambios.');
    console.log('Para aplicar limpieza: npm run ml:clean -- --apply');
    return;
  }

  if (!outliers.length) {
    console.log('No hay outliers para limpiar.');
    return;
  }

  const ids = outliers.map(o => o.id);
  const updated = await prisma.tiempos.updateMany({
    where: { id: { in: ids } },
    data: { duracion_sec: null },
  });

  const sync = await recomputePedidoRealAndPreds();

  console.log('\nLimpieza aplicada.');
  console.log(`tiempos anulados: ${updated.count}`);
  console.log(`pedidos tiempo_real_sec recalculados: ${sync.pedidosUpdated}`);
  console.log(`predicciones_tiempo sincronizadas (última por pedido/responsable): ${sync.predsUpdated}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
