import { prisma } from '../prisma/client.js';
import { predictTiempoSec } from './MLService.js';
import RealtimeService from '../realtime/RealtimeService.js';
import ClientNotificationService from './ClientNotificationService.js';

export type SemaforoColor = 'VERDE' | 'AMARILLO' | 'ROJO';

// Configuración de jornada laboral (por defecto 08:00-12:30 y 14:00-18:00, lun-sáb; sábado puede ser distinto)
const WORK_DAYS = process.env.WORKDAYS || '1-6'; // 0=domingo ... 6=sábado; default lun-sab
const WORKDAY_SHIFTS_STR = process.env.WORKDAY_SHIFTS || '08:00-12:30,14:00-18:00';
const WORKDAY_SHIFTS_SAT = process.env.WORKDAY_SHIFTS_SAT; // opcional, ej. "08:00-12:00"

const parseHHMM = (v: string): { h: number; m: number } => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
  if (!m) return { h: 8, m: 0 };
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return { h, m: mm };
};

type Shift = { startMin: number; endMin: number };
const parseShifts = (raw: string): Shift[] => {
  const out: Shift[] = [];
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const [s, e] = p.split('-').map(x => (x || '').trim());
    if (!s || !e) continue;
    const sh = parseHHMM(s);
    const eh = parseHHMM(e);
    const startMin = sh.h * 60 + sh.m;
    const endMin = eh.h * 60 + eh.m;
    if (endMin > startMin) out.push({ startMin, endMin });
  }
  if (!out.length) {
    // fallback single shift 08:00-18:00
    out.push({ startMin: 8 * 60, endMin: 18 * 60 });
  }
  return out;
};

const globalShifts = parseShifts(WORKDAY_SHIFTS_STR);
const saturdayShifts = WORKDAY_SHIFTS_SAT ? parseShifts(WORKDAY_SHIFTS_SAT) : parseShifts('08:00-12:00');

const workdaysSet = (() => {
  const parts = WORK_DAYS.split(',').map(p => p.trim()).filter(Boolean);
  const set = new Set<number>();
  for (const p of parts) {
    if (p.includes('-')) {
      const [a, b] = p.split('-').map(n => Number(n));
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const start = Math.max(0, Math.min(6, a));
        const end = Math.max(0, Math.min(6, b));
        for (let d = start; d <= end; d++) set.add(d);
      }
    } else {
      const n = Number(p);
      if (Number.isFinite(n)) set.add(Math.max(0, Math.min(6, n)));
    }
  }
  if (!set.size) for (let d = 1; d <= 6; d++) set.add(d); // fallback lun-sab
  return set;
})();

function isWorkDay(d: Date) {
  return workdaysSet.has(d.getDay());
}

function getShiftsForDay(dayIdx: number): Shift[] {
  if (!workdaysSet.has(dayIdx)) return [];
  if (dayIdx === 6 && saturdayShifts.length) return saturdayShifts; // sábado
  return globalShifts;
}

/**
 * Calcula segundos laborables entre dos fechas, considerando jornada (múltiples tramos) y días hábiles.
 * No asume 24/7 para evitar sobreestimar atraso/ETA. Usa la configuración global.
 */
export function businessSecondsBetween(start: Date, end: Date): number {
  if (!start || !end || end <= start) return 0;
  let total = 0;
  let cursor = new Date(start);
  let guard = 0;

  while (cursor < end && guard < 370) { // guarda de ~1 año para evitar loops
    const shifts = getShiftsForDay(cursor.getDay());
    if (shifts.length) {
      const dayStart = new Date(cursor);
      dayStart.setHours(0, 0, 0, 0);
      for (const sh of shifts) {
        const wStart = new Date(dayStart.getTime() + sh.startMin * 60000);
        const wEnd = new Date(dayStart.getTime() + sh.endMin * 60000);
        const from = cursor > wStart ? cursor : wStart;
        const to = end < wEnd ? end : wEnd;
        if (to > from) total += Math.round((to.getTime() - from.getTime()) / 1000);
      }
    }
    // siguiente día al inicio de la primera jornada
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
    const nextShifts = getShiftsForDay(cursor.getDay());
    const first = nextShifts.length ? nextShifts[0] : globalShifts[0];
    cursor.setHours(Math.floor(first.startMin / 60), first.startMin % 60, 0, 0);
    guard++;
  }
  return total;
}

function getThresholds(prioridad: 'ALTA'|'MEDIA'|'BAJA'): { yellow: number; red: number } {
  const baseYellow = Number(process.env.SEMAFORO_RATIO_YELLOW || 0.7);
  const baseRed = Number(process.env.SEMAFORO_RATIO_RED || 1.0);
  if (prioridad === 'ALTA') {
    const y = Number(process.env.SEMAFORO_RATIO_YELLOW_HIGH || 0.6);
    const r = Number(process.env.SEMAFORO_RATIO_RED_HIGH || 0.9);
    return { yellow: y, red: r };
  }
  return { yellow: baseYellow, red: baseRed };
}

