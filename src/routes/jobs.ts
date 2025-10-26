import { Router } from 'express';
import * as ctrl from '../controllers/jobs';
import { authenticate, requireRole } from '../middlewares/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/jobs:
 *   get:
 *     tags:
 *       - Jobs
 *     summary: Listar jobs (pedidos)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Lista de jobs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/', authenticate, ctrl.listJobs);

/**
 * @openapi
 * /api/jobs:
 *   post:
 *     tags:
 *       - Jobs
 *     summary: Crear job
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '201':
 *         description: Job creado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.post('/', authenticate, requireRole('ADMIN', 'TORNERO'), ctrl.createJob);

/**
 * @openapi
 * /api/jobs/workers:
 *   get:
 *     tags:
 *       - Jobs
 *     summary: Listar trabajadores disponibles
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
router.get('/workers', authenticate, ctrl.listWorkers);

/**
 * @openapi
 * /api/jobs/{code}:
 *   get:
 *     tags:
 *       - Jobs
 *     summary: Obtener job por código
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Job encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/:code', authenticate, ctrl.getJobByCode);

/**
 * @openapi
 * /api/jobs/{id}:
 *   put:
 *     tags:
 *       - Jobs
 *     summary: Actualizar job
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
 *         description: Job actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.put('/:id', authenticate, ctrl.updateJob);

/**
 * @openapi
 * /api/jobs/{id}:
 *   delete:
 *     tags:
 *       - Jobs
 *     summary: Eliminar job
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
router.delete('/:id', authenticate, ctrl.deleteJob);

export default router;

