import { Router } from 'express';
import * as ctrl from '../controllers/reportes.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

/**
 * @openapi
 * /reportes/semanal:
 *   get:
 *     tags:
 *       - Reportes
 *     summary: Reporte semanal
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Reporte semanal
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/semanal', authenticate, ctrl.semanal);

/**
 * @openapi
 * /reportes/mensual:
 *   get:
 *     tags:
 *       - Reportes
 *     summary: Reporte mensual
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Reporte mensual
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/mensual', authenticate, ctrl.mensual);

/**
 * @openapi
 * /reportes/alertas:
 *   get:
 *     tags:
 *       - Reportes
 *     summary: Historial de alertas (web)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           example: 50
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *           example: '2025-01-01T00:00:00.000Z'
 *     responses:
 *       '200':
 *         description: Lista de alertas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/alertas', authenticate, ctrl.alertas);

export default router;