export async function getTiempoRealSec(pedidoId: number): Promise<number> {
  const now = Date.now();
  const registros = await prisma.tiempos.findMany({
    where: { pedido_id: pedidoId },
    orderBy: { id: 'asc' },
    select: { duracion_sec: true, estado: true, inicio: true }
  });
  const cerrados = registros.filter(r => r.estado === 'CERRADO' && typeof r.duracion_sec === 'number').reduce((a, b) => a + (b.duracion_sec || 0), 0);
  const abierto = registros.find(r => r.estado === 'ABIERTO');
  const abiertoSec = abierto?.inicio ? Math.max(0, Math.round((now - new Date(abierto.inicio).getTime()) / 1000)) : 0;
  return cerrados + abiertoSec;
}

export async function computeSemaforoForPedido(pedidoId: number): Promise<{ color: SemaforoColor; tRealSec: number; tEstimadoSec: number; slackSec: number; ratio: number }>
{
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, select: { fecha_estimada_fin: true, prioridad: true, responsable_id: true } });
  if (!pedido || !pedido.fecha_estimada_fin) {
    return { color: 'VERDE', tRealSec: 0, tEstimadoSec: 0, slackSec: Number.MAX_SAFE_INTEGER, ratio: 0 };
  }

  const tRealSec = await getTiempoRealSec(pedidoId);
  const responsableId = pedido.responsable_id ?? 0;
  const tEstimadoSec = await predictTiempoSec(pedidoId, responsableId);
  const tRestanteSec = Math.max(0, tEstimadoSec - tRealSec);
  const slackSec = businessSecondsBetween(new Date(), new Date(pedido.fecha_estimada_fin));
  const ratio = slackSec > 0 ? (tRestanteSec / slackSec) : Number.POSITIVE_INFINITY;

  // Nueva regla: ROJO si ya no alcanza el tiempo (slack <= 0 o tRestante >= slack).
  if (slackSec <= 0 || tRestanteSec >= slackSec) {
    return { color: 'ROJO', tRealSec, tEstimadoSec, slackSec, ratio };
  }

  // AMARILLO como advertencia cuando el remanente consume gran parte del margen (por defecto 80% o env).
  const warnRatio = Number(process.env.SEMAFORO_RATIO_YELLOW ?? getThresholds(pedido.prioridad as any).yellow ?? 0.8);
  const color: SemaforoColor = ratio >= warnRatio ? 'AMARILLO' : 'VERDE';
  return { color, tRealSec, tEstimadoSec, slackSec, ratio };
}

export async function applyAndEmitSemaforo(pedidoId: number) {
  const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, include: { cliente: true } });
  if (!pedido) return { changed: false };
  const { color, tRealSec, tEstimadoSec, slackSec, ratio } = await computeSemaforoForPedido(pedidoId);
  const prev = pedido.semaforo as SemaforoColor;
  if (prev !== color) {
    await prisma.pedidos.update({ where: { id: pedidoId }, data: { semaforo: color } }).catch(() => {});
    try {
      RealtimeService.emitToOperators('kanban:semaforo-changed', { pedidoId, semaforo: color, tRealSec, tEstimadoSec, slackSec, ratio });
      if (color === 'ROJO') {
        RealtimeService.emitWebAlert('RETRASO', `Pedido #${pedidoId} en riesgo (ROJO)`, { pedidoId, ratio });
        // Notificación al cliente (throttle por DB + SSE ya tienen anti-spam)
        try {
          const cutoff = new Date(Date.now() - 30 * 60 * 1000);
          const recent = await prisma.notificaciones.findFirst({
            where: { pedido_id: pedidoId, tipo: 'ALERTA', fecha_creacion: { gte: cutoff } },
            orderBy: { id: 'desc' }
          });
          if (!recent) {
            await ClientNotificationService.createNotification({
              pedidoId,
              clienteId: pedido.cliente_id,
              mensaje: 'Tu pedido podria retrasarse. Estamos ajustando la planificacion.',
              tipo: 'ALERTA',
              title: 'Riesgo de retraso',
            });
          }
        } catch {}
      }
    } catch {}
    return { changed: true, prev, color, tRealSec, tEstimadoSec, slackSec, ratio };
  }
  return { changed: false, prev, color, tRealSec, tEstimadoSec, slackSec, ratio } as any;
}

export default { computeSemaforoForPedido, applyAndEmitSemaforo, getTiempoRealSec };

