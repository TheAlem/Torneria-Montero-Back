import fs from 'fs';
import path from 'path';

type Row = {
  descripcion: string;
  prioridad: 'ALTA'|'MEDIA'|'BAJA';
  precio: number;
  trabajador_id: number;
  trabajador_nombre: string;
  trabajador_skills: string;
  trabajador_fecha_ingreso: string; // YYYY-MM-DD
  t_real_sec: number;
  t_estimado_sec: number;
  inicio: string; // ISO
  fin: string; // ISO
  fecha_estimada_fin: string; // ISO
};

function outDir() { return path.resolve(process.cwd(), 'datasets'); }
function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

// Workers fijos (IDs existentes indicados por el usuario)
const workers = [
  { id: 1, nombre: 'Cristian Valverde', skills: 'rodamiento,palier,prensa,alineado,torneado,torneado_base', ingreso: '2023-03-10' },
  { id: 2, nombre: 'Pablo Gomez', skills: 'soldadura,engranaje,corona,rellenado,recargue,fresado,torneado_base', ingreso: '2022-06-15' },
  { id: 3, nombre: 'Pablo Velasquez', skills: 'buje,bandeja,bronce,tren_delantero,torneado,prensa', ingreso: '2021-11-05' },
];

// Plantillas por tipo de trabajo
const templates = {
  w1: [
    'Cambio de rodamientos de palier delantero (x2). Prensa y alineado. ø40 mm.',
    'Cambio de rodamientos palier (delantero). Prensa y alineado.',
    'Tornear base de asiento de rodamiento. Control de coaxialidad.',
    'Rellenar y tornear base de rodamiento (asiento).',
    'Ajuste de alojamiento de rodamiento. ø45 H7.',
  ],
  w2: [
    'Rellenado/recargue de dientes de corona (maquinaria agrícola). Soldadura + fresado.',
    'Rellenado de dientes de engranaje. Soldadura y fresado fino.',
    'Recargue de corona y rectificado de flancos.',
    'Soldadura de fisura y fresado de engranaje.',
    'Rellenado y fresado de dientes de corona.',
  ],
  w3: [
    'Cambio de bujes de bandeja (x2) en bronce. Ajuste a prensa. ø20 mm ±0.05.',
    'Cambio de bujes de bronce de tren delantero. ø22 mm H7.',
    'Cambio de bujes de bandeja (x4) material bronce. Prensa.',
    'Cambio de bujes de tren delantero. Ajuste prensa y verificación.',
    'Cambio de bujes. Material bronce. Control de tolerancias.',
  ],
};

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function pick<T>(arr: T[]) { return arr[rand(0, arr.length - 1)]; }

function precioBase(workerId: number): number {
  if (workerId === 1) return rand(800, 1200);
  if (workerId === 2) return rand(1100, 1400);
  return rand(580, 1050);
}

function prioridad(workerId: number): 'ALTA'|'MEDIA'|'BAJA' {
  const r = Math.random();
  if (workerId === 1) return r < 0.45 ? 'ALTA' : r < 0.9 ? 'MEDIA' : 'BAJA';
  if (workerId === 2) return r < 0.2 ? 'ALTA' : r < 0.9 ? 'MEDIA' : 'BAJA';
  return r < 0.3 ? 'ALTA' : r < 0.9 ? 'MEDIA' : 'BAJA';
}

function realSeconds(workerId: number, prio: 'ALTA'|'MEDIA'|'BAJA'): number {
  const base = prio === 'ALTA' ? rand(4*3600, 6*3600)
              : prio === 'MEDIA' ? rand(6*3600, 9*3600)
              : rand(7*3600, 10*3600);
  const adj = workerId === 2 ? rand(0, 3)*600 : 0; // trabajos de soldadura a veces más largos
  return base + adj;
}

function estSeconds(real: number): number {
  // estimado +/- 10%
  const delta = Math.round(real * (rand(-10, 10) / 100));
  return Math.max(900, real + delta);
}

function genRow(i: number): Row {
  const w = workers[i % workers.length];
  const prio = prioridad(w.id);
  const precio = precioBase(w.id);
  const real = realSeconds(w.id, prio);
  const estim = estSeconds(real);
  const now = Date.now();
  const start = new Date(now - rand(3, 15) * 24*3600*1000 - rand(1, 6)*3600*1000);
  const end = new Date(start.getTime() + real*1000);
  const desc = w.id === 1 ? pick(templates.w1) : w.id === 2 ? pick(templates.w2) : pick(templates.w3);
  return {
    descripcion: desc,
    prioridad: prio,
    precio,
    trabajador_id: w.id,
    trabajador_nombre: w.nombre,
    trabajador_skills: w.skills,
    trabajador_fecha_ingreso: w.ingreso,
    t_real_sec: real,
    t_estimado_sec: estim,
    inicio: start.toISOString(),
    fin: end.toISOString(),
    fecha_estimada_fin: end.toISOString(),
  };
}

function toCSV(rows: Row[]): string {
  const header = 'descripcion,prioridad,precio,trabajador_id,trabajador_nombre,trabajador_skills,trabajador_fecha_ingreso,t_real_sec,t_estimado_sec,inicio,fin,fecha_estimada_fin';
  const esc = (s: string|number) => {
    if (s === null || s === undefined) return '';
    const str = String(s);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [header];
  for (const r of rows) {
    lines.push([
      esc(r.descripcion), r.prioridad, r.precio, r.trabajador_id,
      esc(r.trabajador_nombre), esc(r.trabajador_skills), r.trabajador_fecha_ingreso,
      r.t_real_sec, r.t_estimado_sec, r.inicio, r.fin, r.fecha_estimada_fin
    ].join(','));
  }
  return lines.join('\n');
}

async function main() {
  const N = Number(process.env.GEN_N || 300);
  const rows: Row[] = [];
  for (let i = 0; i < N; i++) rows.push(genRow(i));
  ensureDir(outDir());
  const outPath = path.join(outDir(), 'train_300.csv');
  fs.writeFileSync(outPath, toCSV(rows), { encoding: 'utf8' });
  console.log(`Wrote ${rows.length} rows → ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });

