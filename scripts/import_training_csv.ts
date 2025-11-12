import fs from 'fs';
import path from 'path';
import { prisma } from '../src/prisma/client';

type Row = {
  descripcion: string;
  prioridad: 'ALTA' | 'MEDIA' | 'BAJA';
  precio: number;
  trabajador_nombre?: string;
  trabajador_id?: number;
  trabajador_skills?: string; // coma separada
  trabajador_fecha_ingreso?: string; // ISO o YYYY-MM-DD
  duracion_sec?: number;
  inicio?: string; // ISO opcional
  fin?: string; // ISO opcional
};

function parseCSV(filePath: string): Row[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map(s => s.trim());
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const rec: any = {};
    header.forEach((h, idx) => { rec[h] = (cols[idx] ?? '').trim(); });
    // cast
    if (rec.precio !== undefined) rec.precio = Number(rec.precio || 0);
    if (rec.trabajador_id) rec.trabajador_id = Number(rec.trabajador_id);
    if (rec.duracion_sec) rec.duracion_sec = Number(rec.duracion_sec);
    out.push(rec as Row);
  }
  return out;
}

async function ensureCsvClient() {
  let c = await prisma.clientes.findFirst({ where: { nombre: 'CSV Import' } });
  if (!c) {
    c = await prisma.clientes.create({ data: { nombre: 'CSV Import', estado: 'Activo' } });
  }
  return c.id;
}

async function ensureTrabajador(row: Row) {
  if (row.trabajador_id && Number.isFinite(row.trabajador_id)) {
    const t = await prisma.trabajadores.findUnique({ where: { id: Number(row.trabajador_id) } });
    if (t) return t.id;
  }
  const nombre = String(row.trabajador_nombre || '').trim() || `worker-${Date.now()}`;
  const email = `worker+${nombre.replace(/[^a-z0-9]+/gi, '.').toLowerCase()}@csv.local`;
  const user = await prisma.usuarios.create({
    data: { email, password_hash: '!', rol: 'TRABAJADOR' as any, nombre }
  });
  const trabajador = await prisma.trabajadores.create({
    data: {
      usuario_id: user.id,
      ci: `csv-${user.id}`,
      direccion: null,
      rol_tecnico: null,
      skills: row.trabajador_skills ? row.trabajador_skills.split(/\s*[,;]\s*/).filter(Boolean) : undefined,
      fecha_ingreso: row.trabajador_fecha_ingreso ? new Date(row.trabajador_fecha_ingreso) : undefined,
    }
  });
  return trabajador.id;
}

function computeDuracion(row: Row): number | null {
  if (Number.isFinite(row.duracion_sec)) return Number(row.duracion_sec);
  if (row.inicio && row.fin) {
    const a = new Date(row.inicio).getTime();
    const b = new Date(row.fin).getTime();
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return Math.round((b - a) / 1000);
    }
  }
  return null;
}

async function main() {
  const fileArg = process.argv[2] || process.env.IMPORT_CSV || 'datasets/train.csv';
  const fp = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(fp)) {
    console.error(`CSV no encontrado: ${fp}`);
    process.exit(1);
  }
  const rows = parseCSV(fp);
  if (!rows.length) {
    console.error('CSV vacío o sin filas');
    process.exit(1);
  }
  const clienteId = await ensureCsvClient();
  let ok = 0, skipped = 0;
  for (const r of rows) {
    try {
      const tId = await ensureTrabajador(r);
      const dur = computeDuracion(r);
      if (!dur || !Number.isFinite(dur)) { skipped++; continue; }
      const pedido = await prisma.pedidos.create({
        data: {
          cliente_id: clienteId,
          descripcion: r.descripcion || 'CSV import',
          prioridad: (r.prioridad as any) || 'MEDIA',
          precio: Number.isFinite(r.precio) ? r.precio : null,
          responsable_id: tId,
          estado: 'PENDIENTE',
        }
      });
      await prisma.tiempos.create({
        data: {
          pedido_id: pedido.id,
          trabajador_id: tId,
          duracion_sec: dur,
          estado: 'CERRADO',
        }
      });
      ok++;
    } catch (e) {
      skipped++;
    }
  }
  console.log(`Importados ${ok} registros de tiempos; omitidos ${skipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

