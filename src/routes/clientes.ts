import { Router } from 'express';
import * as ctrl from '../controllers/clientes.js';
import * as notificationsCtrl from '../controllers/notificaciones.js';
import { authenticate, requireRole } from '../middlewares/authMiddleware.js';

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
  *             required:
  *               - nombre
  *               - telefono
  *             properties:
  *               nombre: { type: string }
  *               telefono: { type: string }
  *               email: { type: string }
  *               direccion: { type: string }
  *               ci_rut: { type: string }
  *             example:
  *               nombre: "Cliente Demo"
  *               telefono: "+59170000000"
  *               email: "demo@client.com"
  *               direccion: "Calle Falsa 123"
  *               ci_rut: "12345678"
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
 * /api/clientes/notificaciones:
 *   get:
 *     tags:
 *       - Clientes
 *     summary: Listar notificaciones del cliente autenticado
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: tipo
 *         schema: { $ref: '#/components/schemas/TipoNotificacion' }
 *       - in: query
 *         name: onlyUnread
 *         schema: { type: boolean }
 *     responses:
 *       '200':
 *         description: Notificaciones del cliente autenticado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/notificaciones', authenticate, notificationsCtrl.listarPropias);

/**
 * @openapi
 * /api/clientes/notificaciones/token:
 *   post:
 *     tags:
 *       - Clientes
 *     summary: Registrar token de notificaciones push (FCM)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *               platform: { type: string }
 *     responses:
 *       '200':
 *         description: Token actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.post('/notificaciones/token', authenticate, notificationsCtrl.registrarPushToken);

/**
 * @openapi
 * /api/clientes/notificaciones/leidas:
 *   patch:
 *     tags:
 *       - Clientes
 *     summary: Marcar todas las notificaciones como leídas
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Total actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.patch('/notificaciones/leidas', authenticate, notificationsCtrl.marcarTodasLeidas);

/**
 * @openapi
 * /api/clientes/notificaciones/{id}/leida:
 *   patch:
 *     tags:
 *       - Clientes
 *     summary: Marcar notificación como leída
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
 *         description: Notificación actualizada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.patch('/notificaciones/:id/leida', authenticate, notificationsCtrl.marcarLeida);

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
