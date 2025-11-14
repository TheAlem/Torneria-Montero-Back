import fs from 'fs';
import path from 'path';
import { prisma } from '../../prisma/client';
function datasetsDir() {
    return path.resolve(process.cwd(), 'datasets');
}
function ensureDatasetsDir() {
    const dir = datasetsDir();
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function toNumber(v) {
    if (v == null)
        return 0;
    // Prisma Decimal/BigInt may come as object/string; coerce safely
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
export async function exportDuracionesCSV(limit) {
    const take = (() => {
        if (Number.isFinite(limit))
            return Number(limit);
        const envLim = Number(process.env.ML_TRAIN_LIMIT || 2000);
        return Number.isFinite(envLim) ? Math.max(100, envLim) : 2000;
    })();
    const rows = await prisma.tiempos.findMany({
        where: { estado: 'CERRADO', duracion_sec: { not: null } },
        include: { pedido: { select: { prioridad: true, precio: true } } },
        orderBy: { id: 'desc' },
        take,
    });
    ensureDatasetsDir();
    const outPath = path.join(datasetsDir(), 'duraciones.csv');
    const header = 'prioridad,precio,duracion_sec';
    const lines = [header];
    for (const r of rows) {
        const prioridad = String(r.pedido?.prioridad || 'BAJA').toUpperCase();
        const precio = toNumber(r.pedido?.precio);
        const dur = Number(r.duracion_sec || 0);
        lines.push(`${prioridad},${precio},${dur}`);
    }
    fs.writeFileSync(outPath, lines.join('\n'), { encoding: 'utf8' });
    return { path: outPath, count: rows.length };
}
export default { exportDuracionesCSV };
