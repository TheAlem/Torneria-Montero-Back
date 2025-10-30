import { z } from 'zod';

export const CreatePedidoSchema = z.object({
  descripcion: z.string().min(1),
  prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA']).default('MEDIA'),
  cliente_id: z.number().int(),
  responsable_id: z.number().int().optional(),
  fecha_estimada_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  precio: z.number().positive().optional(),
});

export type CreatePedidoBody = z.infer<typeof CreatePedidoSchema>;

export const UpdatePedidoSchema = z.object({
  descripcion: z.string().min(1).optional(),
  prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA']).optional(),
  precio: z.number().positive().nullable().optional(),
  fecha_estimada_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  estado: z.enum(['PENDIENTE','ASIGNADO','EN_PROGRESO','QA','ENTREGADO']).optional(),
  responsable_id: z.number().int().nullable().optional(),
  semaforo: z.enum(['VERDE','AMARILLO','ROJO']).optional(),
  notas: z.string().optional(),
  adjuntos: z.array(z.string()).optional(),
});

export type UpdatePedidoBody = z.infer<typeof UpdatePedidoSchema>;
