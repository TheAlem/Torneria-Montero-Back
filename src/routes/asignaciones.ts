import { Router } from 'express';
import * as ctrl from '../controllers/asignaciones';
import { authenticate, requireRole } from '../middlewares/authMiddleware';

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
 * /api/asignar/sugerencias:
 *   get:
 *     tags:
 *       - Asignaciones
 *     summary: Obtener sugerencias de trabajadores para un pedido con info detallada
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: pedidoId
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, example: 5 }
 *     responses:
 *       '200':
 *         description: Sugerencias de asignación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/sugerencias', authenticate, ctrl.sugerencias);

export default router;
