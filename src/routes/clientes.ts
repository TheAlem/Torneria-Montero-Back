import { Router } from 'express';
import * as ctrl from '../controllers/clientes.js';
import { authenticate, requireRole } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/', authenticate, ctrl.listar);
router.post('/', ctrl.crear);
router.get('/:id', authenticate, ctrl.obtener);
router.put('/:id', authenticate, requireRole('admin'), ctrl.actualizar);
router.delete('/:id', authenticate, requireRole('admin'), ctrl.eliminar);

export default router;
