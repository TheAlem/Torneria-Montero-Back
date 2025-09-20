import { Router } from 'express';
import * as ctrl from '../controllers/trabajadores.js';
import { authenticate, requireRole } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/', authenticate, ctrl.listar);
router.post('/', authenticate, requireRole('admin','tornero'), ctrl.crear);
router.get('/:id', authenticate, ctrl.obtener);
router.put('/:id', authenticate, requireRole('admin','tornero'), ctrl.actualizar);
router.delete('/:id', authenticate, requireRole('admin'), ctrl.eliminar);

export default router;
