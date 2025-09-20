import { Router } from 'express';
import * as ctrl from '../controllers/asignaciones.js';
import { authenticate, requireRole } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/', authenticate, requireRole('admin','tornero'), ctrl.asignar);
router.get('/', authenticate, ctrl.listar);

export default router;
