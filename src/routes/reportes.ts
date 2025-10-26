import { Router } from 'express';
import * as ctrl from '../controllers/reportes';
import { authenticate } from '../middlewares/authMiddleware';

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

export default router;
