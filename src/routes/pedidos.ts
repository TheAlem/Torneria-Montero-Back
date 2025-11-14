import { Router } from 'express';
import * as ctrl from '../controllers/pedidos.js';
import { authenticate } from '../middlewares/authMiddleware.js';

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
 *       '422':
 *         description: Error de validación de campos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FieldsValidation'
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               descripcion: { type: string }
 *               prioridad: { type: string, enum: [BAJA, MEDIA, ALTA] }
 *               precio: { type: number, nullable: true }
 *               fecha_estimada_fin: { type: string, description: 'YYYY-MM-DD', nullable: true }
 *               estado: { type: string, enum: [PENDIENTE, ASIGNADO, EN_PROGRESO, QA, ENTREGADO] }
 *               responsable_id: { type: integer, nullable: true }
 *               semaforo: { type: string, enum: [VERDE, AMARILLO, ROJO] }
 *               notas: { type: string }
 *               adjuntos: { type: array, items: { type: string } }
 *     responses:
 *       '200':
 *         description: Pedido actualizado
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
 *       '200':
 *         description: Eliminado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.delete('/:id', authenticate, ctrl.eliminar);

/**
 * @openapi
 * /api/pedidos/{id}/estado:
 *   patch:
 *     tags:
 *       - Pedidos
 *     summary: Cambiar estado del pedido (drag & drop Kanban)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               estado:
 *                 type: string
 *                 enum: [PENDIENTE, ASIGNADO, EN_PROGRESO, QA, ENTREGADO]
 *               note:
 *                 type: string
 *               userId:
 *                 type: integer
 *     responses:
 *       '200':
 *         description: Estado actualizado y métricas recalculadas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.patch('/:id/estado', authenticate, ctrl.cambiarEstado);

export default router;
