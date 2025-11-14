import { prisma } from '../prisma/client';
import { predictTiempoSec } from './MLService';
function normalize(value, min, max) {
    if (!isFinite(value))
        return 0;
    if (max === min)
        return 0;
    return (value - min) / (max - min);
}
export async function rankTrabajadoresForPedido(pedidoId, limit = 5) {
    const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
    if (!pedido)
        return [];
    const trabajadores = await prisma.trabajadores.findMany({ where: { estado: 'Activo' } });
    if (!trabajadores.length)
        return [];
    const cargas = trabajadores.map(t => t.carga_actual || 0);
    const minCarga = Math.min(...cargas);
    const maxCarga = Math.max(...cargas);
    // Precalcular desempeño (menor desvío histórico es mejor)
    const desvios = await prisma.predicciones_tiempo.groupBy({
        by: ['trabajador_id'],
        _avg: { desvio: true },
    });
    const desvioMap = new Map();
    desvios.forEach(d => desvioMap.set(d.trabajador_id, d._avg.desvio ?? 0.3));
    const ranked = trabajadores.map(t => {
        const cargaNorm = 1 - normalize(t.carga_actual || 0, minCarga, maxCarga); // menor carga => mayor score
        const desvio = desvioMap.get(t.id) ?? 0.3; // promedio 0.3 si no hay datos
        const desvioScore = 1 - Math.min(Math.max(desvio, 0), 1); // 0..1
        const prioridadWeight = pedido.prioridad === 'ALTA' ? 1 : pedido.prioridad === 'MEDIA' ? 0.7 : 0.4;
        const score = 0.5 * cargaNorm + 0.4 * desvioScore + 0.1 * prioridadWeight;
        return { id: t.id, score: Number(score.toFixed(4)) };
    });
    return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}
export async function suggestTopTrabajador(pedidoId) {
    const ranked = await rankTrabajadoresForPedido(pedidoId, 1);
    return ranked[0] ?? null;
}
export async function candidatesDetailsForPedido(pedidoId, limit = 5) {
    const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId } });
    if (!pedido)
        return [];
    const ranked = await rankTrabajadoresForPedido(pedidoId, limit * 2); // rank más amplio, luego cortamos
    const ids = ranked.map(r => r.id);
    const workers = await prisma.trabajadores.findMany({
        where: { id: { in: ids }, estado: 'Activo' },
        include: { usuario: { select: { id: true, nombre: true, email: true } } }
    });
    // desvío promedio por trabajador (mayor precisión)
    const desvios = await prisma.predicciones_tiempo.groupBy({ by: ['trabajador_id'], _avg: { desvio: true }, where: { trabajador_id: { in: ids } } });
    const desvioMap = new Map();
    desvios.forEach(d => desvioMap.set(d.trabajador_id, d._avg.desvio ?? 0.3));
    const WIP_MAX = Math.max(1, Number(process.env.WIP_MAX || 3));
    const enriched = [];
    for (const r of ranked) {
        const w = workers.find(w => w.id === r.id);
        if (!w)
            continue;
        const estimated = await predictTiempoSec(pedidoId, w.id).catch(() => null);
        const avgDesvio = desvioMap.get(w.id) ?? null;
        const sobrecargado = (w.carga_actual || 0) >= WIP_MAX;
        enriched.push({
            trabajadorId: w.id,
            nombre: w.usuario?.nombre || null,
            email: w.usuario?.email || null,
            rol_tecnico: w.rol_tecnico || null,
            skills: w.skills || null,
            disponibilidad: w.disponibilidad || null,
            carga_actual: w.carga_actual || 0,
            wipMax: WIP_MAX,
            sobrecargado,
            score: r.score,
            tiempo_estimado_sec: estimated,
            desvio_promedio: typeof avgDesvio === 'number' ? Number(avgDesvio.toFixed(3)) : null,
        });
        if (enriched.length >= limit)
            break;
    }
    return enriched;
}
