import { prisma } from '../prisma/client';
import { success, fail } from '../utils/response';
import { suggestTopTrabajador } from '../services/HeuristicsService';
import { predictTiempoSec, storePrediccion } from '../services/MLService';
import { logger } from '../utils/logger';
import RealtimeService from '../realtime/RealtimeService';
// Asignación simple: actualizar Pedido con responsable
export const asignar = async (req, res, next) => {
    try {
        const { pedido_id, trabajador_id, origen = 'MANUAL', score_sugerencia, skill_match, tiempo_estimado_sec, comentarios } = req.body;
        if (!pedido_id)
            return fail(res, 'VALIDATION_ERROR', 'pedido_id requerido', 400);
        let trabajador = Number(trabajador_id);
        // Si no se especifica trabajador, sugerir uno
        if (!trabajador) {
            const sugerido = await suggestTopTrabajador(Number(pedido_id));
            if (!sugerido)
                return fail(res, 'NOT_FOUND', 'No hay trabajadores disponibles', 404);
            trabajador = sugerido.id;
            if (typeof score_sugerencia === 'undefined')
                req.score_sugerencia = sugerido.score;
        }
        // Estimar tiempo si no viene
        let tEstimado = typeof tiempo_estimado_sec === 'number' ? tiempo_estimado_sec : undefined;
        if (typeof tEstimado === 'undefined') {
            tEstimado = await predictTiempoSec(Number(pedido_id), trabajador);
        }
        // Create an assignment record
        const asign = await prisma.asignaciones.create({ data: {
                pedido_id: Number(pedido_id),
                trabajador_id: Number(trabajador),
                origen,
                score_sugerencia: typeof req.score_sugerencia === 'number' ? req.score_sugerencia : (score_sugerencia ?? null),
                skill_match: skill_match ?? null,
                tiempo_estimado_sec: tEstimado ?? null,
                comentarios: comentarios ?? null,
            } });
        // Update pedido responsable (usar el trabajador resuelto, no solo el input)
        const current = await prisma.pedidos.findUnique({ where: { id: Number(pedido_id) }, select: { fecha_estimada_fin: true, estado: true } });
        // No cambiamos el estado a ASIGNADO; se mantiene en PENDIENTE hasta que manualmente pase a EN_PROGRESO desde el Kanban
        const dataUpdate = { responsable_id: Number(trabajador), tiempo_estimado_sec: tEstimado ?? null };
        if (!current?.fecha_estimada_fin && typeof tEstimado === 'number') {
            dataUpdate.fecha_estimada_fin = new Date(Date.now() + tEstimado * 1000);
        }
        await prisma.pedidos.update({ where: { id: Number(pedido_id) }, data: dataUpdate });
        // Persist predicted time for learning history
        if (tEstimado)
            await storePrediccion(Number(pedido_id), trabajador, tEstimado);
        logger.info({ msg: 'Asignación creada', asign });
        const pedidoAct = await prisma.pedidos.findUnique({ where: { id: Number(pedido_id) }, include: { cliente: true, responsable: { include: { usuario: { select: { id: true, nombre: true, email: true, telefono: true, rol: true } } } } } });
        // Alerta para operadores: pedido asignado
        try {
            RealtimeService.emitWebAlert('ASIGNACION', `Pedido #${Number(pedido_id)} asignado`, { pedidoId: Number(pedido_id), trabajadorId: Number(trabajador), responsable: pedidoAct?.responsable?.usuario?.nombre || null });
        }
        catch { }
        return success(res, { asignacion: asign, pedido: pedidoAct }, 201, 'Pedido asignado');
    }
    catch (err) {
        next(err);
    }
};
export const listar = async (req, res, next) => {
    try {
        const asigns = await prisma.asignaciones.findMany({ include: { pedido: true, trabajador: true }, orderBy: { fecha_asignacion: 'desc' } });
        return success(res, asigns);
    }
    catch (err) {
        next(err);
    }
};
