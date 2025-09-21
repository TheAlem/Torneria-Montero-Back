import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';

// Simple assignment: update a Job to set assignedWorkerId
export const asignar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId, workerId } = req.body;
    const job = await prisma.job.update({ where: { id: jobId }, data: { assignedWorkerId: workerId } });
    res.status(200).json(job);
  } catch (err) { next(err); }
};

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const jobs = await prisma.job.findMany({ include: { client: true, assignedWorker: true }, orderBy: { dateCreated: 'desc' } });
  const assignments = jobs.filter(j => j.assignedWorkerId !== null);
  res.json(assignments);
  } catch (err) { next(err); }
};
