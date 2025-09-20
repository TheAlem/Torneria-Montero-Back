import { Router } from 'express';
import * as ctrl from '../controllers/pedidos.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/', authenticate, ctrl.listar);
router.post('/', authenticate, ctrl.crear);
router.put('/:id', authenticate, ctrl.actualizar);
router.delete('/:id', authenticate, ctrl.eliminar);

export default router;
