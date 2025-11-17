import type { TipoNotificacion } from '@prisma/client';
import { prisma } from '../prisma/client.js';
import RealtimeService from '../realtime/RealtimeService.js';
import { logger } from '../utils/logger.js';
import { sendToCliente } from './FirebaseMessagingService.js';

type CreateNotificationArgs = {
  pedidoId: number;
  clienteId: number;
  mensaje: string;
  tipo?: TipoNotificacion;
  title?: string;
  data?: Record<string, string>;
};

type ListOptions = {
  page?: number;
  limit?: number;
  tipo?: TipoNotificacion;
  onlyUnread?: boolean;
  beforeId?: number;
  desde?: Date;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function buildTitle(tipo?: TipoNotificacion, customTitle?: string) {
  if (customTitle) return customTitle;
  switch (tipo) {
    case 'ENTREGA': return 'Pedido listo';
    case 'ALERTA': return 'Atención a tu pedido';
    case 'INFO':
    default:
      return 'Actualización de pedido';
  }
}

export async function createNotification(args: CreateNotificationArgs) {
  const payload = {
    pedido_id: args.pedidoId,
    cliente_id: args.clienteId,
    mensaje: args.mensaje,
    tipo: args.tipo ?? 'INFO' as TipoNotificacion,
  };

  try {
    const notif = await prisma.notificaciones.create({ data: payload });
    try {
      RealtimeService.emitToClient(args.clienteId, 'notification:new', notif);
    } catch {}

    try {
      await sendToCliente(args.clienteId, {
        title: buildTitle(payload.tipo, args.title),
        body: notif.mensaje,
        data: {
          pedidoId: String(args.pedidoId),
          tipo: payload.tipo,
          ...(args.data ?? {}),
        },
      });
    } catch {}

    return notif;
  } catch (err) {
    logger.warn({ msg: '[ClientNotificationService] Failed to persist notification', err: (err as any)?.message, payload });
    return null;
  }
}

export async function listForCliente(clienteId: number, options: ListOptions = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(options.limit) || DEFAULT_LIMIT));
  const listWhere: any = { cliente_id: clienteId };
  if (options.tipo) listWhere.tipo = options.tipo;
  if (options.onlyUnread) listWhere.leida = false;
  if (options.beforeId) listWhere.id = { lt: options.beforeId };
  if (options.desde) listWhere.fecha_creacion = { gte: options.desde };

  const totalWhere = { ...listWhere };
  if (totalWhere.id) delete totalWhere.id;

  const [items, total, unread] = await prisma.$transaction([
    prisma.notificaciones.findMany({
      where: listWhere,
      orderBy: { id: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.notificaciones.count({ where: totalWhere }),
    prisma.notificaciones.count({ where: { cliente_id: clienteId, leida: false } }),
  ]);

  return {
    page,
    limit,
    total,
    unread,
    items,
  };
}

export async function markAsRead(clienteId: number, notificationId: number) {
  const notif = await prisma.notificaciones.findFirst({ where: { id: notificationId, cliente_id: clienteId } });
  if (!notif) return null;
  if (notif.leida) return notif;
  return await prisma.notificaciones.update({ where: { id: notif.id }, data: { leida: true } });
}

export async function markAllAsRead(clienteId: number) {
  const result = await prisma.notificaciones.updateMany({
    where: { cliente_id: clienteId, leida: false },
    data: { leida: true }
  });
  return result.count;
}

export default {
  createNotification,
  listForCliente,
  markAsRead,
  markAllAsRead,
};
