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

/**
 * @openapi
 * /ml/status:
 *   get:
 *     tags:
 *       - ML
 *     summary: Estado del modelo ONNX
 *     description: Indica si los archivos del modelo ONNX y meta.json están presentes.
 *     responses:
 *       '200':
 *         description: Estado del modelo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
// Healthcheck simple del modelo ONNX (sin auth)
router.get('/status', ctrl.status);

/**
 * @openapi
 * /ml/train-onnx:
 *   post:
 *     tags:
 *       - ML
 *     summary: Entrenar modelo ONNX (solo ADMIN)
 *     description: Ejecuta el script de entrenamiento Python, guarda meta/onnx y recarga la sesión en memoria.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [linear, onnx]
 *                 description: Si se omite, usa ML_PROVIDER (por defecto 'linear').
 *               limit:
 *                 type: integer
 *                 description: Límite de muestras de entrenamiento (por defecto ML_TRAIN_LIMIT)
 *     responses:
 *       '201':
 *         description: ONNX entrenado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.post('/train-onnx', authenticate, requireRole('admin'), ctrl.trainOnnx);

export default router;

