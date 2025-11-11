import { Router } from 'express';
import * as ctrl from '../controllers/asignaciones';
import { authenticate, requireRole } from '../middlewares/authMiddleware';
import { suggestCandidates, autoAssignForced } from '../services/AssignmentService';
import { prisma } from '../prisma/client';
import { success as ok, fail } from '../utils/response';

const router = Router();

/**
 * @openapi
 * /api/asignar:
 *   post:
 *     tags:
 *       - Asignaciones
 *     summary: Asignar pedido a trabajador
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pedido_id:
 *                 type: integer
 *               trabajador_id:
 *                 type: integer
 *     responses:
 *       '201':
 *         description: Asignación creada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.post('/', authenticate, requireRole('admin','tornero'), ctrl.asignar);

/**
 * @openapi
 * /api/asignar:
 *   get:
 *     tags:
 *       - Asignaciones
 *     summary: Listar asignaciones
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Lista de asignaciones
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/', authenticate, ctrl.listar);

/**
 * @openapi
 * /api/asignar/suggest:
 *   get:
 *     tags:
 *       - Asignaciones
 *     summary: Sugerencias de asignación (candidatos ordenados)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: pedidoId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: Candidatos sugeridos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: 'string', example: 'success' }
 *                 message: { type: ['string','null'], example: null }
 *                 data:
 *                   type: object
 *                   properties:
 *                     candidates:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Candidate'
 */
router.get('/suggest', authenticate, requireRole('admin','tornero'), async (req, res, next) => {
  try {
    const pedidoId = Number(req.query?.pedidoId);
    if (!Number.isFinite(pedidoId)) return fail(res, 'VALIDATION_ERROR', 'pedidoId inválido', 422);
    const exists = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { id: true } });
    if (!exists) return fail(res, 'NOT_FOUND', 'Pedido no encontrado', 404);
    const candidates = await suggestCandidates(pedidoId);
    return ok(res, { candidates });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/asignar/auto:
 *   post:
 *     tags:
 *       - Asignaciones
 *     summary: Auto-asignar pedido al mejor candidato disponible
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pedidoId:
 *                 type: integer
 *     responses:
 *       '200':
 *         description: Auto-asignación realizada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: 'string', example: 'success' }
 *                 message: { type: ['string','null'], example: null }
 *                 data:
 *                   $ref: '#/components/schemas/AutoAssignResponse'
 *       '404':
 *         description: Pedido no encontrado
 *       '409':
 *         description: No se pudo auto-asignar (candidatos saturados)
 *       '422':
 *         description: Validación fallida
 */
router.post('/auto', authenticate, requireRole('admin','tornero'), async (req, res, next) => {
  try {
    const pedidoId = Number(req.body?.pedidoId);
    if (!Number.isFinite(pedidoId)) return fail(res, 'VALIDATION_ERROR', 'pedidoId inválido', 422);
    const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { id: true, estado: true } });
    if (!pedido) return fail(res, 'NOT_FOUND', 'Pedido no encontrado', 404);
    if (String(pedido.estado).toUpperCase() === 'ENTREGADO') return fail(res, 'VALIDATION_ERROR', 'El pedido ya fue entregado', 422);

    // Gatillo explícito desde el panel: fuerza auto-assign aunque AUTO_ASSIGN_ENABLED esté en false
    const done = await autoAssignForced(pedidoId);
    if (!done) return fail(res, 'CONFLICT', 'No se pudo auto-asignar (sin candidatos o saturados)', 409);

    const updated = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { responsable_id: true, semaforo: true } });
    return ok(res, { autoAssigned: true, pedidoId, trabajadorId: updated?.responsable_id ?? null, semaforo: updated?.semaforo ?? null });
  } catch (err) { next(err); }
});

export default router;
