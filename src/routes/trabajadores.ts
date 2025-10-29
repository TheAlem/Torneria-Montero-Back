import { Router } from 'express';
import * as ctrl from '../controllers/trabajadores';
import { authenticate, requireRole } from '../middlewares/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/trabajadores:
 *   get:
 *     tags:
 *       - Trabajadores
 *     summary: Listar trabajadores
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Lista de trabajadores
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/', authenticate, ctrl.listar);

/**
 * @openapi
 * /api/trabajadores/{id}:
 *   get:
 *     tags:
 *       - Trabajadores
 *     summary: Obtener trabajador por id
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
 *         description: Trabajador encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/:id', authenticate, ctrl.obtener);

/**
 * @openapi
 * /api/trabajadores/{id}:
 *   put:
 *     tags:
 *       - Trabajadores
 *     summary: Actualizar trabajador
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
 *         description: Trabajador actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.put('/:id', authenticate, requireRole('admin','tornero'), ctrl.actualizar);

/**
 * @openapi
 * /api/trabajadores/{id}:
 *   delete:
 *     tags:
 *       - Trabajadores
 *     summary: Eliminar trabajador
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
