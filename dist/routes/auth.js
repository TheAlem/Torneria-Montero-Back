import { Router } from 'express';
import { register, login, adminCreate } from '../controllers/auth';
import { authenticate, requireRole } from '../middlewares/authMiddleware';
const router = Router();
/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Registrar usuario
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               nombre:
 *                 type: string
 *               rol:
 *                 type: string
 *                 enum: [ADMIN, TORNERO, CLIENTE, TRABAJADOR]
 *                 description: CLIENTE por defecto. Si TRABAJADOR, crea registro en trabajadores y no devuelve token. ci_rut es requerido cuando rol=TRABAJADOR.
 *               ci_rut:
 *                 type: string
 *               telefono:
 *                 type: string
 *               direccion:
 *                 type: string
 *     responses:
 *       '201':
 *         description: Usuario registrado
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
router.post('/register', register);
/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Login usuario
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Login exitoso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.post('/login', login);
/**
 * @openapi
 * /auth/admin/users:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Crear usuario TORNERO o TRABAJADOR (solo ADMIN)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, rol]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               nombre:
 *                 type: string
 *               telefono:
 *                 type: string
 *               direccion:
 *                 type: string
 *               rol:
 *                 type: string
 *                 enum: [TORNERO, TRABAJADOR, ADMIN]
 *               ci_rut:
 *                 type: string
 *                 description: Requerido cuando rol=TRABAJADOR
 *               rol_tecnico:
 *                 type: string
 *     responses:
 *       '201':
 *         description: Usuario creado
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
router.post('/admin/users', authenticate, requireRole('admin'), adminCreate);
export default router;
