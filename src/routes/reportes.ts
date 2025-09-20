import { Router } from 'express';
import * as ctrl from '../controllers/reportes.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/semanal', authenticate, ctrl.semanal);
router.get('/mensual', authenticate, ctrl.mensual);

export default router;
