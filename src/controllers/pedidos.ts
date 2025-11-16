import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';
import * as PedidoService from '../services/PedidoService.js';
import { success, fail, fieldsValidation } from '../utils/response.js';
import { UpdatePedidoSchema } from '../validators/pedidoValidator.js';
import { transitionEstado } from '../services/PedidoWorkflow.js';
import RealtimeService from '../realtime/RealtimeService.js';
import { resolveClienteIdentity } from '../services/ClienteIdentityService.js';
import * as ClientNotificationService from '../services/ClientNotificationService.js';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 10, includeDeleted } = req.query as any;
    const onlyVisible = String(includeDeleted || 'false').toLowerCase() !== 'true';
    const where: any = onlyVisible ? { eliminado: false } : {};
    const pedidos = await prisma.pedidos.findMany({
      where,
      include: { cliente: true, responsable: { include: { usuario: { select: { id: true, nombre: true, email: true, telefono: true, rol: true } } } } },
      orderBy: { fecha_actualizacion: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    const total = await prisma.pedidos.count({ where });
    return success(res, { pedidos, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

export const listarDelCliente = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 10 } = req.query as any;
    const user = (req as any).user as { id: number; role?: string } | undefined;
    if (!user) return fail(res, 'AUTH_ERROR', 'No autenticado', 401);
    const { profile, clienteId } = await resolveClienteIdentity(Number(user.id));
    if (!profile) return fail(res, 'AUTH_ERROR', 'Usuario no encontrado', 401);

    if (!clienteId) {
      return fail(res, 'AUTH_ERROR', 'Solo clientes pueden acceder a sus pedidos', 403);
    }

    const where = { eliminado: false, cliente_id: clienteId };
    const pedidos = await prisma.pedidos.findMany({
      where,
      include: { cliente: true, responsable: { include: { usuario: { select: { id: true, nombre: true, email: true, telefono: true, rol: true } } } } },
      orderBy: { fecha_actualizacion: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    const total = await prisma.pedidos.count({ where });
    return success(res, { pedidos, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const pedido = await prisma.pedidos.findUnique({ where: { id }, include: { cliente: true, responsable: { include: { usuario: { select: { id: true, nombre: true, email: true, telefono: true, rol: true } } } }, asignaciones: true, tiempos: true } });
    if (!pedido) return fail(res, 'NOT_FOUND', 'Pedido no encontrado', 404);
    // Ocultar eliminados salvo que lo pidan explícitamente
    const { includeDeleted } = req.query as any;
    const onlyVisible = String(includeDeleted || 'false').toLowerCase() !== 'true';
    if (onlyVisible && (pedido as any).eliminado) return fail(res, 'NOT_FOUND', 'Pedido no encontrado', 404);
    return success(res, pedido);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const created = await PedidoService.createPedido(req.body);
    const pedido = await prisma.pedidos.findUnique({ where: { id: created.id }, include: { cliente: true, responsable: { include: { usuario: { select: { id: true, nombre: true, email: true, telefono: true, rol: true } } } } } });
    // Alerta para operadores: nuevo trabajo agregado
    try {
      RealtimeService.emitWebAlert(
        'TRABAJO_AGREGADO',
        `Nuevo pedido #${created.id} creado`,
        { pedidoId: created.id, prioridad: pedido?.prioridad, cliente: pedido?.cliente?.nombre }
      );
    } catch {}
    // Notificación al cliente sobre la creación del trabajo
    try {
      const clienteId = pedido?.cliente?.id ?? created.cliente_id;
      if (clienteId) {
        await ClientNotificationService.createNotification({
          pedidoId: created.id,
          clienteId,
          mensaje: 'Tu pedido fue registrado y estamos comenzando a planificarlo.',
          tipo: 'INFO',
          title: 'Pedido creado',
        });
      }
    } catch {}
    return success(res, pedido, 201);
  } catch (err: any) {
    if (err?.name === 'ZodError') return fieldsValidation(res, err.errors ?? err);
    next(err);
  }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const parsed = UpdatePedidoSchema.safeParse(req.body);
    if (!parsed.success) return fieldsValidation(res, parsed.error.flatten());
    const body = parsed.data as any;
    const data: any = {};
    if (typeof body.descripcion !== 'undefined') data.descripcion = body.descripcion;
    if (typeof body.prioridad !== 'undefined') data.prioridad = body.prioridad;
    if (typeof body.precio !== 'undefined') data.precio = body.precio;
    if (typeof body.fecha_estimada_fin !== 'undefined') data.fecha_estimada_fin = body.fecha_estimada_fin ? new Date(body.fecha_estimada_fin) : null;
    if (typeof body.estado !== 'undefined') data.estado = body.estado;
    if (typeof body.responsable_id !== 'undefined') data.responsable_id = body.responsable_id;
    if (typeof body.semaforo !== 'undefined') data.semaforo = body.semaforo;
    if (typeof body.notas !== 'undefined') data.notas = body.notas;
    if (typeof body.adjuntos !== 'undefined') data.adjuntos = body.adjuntos;

    if (Object.keys(data).length === 0) return fail(res, 'VALIDATION_ERROR', 'No hay campos para actualizar', 400);

    await prisma.pedidos.update({ where: { id }, data });
    const pedido = await prisma.pedidos.findUnique({ where: { id }, include: { cliente: true, responsable: { include: { usuario: { select: { id: true, nombre: true, email: true, telefono: true, rol: true } } } } } });
    try {
      const clienteId = pedido?.cliente?.id;
      if (clienteId) {
        const mensajes: string[] = [];
        if (typeof body.estado !== 'undefined') mensajes.push(`El estado cambió a ${body.estado}.`);
        if (typeof body.fecha_estimada_fin !== 'undefined') mensajes.push('Actualizamos la fecha estimada de entrega.');
        if (typeof body.responsable_id !== 'undefined') mensajes.push('Asignamos un nuevo responsable para tu trabajo.');
        if (typeof body.descripcion !== 'undefined') mensajes.push('Ajustamos la descripción de tu pedido.');
        if (typeof body.notas !== 'undefined') mensajes.push('Se añadieron nuevas notas a tu pedido.');
        if (typeof body.adjuntos !== 'undefined') mensajes.push('Actualizamos los archivos asociados a tu pedido.');
        const message = mensajes.length ? mensajes.join(' ') : 'Tu pedido fue actualizado.';
        await ClientNotificationService.createNotification({
          pedidoId: id,
          clienteId,
          mensaje: message,
          tipo: 'INFO',
          title: 'Pedido actualizado',
        });
      }
    } catch {}
    return success(res, pedido, 200, 'Pedido actualizado');
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    await prisma.pedidos.delete({ where: { id } });
    return success(res, null, 200, 'Pedido eliminado');
  } catch (err: any) {
    if (err?.code === 'P2025') return fail(res, 'NOT_FOUND', 'Pedido no encontrado', 404);
    if (err?.code === 'P2003') return fail(res, 'CONFLICT', 'No se puede eliminar el pedido porque tiene registros asociados.', 409);
    next(err);
  }
};

export const cambiarEstado = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { estado, note, userId } = req.body as { estado: 'PENDIENTE'|'ASIGNADO'|'EN_PROGRESO'|'QA'|'ENTREGADO'; note?: string; userId?: number };
    if (!estado) return fail(res, 'VALIDATION_ERROR', 'Debe indicar el nuevo estado', 400);
    const pedido = await transitionEstado(id, estado, { note, userId });
    return success(res, { ok: true, pedido }, 200, 'Estado actualizado');
  } catch (err) { next(err); }
};
