import { Router } from 'express';
import * as ctrl from '../controllers/jobs.js';
import apiKeyAuth from '../middlewares/apiKeyAuth.js';

const router = Router();

router.post('/', apiKeyAuth, ctrl.createJob);
router.get('/workers', apiKeyAuth, ctrl.listWorkers);
router.get('/:code', apiKeyAuth, ctrl.getJobByCode);

export default router;
