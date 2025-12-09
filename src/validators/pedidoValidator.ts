import { z } from 'zod';

const ClienteInlineSchema = z.object({
  nombre: z.string().min(1),
  ci_rut: z.string().min(3).optional(),
  email: z.string().email().optional(),
  telefono: z.string().min(5).optional(),
  direccion: z.string().optional(),
});

export const CreatePedidoSchema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().min(1),
  prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA']).default('MEDIA'),
  cliente_id: z.number().int().optional(),
  cliente: ClienteInlineSchema.optional(),
  responsable_id: z.number().int().optional(),
  fecha_estimada_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  precio: z.number().positive().optional(),
  pagado: z.boolean().optional(),
}).refine((data) => !!data.cliente_id || !!data.cliente, {
  message: 'Debe proporcionar cliente_id o un objeto cliente',
  path: ['cliente'],
});

export type CreatePedidoBody = z.infer<typeof CreatePedidoSchema>;

export const UpdatePedidoSchema = z.object({
  titulo: z.string().min(1).optional(),
  descripcion: z.string().min(1).optional(),
  prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA']).optional(),
  precio: z.number().positive().nullable().optional(),
  fecha_estimada_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  estado: z.enum(['PENDIENTE','ASIGNADO','EN_PROGRESO','QA','ENTREGADO']).optional(),
  responsable_id: z.number().int().nullable().optional(),
  semaforo: z.enum(['VERDE','AMARILLO','ROJO']).optional(),
  notas: z.string().optional(),
  adjuntos: z.array(z.string()).optional(),
  pagado: z.boolean().optional(),
});

export type UpdatePedidoBody = z.infer<typeof UpdatePedidoSchema>;
