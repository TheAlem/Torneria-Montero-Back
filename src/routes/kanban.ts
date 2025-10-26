import { Router } from 'express';
import { listarKanban, cambiarEstado } from '../controllers/kanban';

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
router.get('/', listarKanban);

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
 *     responses:
 *       '200':
 *         description: Estado actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.patch('/:id/status', cambiarEstado);

export default router;
