import type { Request, Response, NextFunction  } from "express";
import { prisma } from '../prisma/client.js';
import { success } from '../utils/response.js';
import { businessSecondsBetween } from '../services/SemaforoService.js';

type PedidoLite = {
  id: number;
  titulo: string | null;
  descripcion: string | null;
  estado: string;
  prioridad: string;
  semaforo: string | null;
  fecha_inicio: Date | null;
  fecha_actualizacion: Date | null;
  fecha_estimada_fin: Date | null;
  tiempo_estimado_sec: number | null;
  tiempo_real_sec: number | null;
  cliente_id: number | null;
  responsable_id: number | null;
  precio: any;
  pagado: boolean;
  notas: string | null;
  cliente: { nombre: string } | null;
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

const pad2 = (value: number) => String(value).padStart(2, '0');
const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const toISO = (d: Date | null) => {
  if (!d) return null;
  const date = new Date(d);
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  const tzMinutes = -date.getTimezoneOffset();
  const tzSign = tzMinutes >= 0 ? '+' : '-';
  const tzAbs = Math.abs(tzMinutes);
  const tzHours = pad2(Math.floor(tzAbs / 60));
  const tzMins = pad2(tzAbs % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${tzSign}${tzHours}:${tzMins}`;
};

const buildPeriodoLabel = (periodo: 'semanal' | 'mensual', rango: { from: Date; to: Date }) => {
  const from = new Date(rango.from);
  const to = new Date(rango.to);
  if (periodo === 'semanal') {
    const sameYear = from.getFullYear() === to.getFullYear();
    const sameMonth = sameYear && from.getMonth() === to.getMonth();
    if (sameMonth) {
      return `Semana del ${from.getDate()} al ${to.getDate()} de ${MONTHS_ES[to.getMonth()]} de ${to.getFullYear()}`;
    }
    if (sameYear) {
      return `Semana del ${from.getDate()} de ${MONTHS_ES[from.getMonth()]} al ${to.getDate()} de ${MONTHS_ES[to.getMonth()]} de ${to.getFullYear()}`;
    }
    return `Semana del ${from.getDate()} de ${MONTHS_ES[from.getMonth()]} de ${from.getFullYear()} al ${to.getDate()} de ${MONTHS_ES[to.getMonth()]} de ${to.getFullYear()}`;
  }
  return `Mes de ${MONTHS_ES[to.getMonth()]} de ${to.getFullYear()}`;
};

const buildPedidoCode = (id: number) => `P-${String(id).padStart(3, '0')}`;

const toNumber = (val: any) => {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const startOfWeek = (d: Date) => {
  const base = startOfDay(d);
  const mondayBased = (base.getDay() + 6) % 7; // Monday=0 ... Sunday=6
  base.setDate(base.getDate() - mondayBased);
  return base;
};

const endOfWeek = (d: Date) => {
  const base = startOfWeek(d);
  base.setDate(base.getDate() + 6);
  return endOfDay(base);
};

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

const parseDateParam = (value?: string) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const resolveReportRange = (
  periodo: 'semanal' | 'mensual',
  query: { from?: string; to?: string },
  defaults: { from: Date; to: Date }
) => {
  const parsedFrom = parseDateParam(query.from);
  const parsedTo = parseDateParam(query.to);

  let from = parsedFrom ?? defaults.from;
  let to = parsedTo ?? defaults.to;

  if (periodo === 'semanal') {
    if (parsedFrom && !parsedTo) {
      from = startOfWeek(parsedFrom);
      to = endOfWeek(parsedFrom);
    } else if (!parsedFrom && parsedTo) {
      from = startOfWeek(parsedTo);
      to = endOfWeek(parsedTo);
    } else {
      from = startOfDay(from);
      to = endOfDay(to);
    }
  } else {
    if (parsedFrom && !parsedTo) {
      from = startOfMonth(parsedFrom);
      to = endOfMonth(parsedFrom);
    } else if (!parsedFrom && parsedTo) {
      from = startOfMonth(parsedTo);
      to = endOfMonth(parsedTo);
    } else {
      from = startOfDay(from);
      to = endOfDay(to);
    }
  }

  if (from.getTime() > to.getTime()) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  return { from, to };
};

const buildReportWhere = (range: { from: Date; to: Date }) => {
  const between = { gte: range.from, lte: range.to };
  return {
    OR: [
      { fecha_inicio: between },
      { fecha_actualizacion: between },
      { fecha_estimada_fin: between },
    ],
  };
};

const REPORT_CACHE_TTL_MS = Math.max(1000, Number(process.env.REPORT_CACHE_TTL_MS ?? 20000));
const REPORT_CACHE_MAX_ENTRIES = 120;
const reportCache = new Map<string, { expiresAt: number; value: any }>();

const getReportCacheKey = (periodo: 'semanal' | 'mensual', from: Date, to: Date) =>
  `${periodo}:${from.getTime()}:${to.getTime()}`;

const getCachedReport = (key: string) => {
  const entry = reportCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    reportCache.delete(key);
    return null;
  }
  return entry.value;
};

const setCachedReport = (key: string, value: any) => {
  const now = Date.now();
  for (const [k, v] of reportCache.entries()) {
    if (v.expiresAt <= now) reportCache.delete(k);
  }
  if (reportCache.size >= REPORT_CACHE_MAX_ENTRIES) {
    const firstKey = reportCache.keys().next().value as string | undefined;
    if (firstKey) reportCache.delete(firstKey);
  }
  reportCache.set(key, { expiresAt: now + REPORT_CACHE_TTL_MS, value });
};

function buildReporte(periodo: 'semanal' | 'mensual', trabajos: PedidoLite[], rango: { from: Date; to: Date }) {
  const total = trabajos.length;
  const porEstado = countBy(trabajos, 'estado');
  const porPrioridad = countBy(trabajos, 'prioridad');
  const porSemaforo = countBy(trabajos, 'semaforo');

  // "Ahora" operativo: evita marcar atraso futuro cuando el rango termina en una fecha posterior.
  const now = new Date(Math.min(Date.now(), rango.to.getTime()));
  const entregados = trabajos.filter(t => t.estado === 'ENTREGADO');
  const enProgreso = trabajos.filter(t => t.estado === 'EN_PROGRESO');
  const pendientes = trabajos.filter(t => t.estado === 'PENDIENTE');

  // Ganancia estimada: suma de precios del periodo (entregados o pagados)
  const gananciaTotal = trabajos.reduce((acc, t) => {
    if (t.pagado || t.estado === 'ENTREGADO') {
      return acc + (toNumber(t.precio) ?? 0);
    }
    return acc;
  }, 0);

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
        titulo: t.titulo ?? null,
        cliente: t.cliente?.nombre ?? null,
        responsable: t.responsable?.usuario?.nombre ?? null,
        prioridad: t.prioridad,
        estado: t.estado,
        semaforo: t.semaforo,
        fecha_inicio: toISO(t.fecha_inicio),
        fecha_estimada_fin: toISO(t.fecha_estimada_fin),
        fecha_entrega: toISO(t.fecha_actualizacion),
        tiempo_estimado_sec: t.tiempo_estimado_sec,
        tiempo_real_sec: t.tiempo_real_sec,
        atraso_sec: atrasoSec,
      };
    });

  const windowDays = Math.max(1, Math.ceil((rango.to.getTime() - rango.from.getTime()) / (24 * 3600 * 1000)));

  const trabajosPayload = trabajos.map(t => {
    const price = toNumber(t.precio);
    const priceRaw = t.precio == null ? null : String(t.precio);
    const estadoPago = t.pagado ? 'PAGADO' : 'PENDIENTE';
    const responsableNombre = t.responsable?.usuario?.nombre ?? null;
    const clienteNombre = t.cliente?.nombre ?? null;
    const responsableId = t.responsable?.id ?? t.responsable_id ?? null;
    return {
      id: t.id,
      codigo: buildPedidoCode(t.id),
      titulo: t.titulo ?? '',
      descripcion: (t as any).descripcion ?? '',
      cliente: { nombre: clienteNombre },
      responsable: {
        id: responsableId,
        nombre: responsableNombre,
      },
      responsable_id: t.responsable_id,
      estado: t.estado,
      prioridad: t.prioridad,
      semaforo: t.semaforo,
      fecha_inicio: toISO(t.fecha_inicio),
      fecha_estimada_fin: toISO(t.fecha_estimada_fin),
      fecha_actualizacion: toISO(t.fecha_actualizacion),
      tiempo_estimado_sec: t.tiempo_estimado_sec,
      tiempo_real_sec: t.tiempo_real_sec,
      cliente_id: t.cliente_id,
      precio: priceRaw,
      monto: price,
      importe: price,
      estado_pago: estadoPago,
      paymentStatus: estadoPago,
      notas: t.notas ?? null,
    };
  });

  const periodoLabel = buildPeriodoLabel(periodo, rango);

  return {
    periodo: periodoLabel,
    periodoCodigo: periodo,
    fechaGeneracion: toISO(new Date()),
    rango: { from: toISO(rango.from), to: toISO(rango.to) },
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
      trabajos: trabajosPayload,
      gananciaTotal,
    },
  };
}

export const semanal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const defaults = { from: startOfWeek(now), to: endOfWeek(now) };
    const { from, to } = resolveReportRange('semanal', req.query as { from?: string; to?: string }, defaults);
    const cacheKey = getReportCacheKey('semanal', from, to);
    const cached = getCachedReport(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', `private, max-age=${Math.floor(REPORT_CACHE_TTL_MS / 1000)}`);
      res.setHeader('X-Report-Cache', 'HIT');
      return success(res, cached);
    }
    const trabajos = await prisma.pedidos.findMany({
      where: buildReportWhere({ from, to }),
      select: {
        id: true,
        titulo: true,
        descripcion: true,
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
        precio: true,
        pagado: true,
        notas: true,
        cliente: { select: { nombre: true } },
        responsable: { select: { id: true, usuario: { select: { nombre: true } } } },
      },
    }) as PedidoLite[];
    const reporte = buildReporte('semanal', trabajos, { from, to });
    setCachedReport(cacheKey, reporte);
    res.setHeader('Cache-Control', `private, max-age=${Math.floor(REPORT_CACHE_TTL_MS / 1000)}`);
    res.setHeader('X-Report-Cache', 'MISS');
    return success(res, reporte);
  } catch (err) { next(err); }
};

export const mensual = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const defaults = { from: startOfMonth(now), to: endOfMonth(now) };
    const { from, to } = resolveReportRange('mensual', req.query as { from?: string; to?: string }, defaults);
    const cacheKey = getReportCacheKey('mensual', from, to);
    const cached = getCachedReport(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', `private, max-age=${Math.floor(REPORT_CACHE_TTL_MS / 1000)}`);
      res.setHeader('X-Report-Cache', 'HIT');
      return success(res, cached);
    }
    const trabajos = await prisma.pedidos.findMany({
      where: buildReportWhere({ from, to }),
      select: {
        id: true,
        titulo: true,
        descripcion: true,
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
        precio: true,
        pagado: true,
        notas: true,
        cliente: { select: { nombre: true } },
        responsable: { select: { id: true, usuario: { select: { nombre: true } } } },
      },
    }) as PedidoLite[];
    const reporte = buildReporte('mensual', trabajos, { from, to });
    setCachedReport(cacheKey, reporte);
    res.setHeader('Cache-Control', `private, max-age=${Math.floor(REPORT_CACHE_TTL_MS / 1000)}`);
    res.setHeader('X-Report-Cache', 'MISS');
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
      'ETA_INICIAL': 'ETA Inicial',
      'ETA_ACTUALIZADA': 'ETA Actualizada',
      'ETA_ACTUALIZADA_MANUAL': 'ETA Actualizada Manualmente',
      'ETA_SUGERIDA': 'Sugerencia de ETA',
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
          const lateSec = businessSecondsBetween(due, nowDate);
          const days = Math.max(1, Math.ceil(lateSec / (8 * 3600)));
          message = `Pedido ${code} - ${cliente ?? ''} - ${days} días de retraso`;
        } else {
          message = message || `Pedido ${code} - ${cliente ?? ''} - En riesgo de retraso`;
        }
      } else if (a.tipo === 'PROXIMA_ENTREGA') {
        const due = a.pedido?.fecha_estimada_fin ? new Date(a.pedido.fecha_estimada_fin) : null;
        if (due && due.getTime() > nowDate.getTime()) {
          const diffH = Math.ceil(businessSecondsBetween(nowDate, due) / 3600);
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
