import { Router } from 'express';
import * as ctrl from '../controllers/pedidos';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/pedidos:
 *   get:
 *     tags:
 *       - Pedidos
 *     summary: Listar pedidos
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Lista de pedidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/', authenticate, ctrl.listar);

/**
 * @openapi
 * /api/pedidos/{id}:
 *   get:
 *     tags:
 *       - Pedidos
 *     summary: Obtener pedido por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Pedido encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 *       '404':
 *         description: Pedido no encontrado
 */
router.get('/:id', authenticate, ctrl.getById);

/**
 * @openapi
 * /api/pedidos:
 *   post:
 *     tags:
 *       - Pedidos
 *     summary: Crear pedido
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               descripcion:
 *                 type: string
 *     responses:
 *       '201':
 *         description: Pedido creado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.post('/', authenticate, ctrl.crear);

/**
 * @openapi
 * /api/pedidos/{id}:
 *   put:
 *     tags:
 *       - Pedidos
 *     summary: Actualizar pedido
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Pedido actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.put('/:id', authenticate, ctrl.actualizar);

/**
 * @openapi
 * /api/pedidos/{id}:
 *   delete:
 *     tags:
 *       - Pedidos
 *     summary: Eliminar pedido
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '204':
 *         description: Eliminado
 */
router.delete('/:id', authenticate, ctrl.eliminar);

export default router;
