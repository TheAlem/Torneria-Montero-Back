import { prisma } from '../prisma/client.js';
import { CreatePedidoBody } from '../validators/pedidoValidator.js';
import { recalcPedidoEstimate } from './MLService.js';
import { buildDetalleFromPayload, buildNotasFromDetalle } from './PedidoDetails.js';
import { scheduleEvaluatePedidos } from './KanbanMonitorService.js';

async function resolveClienteId(payload: CreatePedidoBody): Promise<number> {
  if (payload.cliente_id) return Number(payload.cliente_id);
  const c = payload.cliente!;

  // Intentar match por CI/RUT si viene
  if (c.ci_rut && c.ci_rut.trim()) {
    const found = await prisma.clientes.findFirst({
      where: { ci_rut: { equals: c.ci_rut.trim(), mode: 'insensitive' } }
    });
    if (found) return found.id;
  }

  // Si no hay CI o no existe, intentar por nombre + teléfono/email si están
  const candidate = await prisma.clientes.findFirst({
    where: {
      AND: [
        { nombre: { equals: c.nombre, mode: 'insensitive' } },
        c.telefono ? { telefono: { equals: c.telefono, mode: 'insensitive' } } : {},
        c.email ? { email: { equals: c.email, mode: 'insensitive' } } : {},
      ]
    }
  });
  if (candidate) return candidate.id;

  // Crear nuevo cliente si no se encontró
  const created = await prisma.clientes.create({
    data: {
      nombre: c.nombre,
      ci_rut: c.ci_rut || null,
      email: c.email || null,
      telefono: c.telefono || null,
      direccion: c.direccion || null,
      origen: 'QR',
    }
  });
  return created.id;
}

export async function createPedido(payload: CreatePedidoBody) {
  const clienteId = await resolveClienteId(payload);
  const titulo = payload.titulo;
  const { detalle, hasDetalle } = buildDetalleFromPayload(payload);
  let notas = (payload as any).notas ?? null;
  const data: any = {
    titulo,
    descripcion: payload.descripcion,
    prioridad: payload.prioridad,
    cliente_id: Number(clienteId),
    precio: payload.precio ?? null,
    fecha_estimada_fin: payload.fecha_estimada_fin ? new Date(payload.fecha_estimada_fin) : null,
    pagado: payload.pagado ?? false,
    creado_por_id: null,
  };
  if (payload.responsable_id) data.responsable_id = Number(payload.responsable_id);
  if (hasDetalle) {
    data.detalle_trabajo = detalle;
    notas = buildNotasFromDetalle(detalle);
  }
  if (typeof notas === 'string' && notas.trim()) data.notas = notas;

  const pedido = await prisma.pedidos.create({ data });
  try {
    await recalcPedidoEstimate(pedido.id, { trabajadorId: data.responsable_id ?? null, updateFechaEstimada: true });
  } catch {}
  scheduleEvaluatePedidos(pedido.id);
  return await prisma.pedidos.findUnique({ where: { id: pedido.id } }) as any;
}
