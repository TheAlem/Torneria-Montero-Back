import type { Request, Response, NextFunction  } from "express";
import { prisma } from '../prisma/client.js';
import { success } from '../utils/response.js';

export const semanal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const trabajos = await prisma.pedidos.findMany({ where: { fecha_inicio: { gte: lastWeek } }, include: { cliente: true, responsable: true } });
    const resumen = trabajos.reduce((acc: any, t: any) => { acc[t.estado] = (acc[t.estado] || 0) + 1; return acc; }, {});
    const reporte = { periodo: 'semanal', fechaGeneracion: new Date(), datos: { total: trabajos.length, porEstado: resumen, trabajos } };
    return success(res, reporte);
  } catch (err) { next(err); }
};

export const mensual = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    const trabajos = await prisma.pedidos.findMany({ where: { fecha_inicio: { gte: lastMonth } }, include: { cliente: true, responsable: true } });
    const resumen = trabajos.reduce((acc: any, t: any) => { acc[t.estado] = (acc[t.estado] || 0) + 1; return acc; }, {});
    const reporte = { periodo: 'mensual', fechaGeneracion: new Date(), datos: { total: trabajos.length, porEstado: resumen, trabajos } };
    return success(res, reporte);
  } catch (err) { next(err); }
};

// Reporte/Historico de alertas para la web (operadores)
export const alertas = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '50', since } = req.query as { limit?: string; since?: string };
    const take = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
    const where: any = {};
    if (since) {
      const d = new Date(since);
      if (!isNaN(d.getTime())) where.fecha = { gte: d };
    }
    const rows = await prisma.alertas.findMany({
      where,
      include: { pedido: { select: { id: true, fecha_estimada_fin: true, cliente: { select: { nombre: true } } } } },
      orderBy: { fecha: 'desc' },
      take,
    });

    const now = new Date();
    const titleByType: Record<string, string> = {
      'RETRASO': 'Pedido Retrasado',
      'PROXIMA_ENTREGA': 'Próxima Entrega',
      'ENTREGA_COMPLETADA': 'Entrega Completada',
      'ASIGNACION': 'Pedido Asignado',
      'TRABAJO_AGREGADO': 'Nuevo Pedido',
    };

    const items = rows.map((a) => {
      const pedidoId = a.pedido?.id ?? null;
      const cliente = a.pedido?.cliente?.nombre ?? null;
      const code = pedidoId ? `P-${pedidoId}` : '';
      let message = a.descripcion ?? '';

      // Mensajes enriquecidos según tipo
      if (a.tipo === 'RETRASO') {
        const due = a.pedido?.fecha_estimada_fin ? new Date(a.pedido.fecha_estimada_fin) : null;
        if (due && now.getTime() > due.getTime()) {
          const days = Math.max(1, Math.ceil((now.getTime() - due.getTime()) / (24 * 3600 * 1000)));
          message = `Pedido ${code} - ${cliente ?? ''} - ${days} días de retraso`;
        } else {
          message = message || `Pedido ${code} - ${cliente ?? ''} - En riesgo de retraso`;
        }
      } else if (a.tipo === 'PROXIMA_ENTREGA') {
        const due = a.pedido?.fecha_estimada_fin ? new Date(a.pedido.fecha_estimada_fin) : null;
        if (due && due.getTime() > now.getTime()) {
          const diffH = Math.ceil((due.getTime() - now.getTime()) / (3600 * 1000));
          const text = diffH <= 24 ? `Entrega en ${diffH} horas` : `Entrega en ${Math.ceil(diffH / 24)} días`;
          message = `Pedido ${code} - ${cliente ?? ''} - ${text}`;
        } else {
          message = message || `Pedido ${code} - ${cliente ?? ''}`;
        }
      } else if (a.tipo === 'ENTREGA_COMPLETADA') {
        message = message || `Pedido ${code} - ${cliente ?? ''} completado`;
      } else if (a.tipo === 'ASIGNACION') {
        message = message || `Pedido ${code} - ${cliente ?? ''} asignado`;
      } else if (a.tipo === 'TRABAJO_AGREGADO') {
        message = message || `Pedido ${code} - ${cliente ?? ''} creado`;
      }

      return {
        id: a.id,
        type: a.tipo,
        title: titleByType[a.tipo ?? ''] || 'Notificación',
        message,
        pedidoId,
        clienteNombre: cliente,
        ts: a.fecha,
        severidad: a.severidad,
        atendida: a.atendida,
      };
    });

    return success(res, { items });
  } catch (err) { next(err); }
};
