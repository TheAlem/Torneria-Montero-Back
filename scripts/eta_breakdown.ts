import { prisma } from '../src/prisma/client.js';
import { buildCandidatesForPedido } from '../src/services/HeuristicsService.js';

function toNum(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function usage() {
  console.log('Uso: npx tsx scripts/eta_breakdown.ts <pedidoId> [limit]');
}

async function main() {
  const pedidoId = toNum(process.argv[2], NaN);
  const limit = Math.max(1, toNum(process.argv[3], 10));
  if (!Number.isFinite(pedidoId) || pedidoId <= 0) {
    usage();
    process.exit(1);
  }

  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: { id: true, prioridad: true, descripcion: true, responsable_id: true, estado: true },
  });
  if (!pedido) {
    console.error(`Pedido #${pedidoId} no encontrado.`);
    process.exit(1);
  }

  const candidates = await buildCandidatesForPedido(pedidoId, limit, { includeUser: true, includeEta: true, includeAyudantes: true });
  if (!candidates.length) {
    console.log(`Sin candidatos para pedido #${pedidoId}.`);
    return;
  }

  console.log(`Pedido #${pedido.id} | prioridad=${pedido.prioridad} | estado=${pedido.estado} | responsable_actual=${pedido.responsable_id ?? 'N/A'}`);

  const rows = candidates.map((c, idx) => {
    const d = c.etaDiagnostics;
    return {
      rank: idx + 1,
      workerId: c.trabajadorId,
      nombre: c.nombre ?? 'N/A',
      score: Number(c.score.toFixed(4)),
      wip: c.wipActual,
      base_h: c.etaSecBase != null ? Number((c.etaSecBase / 3600).toFixed(2)) : null,
      model_base_h: d ? Number((d.modelBaseSec / 3600).toFixed(2)) : null,
      perf_factor: d ? Number(d.perfFactor.toFixed(2)) : null,
      score_factor: d ? Number(d.scoreFactor.toFixed(2)) : null,
      queue_h: d ? Number((d.queueSec / 3600).toFixed(2)) : null,
      total_h: c.etaSec != null ? Number((c.etaSec / 3600).toFixed(2)) : null,
      eta: c.eta?.display ?? null,
      reasons: (c.reasons ?? []).slice(0, 3).join(' | '),
    };
  });

  console.table(rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
