import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';
import { JobStatus, Priority } from '../../generated/prisma/index.js';

// Common select for kanban cards to ensure consistency
const kanbanCardSelect = {
  id: true,
  code: true,
  description: true,
  workType: true,
  priority: true,
  status: true,
  paymentStatus: true,
  estimatedDelivery: true,
  updatedAt: true,
  client: {
    select: {
      id: true,
      name: true,
      phone: true,
    },
  },
  assignedWorker: {
    select: {
      id: true,
      fullName: true,
    },
  },
  _count: {
    select: {
      attachments: true,
      payments: true,
    },
  },
};

/**
 * Lists jobs for the Kanban board, organized by status.
 * Accepts query params for filtering and searching.
 */
export const listarKanban = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, workerId, clientId, priority, limit = '50' } = req.query;

    const parsedLimit = Math.min(parseInt(limit as string, 10) || 50, 200);

    const baseWhere: any = {
      AND: [],
    };

    if (workerId) {
      baseWhere.AND.push({ assignedWorkerId: workerId as string });
    }
    if (clientId) {
      baseWhere.AND.push({ clientId: clientId as string });
    }
    if (priority) {
      baseWhere.AND.push({ priority: priority as Priority });
    }
    if (q) {
      const searchQuery = {
        OR: [
          { code: { contains: q as string, mode: 'insensitive' } },
          { description: { contains: q as string, mode: 'insensitive' } },
          { client: { name: { contains: q as string, mode: 'insensitive' } } },
          { assignedWorker: { fullName: { contains: q as string, mode: 'insensitive' } } },
        ],
      };
      baseWhere.AND.push(searchQuery);
    }

    const [pending, inProgress, finished, delivered] = await Promise.all([
      prisma.job.findMany({
        where: { ...baseWhere, status: 'PENDIENTE' },
        select: kanbanCardSelect,
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        take: parsedLimit,
      }),
      prisma.job.findMany({
        where: { ...baseWhere, status: 'EN_PROCESO' },
        select: kanbanCardSelect,
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        take: parsedLimit,
      }),
      prisma.job.findMany({
        where: { ...baseWhere, status: 'TERMINADO' },
        select: kanbanCardSelect,
        orderBy: { updatedAt: 'desc' },
        take: parsedLimit,
      }),
      prisma.job.findMany({
        where: { ...baseWhere, status: 'ENTREGADO' },
        select: kanbanCardSelect,
        orderBy: { updatedAt: 'desc' },
        take: parsedLimit,
      }),
    ]);

    res.json({
      columns: {
        PENDIENTE: pending,
        EN_PROCESO: inProgress,
        TERMINADO: finished,
        ENTREGADO: delivered,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Changes the status of a job and records the change in history.
 */
export const cambiarEstado = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { newStatus, note, userId } = req.body;

    if (!newStatus || !Object.values(JobStatus).includes(newStatus)) {
      return res.status(400).json({ error: 'Invalid newStatus provided.' });
    }

    const job = await prisma.job.findUnique({ where: { id: id! } });

    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const oldStatus = job.status;

    const updatedJob = await prisma.$transaction(async (tx) => {
      const updated = await tx.job.update({
        where: { id: id!},
        data: { status: newStatus },
        select: kanbanCardSelect,
      });

      await tx.jobStatusHistory.create({
        data: {
          jobId: id!,
          oldStatus,
          newStatus,
          changedById: userId,
        },
      });

      return updated;
    });

    res.json({ ok: true, job: updatedJob });
  } catch (err) {
    next(err);
  }
};
