import { Router } from 'express';
import * as ctrl from '../controllers/onboarding';
import { authenticate } from '../middlewares/authMiddleware';
const router = Router();
/**
 * @openapi
 * /api/clientes/{id}/onboarding:
 *   post:
 *     tags:
 *       - Onboarding
 *     summary: Crear token de onboarding y URL para QR
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '201':
 *         description: Token creado
 */
router.post('/clientes/:id/onboarding', authenticate, ctrl.crearQR);
/**
 * @openapi
 * /api/onboarding/{token}:
 *   get:
 *     tags:
 *       - Onboarding
 *     summary: Validar token de onboarding (para la app)
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Datos mínimos del cliente
 */
router.get('/onboarding/:token', ctrl.validar);
/**
 * @openapi
 * /api/onboarding/{token}/complete:
 *   post:
 *     tags:
 *       - Onboarding
 *     summary: Completar onboarding creando contraseña del cliente
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password: { type: string }
 *     responses:
 *       '201':
 *         description: Usuario creado y sesión iniciada
 */
router.post('/onboarding/:token/complete', ctrl.completar);
export default router;
