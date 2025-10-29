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
 *     summary: Entrenar modelo de estimación de tiempo (solo ADMIN)
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
 *                 description: Cantidad máxima de registros de entrenamiento (por defecto 1000)
 *     responses:
 *       '201':
 *         description: Modelo entrenado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.post('/train', authenticate, requireRole('admin'), ctrl.train);

export default router;

