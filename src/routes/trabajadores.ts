import { Router } from 'express';
import * as ctrl from '../controllers/trabajadores.js';
import { authenticate, requireRole } from '../middlewares/authMiddleware.js';

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
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Al menos un campo es requerido. Actualización parcial soportada.
 *             minProperties: 1
 *             properties:
 *               direccion:
 *                 type: string
 *               rol_tecnico:
 *                 type: string
 *               estado:
 *                 type: string
 *                 description: Estado del trabajador (por ejemplo, "Activo")
 *               skills:
 *                 description: Lista de skills para mejorar asignación/ML
 *                 oneOf:
 *                   - type: array
 *                     items: { type: string }
 *                   - type: object
 *               carga_actual:
 *                 type: integer
 *                 description: WIP actual para balanceo de carga
 *               disponibilidad:
 *                 type: object
 *                 additionalProperties: true
 *     responses:
 *       '200':
 *         description: Trabajador actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 *       '422':
 *         description: Validación fallida (sin campos para actualizar)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedError'
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
 *       '200':
 *         description: Eliminado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.delete('/:id', authenticate, requireRole('admin'), ctrl.eliminar);

export default router;
