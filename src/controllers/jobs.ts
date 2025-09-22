import { Request, Response, NextFunction } from 'express';
import { CreateJobSchema } from '../validators/jobValidator.js';
import * as JobService from '../services/jobService.js';
import { prisma } from '../prisma/client.js';

export const createJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateJobSchema.parse(req.body);
    const job = await JobService.createJob(parsed);
    return res.status(201).json({ job });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
};

export const getJobByCode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.params.code;
    if (!code) return res.status(400).json({ error: 'code required' });
    const job = await prisma.job.findFirst({ where: { code }, include: { client: true, assignedWorker: true } });
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json({ job });
  } catch (err) { next(err); }
};

export const listJobs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const jobs = await prisma.job.findMany({
      include: { client: true, assignedWorker: true },
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    const total = await prisma.job.count();
    res.json({ jobs, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

export const updateJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const job = await prisma.job.update({
      where: { id },
      data: req.body,
    });
    res.json(job);
  } catch (err) { next(err); }
};

export const deleteJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    await prisma.job.delete({ where: { id } });
    res.status(204).end();
  } catch (err) { next(err); }
};

export const listWorkers = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const workers = await prisma.worker.findMany({ where: { active: true } });
  res.json(workers.map((w: { id: string; fullName: string }) => ({ id: w.id, fullName: w.fullName })));
  } catch (err) { next(err); }
};