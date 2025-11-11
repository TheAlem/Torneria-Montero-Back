import { Router } from 'express';
import { listarKanban, cambiarEstado, evaluarSemaforo } from '../controllers/kanban';
import { authenticate, requireRole } from '../middlewares/authMiddleware';

const router = Router();

/**
 * @openapi
 * /kanban:
 *   get:
 *     tags:
 *       - Kanban
 *     summary: Obtener tablero kanban
 *     responses:
 *       '200':
 *         description: Kanban
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/', authenticate, listarKanban);

/**
 * @openapi
 * /kanban/{id}/status:
 *   patch:
 *     tags:
 *       - Kanban
 *     summary: Cambiar estado de pedido
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               newStatus:
 *                 type: string
 *               note:
 *                 type: string
 *               userId:
 *                 type: integer
 *     responses:
 *       '200':
 *         description: Estado actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.patch('/:id/status', authenticate, cambiarEstado);

/**
 * @openapi
 * /kanban/evaluar:
 *   post:
 *     tags:
 *       - Kanban
 *     summary: Evaluar semáforo y notificar retrasos (solo ADMIN)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: autoReassign
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Si es true, intenta reasignación automática en pedidos en ROJO. Por defecto false (solo sugiere).
 *     responses:
 *       '200':
 *         description: Evaluación completada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.post('/evaluar', authenticate, requireRole('admin'), evaluarSemaforo);

export default router;
