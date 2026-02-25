import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';
import * as PedidoService from '../services/PedidoService.js';
import { success, fail, fieldsValidation } from '../utils/response.js';
import { CreatePedidoSchema, UpdatePedidoSchema } from '../validators/pedidoValidator.js';
import { transitionEstado } from '../services/PedidoWorkflow.js';
import RealtimeService from '../realtime/RealtimeService.js';
import { resolveClienteIdentity } from '../services/ClienteIdentityService.js';
import * as ClientNotificationService from '../services/ClientNotificationService.js';
import { recalcPedidoEstimate } from '../services/MLService.js';
import { buildDetalleFromPayload, buildNotasFromDetalle, normalizeDetalleTrabajo } from '../services/PedidoDetails.js';
import { scheduleEvaluatePedidos } from '../services/KanbanMonitorService.js';

const enrichPedidoDetalle = (pedido: any) => {
  const detalle = normalizeDetalleTrabajo(pedido?.detalle_trabajo);
  return { ...(pedido as any), ...detalle, detalle_trabajo: detalle };
};

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
    const pedidosOut = pedidos.map(enrichPedidoDetalle);
    return success(res, { pedidos: pedidosOut, total, page: Number(page), limit: Number(limit) });
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
    const pedidosOut = pedidos.map(enrichPedidoDetalle);
    return success(res, { pedidos: pedidosOut, total, page: Number(page), limit: Number(limit) });
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
    const etaAlertTypes = ['ETA_INICIAL', 'ETA_ACTUALIZADA', 'ETA_ACTUALIZADA_MANUAL', 'ETA_SUGERIDA', 'ENTREGA_COMPLETADA'] as const;
    const etaAlerts = await prisma.alertas.findMany({
      where: { pedido_id: id, tipo: { in: etaAlertTypes as any } },
      orderBy: { fecha: 'asc' },
      take: 200,
      select: { id: true, tipo: true, severidad: true, descripcion: true, fecha: true, atendida: true },
    });
    const extractIsoFromText = (text?: string | null): string | null => {
      if (!text) return null;
      const m = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
      return m?.[0] ?? null;
    };
    const etaInicialEvent = etaAlerts.find(a => a.tipo === 'ETA_INICIAL');
    const etaInicialIso = extractIsoFromText(etaInicialEvent?.descripcion) ?? (pedido.fecha_estimada_fin ? new Date(pedido.fecha_estimada_fin).toISOString() : null);
    const etaTracking = {
      fecha_estimada_inicial: etaInicialIso,
      fecha_estimada_actual: pedido.fecha_estimada_fin ? new Date(pedido.fecha_estimada_fin).toISOString() : null,
      fecha_entrega_real: pedido.estado === 'ENTREGADO' ? new Date(pedido.fecha_actualizacion).toISOString() : null,
      cambios: etaAlerts.map(a => ({
        id: a.id,
        tipo: a.tipo,
        fecha: a.fecha,
        severidad: a.severidad,
        descripcion: a.descripcion ?? null,
        atendida: a.atendida,
      })),
      auto_update_eta_enabled: String(process.env.ETA_AUTO_UPDATE_ENABLED ?? 'false').toLowerCase() === 'true',
    };
    const pedidoOut = enrichPedidoDetalle(pedido as any);
    return success(res, { ...pedidoOut, eta_tracking: etaTracking });
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreatePedidoSchema.safeParse(req.body);
    if (!parsed.success) return fieldsValidation(res, parsed.error.flatten());
    const created = await PedidoService.createPedido(parsed.data);
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
    return success(res, enrichPedidoDetalle(pedido as any), 201);
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
    let needsRecalc = false;
    const touchedFechaEstimada = typeof body.fecha_estimada_fin !== 'undefined';
    const user = (req as any).user as { id?: number; role?: string } | undefined;
    const before = await prisma.pedidos.findUnique({
      where: { id },
      select: { id: true, fecha_estimada_fin: true, estado: true, tiempo_estimado_sec: true },
    });
    if (!before) return fail(res, 'NOT_FOUND', 'Pedido no encontrado', 404);
    if (typeof body.titulo !== 'undefined') data.titulo = body.titulo;
    if (typeof body.descripcion !== 'undefined') data.descripcion = body.descripcion;
    if (typeof body.prioridad !== 'undefined') data.prioridad = body.prioridad;
    if (typeof body.precio !== 'undefined') data.precio = body.precio;
    if (typeof body.fecha_estimada_fin !== 'undefined') data.fecha_estimada_fin = body.fecha_estimada_fin ? new Date(body.fecha_estimada_fin) : null;
    if (typeof body.pagado !== 'undefined') data.pagado = body.pagado;
    if (typeof body.estado !== 'undefined') data.estado = body.estado;
    if (typeof body.responsable_id !== 'undefined') data.responsable_id = body.responsable_id;
    if (typeof body.semaforo !== 'undefined') data.semaforo = body.semaforo;
    if (typeof body.notas !== 'undefined') data.notas = body.notas;
    if (typeof body.adjuntos !== 'undefined') data.adjuntos = body.adjuntos;
    const { detalle, hasDetalle } = buildDetalleFromPayload(body);
    if (hasDetalle) {
      data.detalle_trabajo = detalle;
      data.notas = buildNotasFromDetalle(detalle);
    }
    if (typeof body.titulo !== 'undefined' || typeof body.descripcion !== 'undefined' || typeof body.prioridad !== 'undefined' || typeof body.precio !== 'undefined' || typeof body.responsable_id !== 'undefined') {
      needsRecalc = true;
    }

    if (Object.keys(data).length === 0) return fail(res, 'VALIDATION_ERROR', 'No hay campos para actualizar', 400);

    await prisma.pedidos.update({ where: { id }, data });
    const pedido = await prisma.pedidos.findUnique({ where: { id }, include: { cliente: true, responsable: { include: { usuario: { select: { id: true, nombre: true, email: true, telefono: true, rol: true } } } } } });
    if (needsRecalc && pedido) {
      try {
        await recalcPedidoEstimate(id, { trabajadorId: pedido.responsable_id ?? null, updateFechaEstimada: !touchedFechaEstimada });
      } catch {}
    }
    const shouldEvaluate = needsRecalc
      || typeof body.estado !== 'undefined'
      || typeof body.responsable_id !== 'undefined'
      || typeof body.fecha_estimada_fin !== 'undefined';
    if (shouldEvaluate) {
      scheduleEvaluatePedidos(id);
    }
    if (touchedFechaEstimada) {
      const oldDue = before.fecha_estimada_fin ? new Date(before.fecha_estimada_fin) : null;
      const newDue = pedido?.fecha_estimada_fin ? new Date(pedido.fecha_estimada_fin) : null;
      const changed =
        (!!oldDue !== !!newDue)
        || (oldDue && newDue && oldDue.getTime() !== newDue.getTime());
      if (changed) {
        const oldTxt = oldDue ? oldDue.toISOString() : 'SIN_FECHA';
        const newTxt = newDue ? newDue.toISOString() : 'SIN_FECHA';
        const actor = user?.id ? ` por usuario #${user.id}` : '';
        try {
          RealtimeService.emitWebAlert(
            'ETA_ACTUALIZADA_MANUAL',
            `Pedido #${id} ETA manual: ${oldTxt} -> ${newTxt}${actor}`,
            {
              pedidoId: id,
              oldDue: oldDue ? oldDue.toISOString() : null,
              newDue: newDue ? newDue.toISOString() : null,
              actorUserId: user?.id ?? null,
              actorRole: user?.role ?? null,
              source: 'manual_update',
            }
          );
        } catch {}
      }
    }
    try {
      const clienteId = pedido?.cliente?.id;
      if (clienteId) {
        const mensajes: string[] = [];
        if (typeof body.estado !== 'undefined') mensajes.push(`El estado cambio a ${body.estado}.`);
        if (typeof body.fecha_estimada_fin !== 'undefined') mensajes.push('Actualizamos la fecha estimada de entrega.');
        if (typeof body.responsable_id !== 'undefined') mensajes.push('Asignamos un nuevo responsable para tu trabajo.');
        if (typeof body.titulo !== 'undefined') mensajes.push('Actualizamos el titulo de tu pedido.');
        if (typeof body.descripcion !== 'undefined') mensajes.push('Ajustamos la descripcion de tu pedido.');
        if (typeof body.notas !== 'undefined') mensajes.push('Se anadieron nuevas notas a tu pedido.');
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
    return success(res, enrichPedidoDetalle(pedido as any), 200, 'Pedido actualizado');
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
  } catch (err: any) {
    if (err?.code === 'INVALID_TRANSITION') {
      return fail(res, 'INVALID_TRANSITION', err.message || 'Transición no permitida', err.status || 400, { allowed: err.allowed || [] });
    }
    next(err);
  }
};
