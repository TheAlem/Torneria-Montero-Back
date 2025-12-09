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
 * /api/pedidos/clientes:
 *   get:
 *     tags:
 *       - Pedidos
 *     summary: Listar pedidos del cliente autenticado (app)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Lista de pedidos del cliente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/clientes', authenticate, ctrl.listarDelCliente);

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
 *             required:
 *               - titulo
 *               - descripcion
 *             properties:
 *               titulo:
 *                 type: string
 *                 description: Titulo corto del trabajo/pedido
 *               descripcion:
 *                 type: string
 *                 description: Descripcion detallada del trabajo
 *               prioridad:
 *                 type: string
 *                 enum: [BAJA, MEDIA, ALTA]
 *                 default: MEDIA
 *               cliente_id:
 *                 type: integer
 *                 description: ID de cliente existente (opcional si se envia objeto cliente)
 *               cliente:
 *                 type: object
 *                 description: Crear/identificar cliente en linea (alternativa a cliente_id)
 *                 required: [nombre]
 *                 properties:
 *                   nombre: { type: string }
 *                   ci_rut: { type: string }
 *                   email: { type: string }
 *                   telefono: { type: string }
 *                   direccion: { type: string }
 *               responsable_id:
 *                 type: integer
 *                 description: Trabajador responsable (opcional)
 *               fecha_estimada_fin:
 *                 type: string
 *                 format: date
 *                 description: YYYY-MM-DD
 *               precio:
 *                 type: number
 *                 description: Precio estimado del trabajo
 *             example:
 *               titulo: "Reparar eje principal"
 *               descripcion: "Rectificar eje y soldar soporte"
 *               prioridad: "ALTA"
 *               cliente:
 *                 nombre: "Industrias ABC"
 *                 telefono: "+59170000000"
 *               responsable_id: 3
 *               fecha_estimada_fin: "2025-11-05"
 *               precio: 1200
 *     responses:
 *       '201':
 *         description: Pedido creado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 *       '422':
 *         description: Error de validacion de campos
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
 *               titulo: { type: string }
 *               descripcion: { type: string }
 *               prioridad: { type: string, enum: [BAJA, MEDIA, ALTA] }
 *               precio: { type: number, nullable: true }
 *               fecha_estimada_fin: { type: string, description: 'YYYY-MM-DD', nullable: true }
 *               estado: { type: string, enum: [PENDIENTE, ASIGNADO, EN_PROGRESO, QA, ENTREGADO] }
 *               responsable_id: { type: integer, nullable: true }
 *               semaforo: { type: string, enum: [VERDE, AMARILLO, ROJO] }
 *               notas: { type: string }
 *               adjuntos: { type: array, items: { type: string } }
 *               pagado: { type: boolean }
 *     responses:
 *       '200':
 *         description: Pedido actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 *       '422':
 *         description: Error de validacion de campos
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
 *         description: Estado actualizado y metricas recalculadas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.patch('/:id/estado', authenticate, ctrl.cambiarEstado);

export default router;
