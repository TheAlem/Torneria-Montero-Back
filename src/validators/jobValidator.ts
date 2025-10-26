import { z } from 'zod';

export const CreateJobSchema = z.object({
  descripcion: z.string().min(1),
  prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA']).default('MEDIA'),
  cliente_id: z.number().int(),
  responsable_id: z.number().int().optional(),
  fecha_estimada_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  precio: z.number().positive().optional(),
});

export type CreateJobBody = z.infer<typeof CreateJobSchema>;
