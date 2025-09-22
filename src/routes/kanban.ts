import { Router } from 'express';
import { listarKanban, cambiarEstado } from '../controllers/kanban.js';

const router = Router();

router.get('/', listarKanban);
router.patch('/:id/status', cambiarEstado);

export default router;
