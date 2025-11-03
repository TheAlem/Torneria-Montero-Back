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
 * /api/clientes/buscar:
 *   get:
 *     tags:
 *       - Clientes
 *     summary: Buscar cliente por CI o sugerencias por nombre/teléfono
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: ci_rut
 *         schema: { type: string }
 *       - in: query
 *         name: nombre
 *         schema: { type: string }
 *       - in: query
 *         name: telefono
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Resultado de búsqueda (match exacto o candidatos)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/buscar', authenticate, ctrl.buscar);

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
 *       '422':
 *         description: Error de validación de campos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FieldsValidation'
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
 *       '200':
 *         description: Eliminado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.delete('/:id', authenticate, requireRole('admin'), ctrl.eliminar);

export default router;
