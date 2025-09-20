import { Request, Response, NextFunction } from 'express';
import { CreateJobSchema } from '../validators/jobValidator.js';
import * as JobService from '../services/jobService.js';
import { prisma } from '../prisma/client.js';

export const createJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateJobSchema.parse(req.body);
    const job = await JobService.createFromForm(parsed as any);
    return res.status(201).json({ job });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
};

export const getJobByCode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.params.code;
    const job = await (await import('../prisma/client.js')).prisma.job.findUnique({ where: { code }, include: { client: { include: { appAccount: true } }, assignedWorker: true } });
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json({ job });
  } catch (err) { next(err); }
};

export const listWorkers = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const workers = await prisma.worker.findMany({ where: { active: true } });
  res.json(workers.map((w: { id: string; fullName: string }) => ({ id: w.id, fullName: w.fullName })));
  } catch (err) { next(err); }
};
