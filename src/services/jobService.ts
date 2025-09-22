import { prisma } from '../prisma/client.js';
import { CreateJobBody } from '../validators/jobValidator.js';

export async function createJob(payload: CreateJobBody) {
  // generate a unique code for the job
  const code = `P-${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

  const job = await prisma.job.create({
    data: {
      ...payload,
      code,
      estimatedDelivery: payload.estimatedDelivery ? new Date(payload.estimatedDelivery) : null,
    },
  });

  return job;
}
