import { prisma } from '../prisma/client';
import { success } from '../utils/response';
import { logger } from '../utils/logger';
import { evaluateAndNotify } from '../services/KanbanMonitorService';
import { transitionEstado } from '../services/PedidoWorkflow';
import { computeSemaforoForPedido } from '../services/SemaforoService';
// Common select for kanban cards to ensure consistency
const kanbanCardSelect = {
    id: true,
    descripcion: true,
    prioridad: true,
    estado: true,
    semaforo: true,
    fecha_estimada_fin: true,
    fecha_actualizacion: true,
    cliente: { select: { id: true, nombre: true, telefono: true } },
    responsable: { select: { id: true, usuario: { select: { id: true, nombre: true } } } },
};
/**
 * Lists pedidos for the Kanban board, organized by status.
 * Accepts query params for filtering and searching.
 */
export const listarKanban = async (req, res, next) => {
    try {
        const { q, workerId, clientId, priority, limit = '50' } = req.query;
        const parsedLimit = Math.min(parseInt(String(limit), 10) || 50, 200);
        const baseWhere = { AND: [{ eliminado: false }] };
        if (workerId)
            baseWhere.AND.push({ responsable_id: Number(workerId) });
        if (clientId)
            baseWhere.AND.push({ cliente_id: Number(clientId) });
        if (priority)
            baseWhere.AND.push({ prioridad: priority });
        if (q) {
            const searchQuery = {
                OR: [
                    { descripcion: { contains: q, mode: 'insensitive' } },
                    { cliente: { nombre: { contains: q, mode: 'insensitive' } } },
                ],
            };
            baseWhere.AND.push(searchQuery);
        }
        // Normalize legacy enum variants
        const normalizeEstado = (s) => {
            if (!s)
                return s;
            const map = {
                EN_PROCESO: 'EN_PROGRESO',
                EN_PROGRESO: 'EN_PROGRESO',
                PENDIENTE: 'PENDIENTE',
                QA: 'QA',
                ENTREGADO: 'ENTREGADO',
                ASIGNADO: 'ASIGNADO',
            };
            return map[s] ?? s;
        };
        const [pending, inProgress, qa, delivered] = await Promise.all([
            prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('PENDIENTE') }, select: kanbanCardSelect, orderBy: [{ prioridad: 'desc' }, { fecha_actualizacion: 'desc' }], take: parsedLimit }),
            prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('EN_PROGRESO') }, select: kanbanCardSelect, orderBy: [{ prioridad: 'desc' }, { fecha_actualizacion: 'desc' }], take: parsedLimit }),
            prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('QA') }, select: kanbanCardSelect, orderBy: { fecha_actualizacion: 'desc' }, take: parsedLimit }),
            prisma.pedidos.findMany({ where: { ...baseWhere, estado: normalizeEstado('ENTREGADO') }, select: kanbanCardSelect, orderBy: { fecha_actualizacion: 'desc' }, take: parsedLimit }),
        ]);
        return success(res, { columns: { PENDIENTE: pending, EN_PROGRESO: inProgress, QA: qa, ENTREGADO: delivered } });
    }
    catch (err) {
        next(err);
    }
};
/**
 * Changes the status of a pedido and records the change in history.
 */
export const cambiarEstado = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { newStatus, note, userId } = req.body || {};
        const pedido = await transitionEstado(Number(id), newStatus, { note, userId });
        // Metrics for tooltip
        let semaforoMetrics = null;
        try {
            semaforoMetrics = await computeSemaforoForPedido(Number(id));
        }
        catch { }
        logger.info({ msg: '[Kanban] Estado cambiado', id, newStatus, userId });
        return success(res, { ok: true, pedido, semaforo: semaforoMetrics?.color ?? pedido?.semaforo ?? null, metrics: semaforoMetrics });
    }
    catch (err) {
        next(err);
    }
};
/**
 * Triggers a semaphore evaluation and notifications (ADMIN / operator).
 */
export const evaluarSemaforo = async (req, res, next) => {
    try {
        // By default, manual evaluation DOES NOT auto reassign. ?autoReassign=true to allow.
        const autoReassign = String(req.query?.autoReassign || 'false').toLowerCase() === 'true';
        const result = await evaluateAndNotify({ suggestOnly: !autoReassign });
        const checked = Number(result?.checked ?? 0);
        const affectedArr = Array.isArray(result?.affected) ? result.affected : [];
        const affectedCount = affectedArr.length;
        const responseData = { processed: checked, delayed: affectedCount, checked, affectedCount, total: checked, totalChecked: checked, requiresAttention: affectedCount, affected: affectedArr, result };
        return success(res, responseData, 200, 'Evaluación completada');
    }
    catch (err) {
        next(err);
    }
};
