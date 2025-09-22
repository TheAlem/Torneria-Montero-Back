import { z } from 'zod';

export const CreateJobSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['BAJA', 'MEDIA', 'ALTA']).default('MEDIA'),
  clientId: z.string().uuid(),
  assignedWorkerId: z.string().uuid(),
  estimatedDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  price: z.number().positive(),
});

export type CreateJobBody = z.infer<typeof CreateJobSchema>;
