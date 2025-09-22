import { Router } from 'express';
import * as ctrl from '../controllers/jobs.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/', authenticate, ctrl.listJobs);
router.post('/', authenticate, ctrl.createJob);
router.get('/workers', authenticate, ctrl.listWorkers);
router.get('/:code', authenticate, ctrl.getJobByCode);
router.put('/:id', authenticate, ctrl.updateJob);
router.delete('/:id', authenticate, ctrl.deleteJob);

export default router;

