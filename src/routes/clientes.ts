import { Router } from 'express';
import * as ctrl from '../controllers/clientes';
import { authenticate, requireRole } from '../middlewares/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/clientes:
 *   get:
 *     tags:
 *       - Clientes
 *     summary: Listar todos los clientes
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Lista de clientes (envoltorio unificado)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClientListResponseWrapper'
 */
router.get('/', authenticate, ctrl.listar);

/**
 * @openapi
 * /api/clientes:
 *   post:
 *     tags:
 *       - Clientes
 *     summary: Crear un cliente
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *               telefono:
 *                 type: string
 *     responses:
 *       '201':
 *         description: Cliente creado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.post('/', ctrl.crear);

/**
 * @openapi
 * /api/clientes/{id}:
 *   get:
 *     tags:
 *       - Clientes
 *     summary: Obtener cliente por id
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
 *         description: Cliente encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/:id', authenticate, ctrl.obtener);

/**
 * @openapi
 * /api/clientes/{id}:
 *   put:
 *     tags:
 *       - Clientes
 *     summary: Actualizar cliente
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
 *         description: Cliente actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.put('/:id', authenticate, requireRole('admin'), ctrl.actualizar);

/**
 * @openapi
 * /api/clientes/{id}:
 *   delete:
 *     tags:
 *       - Clientes
 *     summary: Eliminar cliente
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
router.delete('/:id', authenticate, requireRole('admin'), ctrl.eliminar);

export default router;
