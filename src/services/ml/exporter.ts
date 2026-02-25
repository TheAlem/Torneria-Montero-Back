import fs from 'fs';
import path from 'path';
import { prisma } from '../../prisma/client.js';

function datasetsDir() {
  return path.resolve(process.cwd(), 'datasets');
}

function ensureDatasetsDir() {
  const dir = datasetsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function toNumber(v: any): number {
  if (v == null) return 0;
  // Prisma Decimal/BigInt may come as object/string; coerce safely
  const n = Number(v as any);
  return Number.isFinite(n) ? n : 0;
}

export async function exportDuracionesCSV(limit?: number) {
  const take = ((): number => {
    if (Number.isFinite(limit as number)) return Number(limit);
    const envLim = Number(process.env.ML_TRAIN_LIMIT || 2000);
    return Number.isFinite(envLim) ? Math.max(100, envLim) : 2000;
  })();

  const rawRows = await prisma.tiempos.findMany({
    where: { estado: 'CERRADO', duracion_sec: { not: null } },
    include: { pedido: { select: { id: true, prioridad: true, precio: true, estado: true } } },
    orderBy: { id: 'desc' },
    take: Math.max(take * 4, take),
  });

  const grouped = new Map<number, { prioridad: string; precio: number; duracion: number; maxId: number }>();
  for (const r of rawRows) {
    if (!r.pedido || r.pedido.estado !== 'ENTREGADO') continue;
    const prev = grouped.get(r.pedido_id) ?? {
      prioridad: String(r.pedido.prioridad || 'BAJA').toUpperCase(),
      precio: toNumber((r as any).pedido?.precio),
      duracion: 0,
      maxId: 0,
    };
    prev.duracion += Number(r.duracion_sec || 0);
    prev.maxId = Math.max(prev.maxId, r.id);
    grouped.set(r.pedido_id, prev);
  }
  const rows = Array.from(grouped.values()).sort((a, b) => b.maxId - a.maxId).slice(0, take);

  ensureDatasetsDir();
  const outPath = path.join(datasetsDir(), 'duraciones.csv');

  const header = 'prioridad,precio,duracion_sec';
  const lines = [header];
  for (const r of rows) {
    const prioridad = r.prioridad;
    const precio = r.precio;
    const dur = Number(r.duracion || 0);
    lines.push(`${prioridad},${precio},${dur}`);
  }

  fs.writeFileSync(outPath, lines.join('\n'), { encoding: 'utf8' });
  return { path: outPath, count: rows.length };
}

export default { exportDuracionesCSV };

