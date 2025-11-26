import type { Request, Response, NextFunction  } from "express";
import { prisma } from '../prisma/client.js';
import { success } from '../utils/response.js';

type PedidoLite = {
  id: number;
  estado: string;
  prioridad: string;
  semaforo: string | null;
  fecha_inicio: Date | null;
  fecha_actualizacion: Date | null;
  fecha_estimada_fin: Date | null;
  tiempo_estimado_sec: number | null;
  tiempo_real_sec: number | null;
  cliente_id: number;
  responsable_id: number | null;
  cliente: { id: number; nombre: string } | null;
  responsable: { id: number; usuario: { nombre: string | null } | null } | null;
};

const countBy = (arr: any[], key: string) => {
  const out: Record<string, number> = {};
  for (const item of arr) {
    const k = (item as any)[key] ?? 'DESCONOCIDO';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
};

const median = (arr: number[]) => {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

function buildReporte(periodo: 'semanal' | 'mensual', trabajos: PedidoLite[], rango: { from: Date; to: Date }) {
  const total = trabajos.length;
  const porEstado = countBy(trabajos, 'estado');
  const porPrioridad = countBy(trabajos, 'prioridad');
  const porSemaforo = countBy(trabajos, 'semaforo');

  const now = rango.to;
  const entregados = trabajos.filter(t => t.estado === 'ENTREGADO');
  const enProgreso = trabajos.filter(t => t.estado === 'EN_PROGRESO');
  const pendientes = trabajos.filter(t => t.estado === 'PENDIENTE');

  const leadTimesSec = entregados
    .map(t => {
      if (!t.fecha_inicio || !t.fecha_actualizacion) return null;
      return Math.max(1, Math.round((new Date(t.fecha_actualizacion).getTime() - new Date(t.fecha_inicio).getTime()) / 1000));
    })
    .filter((v): v is number => Number.isFinite(v));

  const desvios = entregados
    .map(t => {
      const est = Number(t.tiempo_estimado_sec);
      const real = Number(t.tiempo_real_sec);
      if (!Number.isFinite(est) || !Number.isFinite(real)) return null;
      return { est, real };
    })
    .filter((v): v is { est: number; real: number } => !!v);

  const maeEstimVsReal = desvios.length
    ? desvios.reduce((acc, pr) => acc + Math.abs(pr.real - pr.est), 0) / desvios.length
    : null;
  const promedioEstimadoSec = avg(desvios.map(d => d.est));
  const promedioRealSec = avg(desvios.map(d => d.real));

  // SLA entregados: on-time vs tarde
  const slaDeliveredOnTime = entregados.filter(t => {
    if (!t.fecha_estimada_fin || !t.fecha_actualizacion) return false;
    return new Date(t.fecha_actualizacion).getTime() <= new Date(t.fecha_estimada_fin).getTime();
  });
  const slaDeliveredLate = entregados.filter(t => {
    if (!t.fecha_estimada_fin || !t.fecha_actualizacion) return false;
    return new Date(t.fecha_actualizacion).getTime() > new Date(t.fecha_estimada_fin).getTime();
  });
  const slaRate = (slaDeliveredOnTime.length + slaDeliveredLate.length)
    ? slaDeliveredOnTime.length / (slaDeliveredOnTime.length + slaDeliveredLate.length)
    : null;

  // Atrasados abiertos (riesgo)
  const atrasadosAbiertos = trabajos.filter(t => {
    if (t.estado === 'ENTREGADO') return false;
    if (!t.fecha_estimada_fin) return false;
    return now.getTime() > new Date(t.fecha_estimada_fin).getTime();
  });

  // Top responsables/clientes
  const aggregateBy = (key: 'responsable_id' | 'cliente_id') => {
    const map = new Map<number, { id: number; nombre: string | null; total: number; completados: number; enProceso: number; atrasados: number }>();
    for (const t of trabajos) {
      const id = (t as any)[key] as number | null;
      if (!id) continue;
      const nombre = key === 'responsable_id'
        ? t.responsable?.usuario?.nombre ?? null
        : t.cliente?.nombre ?? null;
      if (!map.has(id)) map.set(id, { id, nombre, total: 0, completados: 0, enProceso: 0, atrasados: 0 });
      const slot = map.get(id)!;
      slot.total += 1;
      if (t.estado === 'ENTREGADO') slot.completados += 1;
      if (t.estado === 'EN_PROGRESO') slot.enProceso += 1;
      const isLate = t.fecha_estimada_fin
        ? (t.estado === 'ENTREGADO'
          ? new Date(t.fecha_actualizacion ?? t.fecha_estimada_fin).getTime() > new Date(t.fecha_estimada_fin).getTime()
          : now.getTime() > new Date(t.fecha_estimada_fin).getTime())
        : false;
      if (isLate) slot.atrasados += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 10);
  };

  const topResponsables = aggregateBy('responsable_id');
  const topClientes = aggregateBy('cliente_id');

  const entregasRecientes = [...entregados]
    .sort((a, b) => new Date(b.fecha_actualizacion ?? 0).getTime() - new Date(a.fecha_actualizacion ?? 0).getTime())
    .slice(0, 10)
    .map(t => {
      const atrasoSec = Number.isFinite(t.tiempo_real_sec as any) && Number.isFinite(t.tiempo_estimado_sec as any)
        ? (t.tiempo_real_sec as number) - (t.tiempo_estimado_sec as number)
        : null;
      return {
        id: t.id,
        cliente: t.cliente?.nombre ?? null,
        responsable: t.responsable?.usuario?.nombre ?? null,
        prioridad: t.prioridad,
        estado: t.estado,
        semaforo: t.semaforo,
        fecha_inicio: t.fecha_inicio,
        fecha_estimada_fin: t.fecha_estimada_fin,
        fecha_entrega: t.fecha_actualizacion,
        tiempo_estimado_sec: t.tiempo_estimado_sec,
        tiempo_real_sec: t.tiempo_real_sec,
        atraso_sec: atrasoSec,
      };
    });

  const windowDays = Math.max(1, Math.ceil((rango.to.getTime() - rango.from.getTime()) / (24 * 3600 * 1000)));

  return {
    periodo,
    fechaGeneracion: new Date(),
    rango,
    datos: {
      total,
      porEstado,
      porPrioridad,
      porSemaforo,
      resumen: {
        completados: entregados.length,
        enProgreso: enProgreso.length,
        pendientes: pendientes.length,
        atrasadosAbiertos: atrasadosAbiertos.length,
      },
      sla: {
        onTime: slaDeliveredOnTime.length,
        late: slaDeliveredLate.length,
        rate: slaRate,
      },
      tiempos: {
        leadTimeMedSec: median(leadTimesSec) ?? null,
        leadTimeAvgSec: avg(leadTimesSec),
        promedioEstimadoSec,
        promedioRealSec,
        maeEstimVsReal,
      },
      throughputPorDia: entregados.length / windowDays,
      topResponsables,
      topClientes,
      entregasRecientes,
      trabajos,
    },
  };
}

export const semanal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const trabajos = await prisma.pedidos.findMany({
      where: { fecha_inicio: { gte: from } },
      select: {
        id: true,
        estado: true,
        prioridad: true,
        semaforo: true,
        fecha_inicio: true,
        fecha_actualizacion: true,
        fecha_estimada_fin: true,
        tiempo_estimado_sec: true,
        tiempo_real_sec: true,
        cliente_id: true,
        responsable_id: true,
        cliente: { select: { id: true, nombre: true } },
        responsable: { select: { id: true, usuario: { select: { nombre: true } } } },
      },
    }) as PedidoLite[];
    const reporte = buildReporte('semanal', trabajos, { from, to: now });
    return success(res, reporte);
  } catch (err) { next(err); }
};

