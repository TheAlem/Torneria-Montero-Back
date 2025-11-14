import { prisma } from '../prisma/client';
import { predictTiempoSec } from './MLService';
import RealtimeService from '../realtime/RealtimeService';
function getThresholds(prioridad) {
    const baseYellow = Number(process.env.SEMAFORO_RATIO_YELLOW || 0.7);
    const baseRed = Number(process.env.SEMAFORO_RATIO_RED || 1.0);
    if (prioridad === 'ALTA') {
        const y = Number(process.env.SEMAFORO_RATIO_YELLOW_HIGH || 0.6);
        const r = Number(process.env.SEMAFORO_RATIO_RED_HIGH || 0.9);
        return { yellow: y, red: r };
    }
    return { yellow: baseYellow, red: baseRed };
}
async function getTiempoRealSec(pedidoId) {
    const now = Date.now();
    const registros = await prisma.tiempos.findMany({
        where: { pedido_id: pedidoId },
        orderBy: { id: 'asc' },
        select: { duracion_sec: true, estado: true, inicio: true }
    });
    const cerrados = registros.filter(r => r.estado === 'CERRADO' && typeof r.duracion_sec === 'number').reduce((a, b) => a + (b.duracion_sec || 0), 0);
    const abierto = registros.find(r => r.estado === 'ABIERTO');
    const abiertoSec = abierto?.inicio ? Math.max(0, Math.round((now - new Date(abierto.inicio).getTime()) / 1000)) : 0;
    return cerrados + abiertoSec;
}
export async function computeSemaforoForPedido(pedidoId) {
    const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { fecha_estimada_fin: true, prioridad: true, responsable_id: true } });
    if (!pedido || !pedido.fecha_estimada_fin) {
        return { color: 'VERDE', tRealSec: 0, tEstimadoSec: 0, slackSec: Number.MAX_SAFE_INTEGER, ratio: 0 };
    }
    const tRealSec = await getTiempoRealSec(pedidoId);
    const responsableId = pedido.responsable_id ?? 0;
    const tEstimadoSec = await predictTiempoSec(pedidoId, responsableId);
    const tRestanteSec = Math.max(0, tEstimadoSec - tRealSec);
    const slackSec = Math.round((new Date(pedido.fecha_estimada_fin).getTime() - Date.now()) / 1000);
    const ratio = slackSec > 0 ? (tRestanteSec / slackSec) : Number.POSITIVE_INFINITY;
    if (slackSec <= 0)
        return { color: 'ROJO', tRealSec, tEstimadoSec, slackSec, ratio };
    const { yellow, red } = getThresholds(pedido.prioridad);
    const color = ratio > red ? 'ROJO' : ratio > yellow ? 'AMARILLO' : 'VERDE';
    return { color, tRealSec, tEstimadoSec, slackSec, ratio };
}
export async function applyAndEmitSemaforo(pedidoId) {
    const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, include: { cliente: true } });
    if (!pedido)
        return { changed: false };
    const { color, tRealSec, tEstimadoSec, slackSec, ratio } = await computeSemaforoForPedido(pedidoId);
    const prev = pedido.semaforo;
    if (prev !== color) {
        await prisma.pedidos.update({ where: { id: pedidoId }, data: { semaforo: color } }).catch(() => { });
        try {
            RealtimeService.emitToOperators('kanban:semaforo-changed', { pedidoId, semaforo: color, tRealSec, tEstimadoSec, slackSec, ratio });
            if (color === 'ROJO') {
                RealtimeService.emitWebAlert('RETRASO', `Pedido #${pedidoId} en riesgo (ROJO)`, { pedidoId, ratio });
                // Notificación al cliente (throttle por DB + SSE ya tienen anti-spam)
                try {
                    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
                    const recent = await prisma.notificaciones.findFirst({
                        where: { pedido_id: pedidoId, tipo: 'ALERTA', fecha_creacion: { gte: cutoff } },
                        orderBy: { id: 'desc' }
                    });
                    if (!recent) {
                        const notif = await prisma.notificaciones.create({
                            data: { pedido_id: pedidoId, cliente_id: pedido.cliente_id, mensaje: 'Tu pedido podría retrasarse. Estamos ajustando la planificación.', tipo: 'ALERTA' }
                        }).catch(() => null);
                        if (notif)
                            RealtimeService.emitToClient(pedido.cliente_id, 'notification:new', notif);
                    }
                }
                catch { }
            }
        }
        catch { }
        return { changed: true, prev, color, tRealSec, tEstimadoSec, slackSec, ratio };
    }
    return { changed: false, prev, color, tRealSec, tEstimadoSec, slackSec, ratio };
}
export default { computeSemaforoForPedido, applyAndEmitSemaforo };
