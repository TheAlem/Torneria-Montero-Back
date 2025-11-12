import fs from 'fs';
import path from 'path';

type Prioridad = 'ALTA'|'MEDIA'|'BAJA';

function datasetsDir() {
  return path.resolve(process.cwd(), 'datasets');
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function choice<T>(arr: T[], probs: number[]): T {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < arr.length; i++) {
    acc += probs[i];
    if (r <= acc) return arr[i];
  }
  return arr[arr.length - 1];
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function logNormal(mean: number, sigma: number) {
  // returns a multiplier > 0
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return Math.exp(mean + sigma * z);
}

function genRow(): { prioridad: Prioridad; precio: number; duracion_sec: number } {
  const prio = choice<Prioridad>(['ALTA','MEDIA','BAJA'], [0.35, 0.45, 0.20]);
  // Precio típico entre 200 y 5000
  const precio = randInt(200, 5000);

  // Base (segundos) por prioridad
  const base = prio === 'ALTA'
    ? randInt(2 * 3600, 5 * 3600)
    : prio === 'MEDIA'
      ? randInt(4 * 3600, 8 * 3600)
      : randInt(6 * 3600, 10 * 3600);

  // Influencia del precio (suave)
  const priceAdj = Math.round((precio / 100) * 45); // ~45s por cada 100 de precio

  // Ruido multiplicativo log-normal
  const noise = logNormal(0, 0.25); // 25% sigma

  // Outliers ocasionales
  let y = Math.max(180, Math.round((base + priceAdj) * noise));
  const r = Math.random();
  if (r < 0.02) {
    // 2%: outlier grande (2x a 5x)
    y = Math.round(y * (2 + Math.random() * 3));
  } else if (r < 0.025) {
    // 0.5%: trabajos muy largos (1 a 3 días)
    y = randInt(24 * 3600, 72 * 3600);
  }

  // Clamp razonable (3 min a 6 días)
  y = Math.min(6 * 24 * 3600, Math.max(180, y));
  return { prioridad: prio, precio, duracion_sec: y };
}

async function main() {
  const n = Number(process.env.GEN_N || process.argv[2] || 1000);
  const outDir = datasetsDir();
  ensureDir(outDir);
  const outPath = path.join(outDir, 'duraciones.csv');

  const header = 'prioridad,precio,duracion_sec';
  const lines: string[] = [header];
  for (let i = 0; i < n; i++) {
    const r = genRow();
    lines.push(`${r.prioridad},${r.precio},${r.duracion_sec}`);
  }
  fs.writeFileSync(outPath, lines.join('\n'), { encoding: 'utf8' });
  console.log(`Wrote ${n} rows to ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

