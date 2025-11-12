import { Router } from 'express';
import * as ctrl from '../controllers/ml';
import { authenticate, requireRole } from '../middlewares/authMiddleware';

const router = Router();

/**
 * @openapi
 * /ml/train:
 *   post:
 *     tags:
 *       - ML
 *     summary: Entrenar modelo lineal de estimacion de tiempo (solo ADMIN)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               limit:
 *                 type: integer
 *                 description: Cantidad maxima de registros de entrenamiento (por defecto 1000)
 *     responses:
 *       '201':
 *         description: Modelo entrenado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.post('/train', authenticate, requireRole('admin'), ctrl.train);

/**
 * @openapi
 * /ml/status:
 *   get:
 *     tags:
 *       - ML
 *     summary: Estado del modelo lineal
 *     description: Indica si el archivo del modelo lineal esta presente.
 *     responses:
 *       '200':
 *         description: Estado del modelo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
// Healthcheck del modelo lineal (sin auth)
router.get('/status', ctrl.status);

export default router;

