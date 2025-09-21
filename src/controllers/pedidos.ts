import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';
import * as JobService from '../services/jobService.js';

// In this codebase 'Job' represents trabajos. Keep an alias for readability.
export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobs = await prisma.job.findMany({ include: { client: true, assignedWorker: true }, orderBy: { dateCreated: 'desc' } });
    res.json(jobs);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Map incoming fields to the validator/service shape used by JobService
    const body = {
      code: undefined,
      workType: req.body.workType,
      description: req.body.description,
      priority: req.body.priority || 'Media',
      clientName: req.body.clientName,
      clientPhone: req.body.clientPhone,
      clientEmail: req.body.clientEmail,
      clientAddress: req.body.clientAddress,
      clientCompany: req.body.clientCompany,
      clientAppEmail: req.body.clientAppEmail,
      clientAppPhone: req.body.clientAppPhone,
      sendAppInstructions: req.body.sendAppInstructions || false,
      estimatedDelivery: req.body.estimatedDelivery,
      assignedWorker: req.body.assignedWorkerName || req.body.assignedWorkerId,
      paymentAmount: String(req.body.paymentAmount || '0'),
      paymentStatus: req.body.paymentStatus || 'Pendiente',
      materials: req.body.materials,
      specifications: req.body.specifications,
      dateCreated: req.body.dateCreated || new Date().toISOString().slice(0,10)
    } as any;
    const job = await JobService.createFromForm(body);
    res.status(201).json(job);
  } catch (err) { next(err); }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const data: any = {};
    const updatable = ['workType', 'description', 'paymentAmount', 'priority', 'paymentStatus', 'materials', 'specifications', 'status'];
    updatable.forEach(k => { if ((req.body as any)[k] !== undefined) data[k] = (req.body as any)[k]; });
    const job = await prisma.job.update({ where: { id }, data });
    res.json(job);
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    await prisma.job.delete({ where: { id } });
    res.status(204).end();
  } catch (err) { next(err); }
};
