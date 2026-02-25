import { z } from 'zod';

const FechaISODateSchema = z.iso.date();
const FechaISODateTimeSchema = z.iso.datetime({ local: true, offset: true });
const FechaHoraSoloHoraRegex = /^(\d{4}-\d{2}-\d{2})T(\d{2})$/;

const normalizeFechaEstimadaFin = (raw: string) => {
  const value = raw.trim();
  const onlyHourMatch = value.match(FechaHoraSoloHoraRegex);
  if (onlyHourMatch) return `${onlyHourMatch[1]}T${onlyHourMatch[2]}:00`;
  return value;
};

const FechaEstimadaFinSchema = z
  .string()
  .trim()
  .transform((value) => normalizeFechaEstimadaFin(value))
  .refine((value) => {
    return (
      FechaISODateSchema.safeParse(value).success
      || FechaISODateTimeSchema.safeParse(value).success
    );
  }, {
    message: 'Debe ser YYYY-MM-DD o fecha-hora ISO 8601 valida (ej: 2026-02-25T15:30 o 2026-02-25T15:30:00Z)',
  });

const ClienteInlineSchema = z.object({
  nombre: z.string().min(1),
  ci_rut: z.string().min(3).optional(),
  email: z.string().email().optional(),
  telefono: z.string().min(5).optional(),
  direccion: z.string().optional(),
});

const DetalleTrabajoSchema = z.object({
  materiales: z.array(z.string()).optional(),
  procesos: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  tolerancia: z.string().optional(),
  rosca: z.boolean().optional(),
  rosca_paso: z.string().nullable().optional(),
  cantidad_piezas: z.union([z.string(), z.number()]).optional(),
  diametro_principal: z.union([z.string(), z.number()]).optional(),
  descripcion_guiada: z.string().nullable().optional(),
  codigo_interno: z.string().nullable().optional(),
});

export const CreatePedidoSchema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().min(1),
  prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA']).default('MEDIA'),
  cliente_id: z.number().int().optional(),
  cliente: ClienteInlineSchema.optional(),
  responsable_id: z.number().int().optional(),
  fecha_estimada_fin: FechaEstimadaFinSchema.optional(),
  precio: z.number().positive().optional(),
  pagado: z.boolean().optional(),
  notas: z.string().optional(),
  ...DetalleTrabajoSchema.shape,
}).strict().refine((data) => !!data.cliente_id || !!data.cliente, {
  message: 'Debe proporcionar cliente_id o un objeto cliente',
  path: ['cliente'],
});

export type CreatePedidoBody = z.infer<typeof CreatePedidoSchema>;

export const UpdatePedidoSchema = z.object({
  titulo: z.string().min(1).optional(),
  descripcion: z.string().min(1).optional(),
  prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA']).optional(),
  precio: z.number().positive().nullable().optional(),
  fecha_estimada_fin: FechaEstimadaFinSchema.nullable().optional(),
  estado: z.enum(['PENDIENTE','ASIGNADO','EN_PROGRESO','QA','ENTREGADO']).optional(),
  responsable_id: z.number().int().nullable().optional(),
  semaforo: z.enum(['VERDE','AMARILLO','ROJO']).optional(),
  notas: z.string().optional(),
  adjuntos: z.array(z.string()).optional(),
  pagado: z.boolean().optional(),
  ...DetalleTrabajoSchema.shape,
}).strict();

export type UpdatePedidoBody = z.infer<typeof UpdatePedidoSchema>;
