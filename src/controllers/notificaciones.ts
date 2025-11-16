import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';
import { success, fail, fieldsValidation } from '../utils/response.js';
import { resolveClienteIdentity } from '../services/ClienteIdentityService.js';
import * as ClientNotificationService from '../services/ClientNotificationService.js';

export const listarPropias = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user as { id: number } | undefined;
    if (!user) return fail(res, 'AUTH_ERROR', 'No autenticado', 401);
    const { clienteId } = await resolveClienteIdentity(user.id);
    if (!clienteId) return fail(res, 'AUTH_ERROR', 'Solo clientes pueden acceder a sus notificaciones', 403);

    const { page = 1, limit = 20, tipo, beforeId, onlyUnread, since } = req.query as any;
    const data = await ClientNotificationService.listForCliente(clienteId, {
      page: Number(page),
      limit: Number(limit),
      tipo: tipo as any,
      beforeId: beforeId ? Number(beforeId) : undefined,
      onlyUnread: onlyUnread ? String(onlyUnread).toLowerCase() === 'true' : false,
      desde: since ? new Date(since) : undefined,
    });
    return success(res, data);
  } catch (err) { next(err); }
};

export const marcarLeida = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user as { id: number } | undefined;
    if (!user) return fail(res, 'AUTH_ERROR', 'No autenticado', 401);
    const { clienteId } = await resolveClienteIdentity(user.id);
    if (!clienteId) return fail(res, 'AUTH_ERROR', 'Solo clientes pueden acceder a sus notificaciones', 403);

    const notificationId = Number(req.params.id);
    if (!notificationId) return fail(res, 'VALIDATION_ERROR', 'Identificador invalido', 400);
    const notif = await ClientNotificationService.markAsRead(clienteId, notificationId);
    if (!notif) return fail(res, 'NOT_FOUND', 'Notificacion no encontrada', 404);
    return success(res, notif, 200, 'Notificacion actualizada');
  } catch (err) { next(err); }
};

export const registrarPushToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user as { id: number } | undefined;
    if (!user) return fail(res, 'AUTH_ERROR', 'No autenticado', 401);
    const { clienteId } = await resolveClienteIdentity(user.id);
    if (!clienteId) return fail(res, 'AUTH_ERROR', 'Solo clientes pueden registrar notificaciones push', 403);

    const { token, platform } = req.body as { token?: string; platform?: string };
    if (!token || token.length < 20) {
      return fieldsValidation(res, { token: 'Token invalido' });
    }
    await prisma.clientes.update({ where: { id: clienteId }, data: { device_id: token, origen: platform || 'APP' } });
    return success(res, { token, platform: platform || 'APP' }, 200, 'Token actualizado');
  } catch (err) { next(err); }
};

export const marcarTodasLeidas = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user as { id: number } | undefined;
    if (!user) return fail(res, 'AUTH_ERROR', 'No autenticado', 401);
    const { clienteId } = await resolveClienteIdentity(user.id);
    if (!clienteId) return fail(res, 'AUTH_ERROR', 'Solo clientes pueden acceder a sus notificaciones', 403);

    const count = await ClientNotificationService.markAllAsRead(clienteId);
    return success(res, { updated: count }, 200, count ? 'Notificaciones actualizadas' : 'No habia notificaciones pendientes');
  } catch (err) { next(err); }
};

export default { listarPropias, marcarLeida, registrarPushToken, marcarTodasLeidas };
