import { Router } from 'express';
import * as ctrl from '../controllers/asignaciones.js';
import { authenticate, requireRole } from '../middlewares/authMiddleware.js';
import { suggestAssignmentBundle, autoAssignForced } from '../services/AssignmentService.js';
import { prisma } from '../prisma/client.js';
import { success as ok, fail } from '../utils/response.js';

const router = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     Candidate:
 *       type: object
 *       properties:
 *         trabajadorId:
 *           type: integer
 *         nombre:
 *           type: string
 *           nullable: true
 *         skills:
 *           type: array
 *           items:
 *             type: string
 *         wipActual:
 *           type: integer
 *         wipMax:
 *           type: integer
 *         capacidadLibreMin:
 *           type: number
 *         desvioHistorico:
 *           type: number
 *         etaSiToma:
 *           type: string
 *           nullable: true
 *           description: Fecha/hora sugerida (local) sin año, formato dd/MM HH:mm
  *         etaFecha:
  *           type: string
  *           nullable: true
  *           description: Día y mes sugeridos (dd/MM)
  *         etaHora:
  *           type: string
  *           nullable: true
  *           description: Hora sugerida (HH:mm)
  *         etaIso:
  *           type: string
  *           nullable: true
  *           format: date-time
  *           description: ISO completa por compatibilidad
 *         saturado:
 *           type: boolean
 *         score:
 *           type: number
 *         razones:
 *           type: array
 *           items:
 *             type: string
 *         hardConstraints:
 *           type: array
 *           items:
 *             type: string
 *         tiempo_estimado_sec:
 *           type: number
 *           nullable: true
 *         tiempo_estimado_base_sec:
 *           type: number
 *           nullable: true
 *         tiempo_estimado_rango:
 *           type: object
 *           nullable: true
 *           properties:
 *             minSec: { type: number }
 *             maxSec: { type: number }
 *             bufferPct: { type: number }
 *     SupportCandidate:
 *       type: object
 *       properties:
 *         trabajadorId:
 *           type: integer
 *         nombre:
 *           type: string
 *           nullable: true
 *         email:
 *           type: string
 *           nullable: true
 *         skills:
 *           type: array
 *           items:
 *             type: string
 *         rol_tecnico:
 *           type: string
 *           nullable: true
 *         tareas_generales:
 *           type: array
 *           items:
 *             type: string
 *         motivo:
 *           type: string
 *     AutoAssignResponse:
 *       type: object
 *       properties:
 *         autoAssigned:
 *           type: boolean
 *         pedidoId:
 *           type: integer
 *         trabajadorId:
 *           type: integer
 *           nullable: true
 *         semaforo:
 *           type: string
 *           enum: [VERDE, AMARILLO, ROJO]
 */

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
 *                 status: { type: string, example: success }
 *                 message: { type: string, nullable: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     candidates:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Candidate'
 *                     apoyo_manual:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/SupportCandidate'
*/
router.get('/suggest', authenticate, requireRole('admin','tornero'), async (req, res, next) => {
  try {
    const pedidoId = Number(req.query?.pedidoId);
    if (!Number.isFinite(pedidoId)) return fail(res, 'VALIDATION_ERROR', 'pedidoId inválido', 422);
    const exists = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { id: true } });
    if (!exists) return fail(res, 'NOT_FOUND', 'Pedido no encontrado', 404);
    const { candidates, apoyoManual } = await suggestAssignmentBundle(pedidoId);
    return ok(res, { candidates, apoyo_manual: apoyoManual });
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
 *                 status: { type: string, example: success }
 *                 message: { type: string, nullable: true }
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