export const mensual = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    const trabajos = await prisma.pedidos.findMany({
      where: { fecha_inicio: { gte: from } },
      select: {
        id: true,
        estado: true,
        prioridad: true,
        semaforo: true,
        fecha_inicio: true,
        fecha_actualizacion: true,
        fecha_estimada_fin: true,
        tiempo_estimado_sec: true,
        tiempo_real_sec: true,
        cliente_id: true,
        responsable_id: true,
        cliente: { select: { id: true, nombre: true } },
        responsable: { select: { id: true, usuario: { select: { nombre: true } } } },
      },
    }) as PedidoLite[];
    const reporte = buildReporte('mensual', trabajos, { from, to: now });
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

    const nowDate = new Date();
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
        if (due && nowDate.getTime() > due.getTime()) {
          const days = Math.max(1, Math.ceil((nowDate.getTime() - due.getTime()) / (24 * 3600 * 1000)));
          message = `Pedido ${code} - ${cliente ?? ''} - ${days} días de retraso`;
        } else {
          message = message || `Pedido ${code} - ${cliente ?? ''} - En riesgo de retraso`;
        }
      } else if (a.tipo === 'PROXIMA_ENTREGA') {
        const due = a.pedido?.fecha_estimada_fin ? new Date(a.pedido.fecha_estimada_fin) : null;
        if (due && due.getTime() > nowDate.getTime()) {
          const diffH = Math.ceil((due.getTime() - nowDate.getTime()) / (3600 * 1000));
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

    const resumen = {
      total: rows.length,
      sinAtender: rows.filter(r => !r.atendida).length,
      porTipo: rows.reduce((acc, r) => { const k = r.tipo ?? 'DESCONOCIDO'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>),
      porSeveridad: rows.reduce((acc, r) => { const k = r.severidad ?? 'DESCONOCIDO'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>),
      ultimaAlerta: rows[0]?.fecha ?? null,
    };

    return success(res, { resumen, items });
  } catch (err) { next(err); }
};
