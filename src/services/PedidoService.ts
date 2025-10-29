import { prisma } from '../prisma/client';
import { CreatePedidoBody } from '../validators/pedidoValidator';

export async function createPedido(payload: CreatePedidoBody) {
  const data: any = {
    descripcion: payload.descripcion,
    prioridad: payload.prioridad,
    cliente_id: Number(payload.cliente_id),
    precio: payload.precio ?? null,
    fecha_estimada_fin: payload.fecha_estimada_fin ? new Date(payload.fecha_estimada_fin) : null,
    creado_por_id: null,
  };
  if (payload.responsable_id) data.responsable_id = Number(payload.responsable_id);

  const pedido = await prisma.pedidos.create({ data });
  return pedido;
}
