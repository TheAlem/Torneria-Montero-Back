import type { Response } from 'express';
import { logger } from '../utils/logger.js';
import { prisma } from '../prisma/client.js';

type Stream = Response;

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  } as const;
}

function writeEvent(stream: Stream, event: string, payload: any) {
  try {
    stream.write(`event: ${event}\n`);
    stream.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (e) {
    // ignore broken pipe
  }
}

class Realtime {
  private clientStreams = new Map<number, Set<Stream>>();
  private userStreams = new Map<number, Set<Stream>>();
  private operatorStreams = new Set<Stream>();
  private clientNotifThrottle = new Map<string, number>();

  subscribeClient(clientId: number, res: Response) {
    res.writeHead(200, sseHeaders());
    res.write(`:\n\n`); // sse ping
    const set = this.clientStreams.get(clientId) ?? new Set<Stream>();
    set.add(res);
    this.clientStreams.set(clientId, set);
    logger.info({ msg: '[SSE] client subscribed', clientId, total: set.size });
    res.on('close', () => {
      set.delete(res);
      if (set.size === 0) this.clientStreams.delete(clientId);
    });
  }

  subscribeUser(userId: number, res: Response) {
    res.writeHead(200, sseHeaders());
    res.write(`:\n\n`);
    const set = this.userStreams.get(userId) ?? new Set<Stream>();
    set.add(res);
    this.userStreams.set(userId, set);
    logger.info({ msg: '[SSE] user subscribed', userId, total: set.size });
    res.on('close', () => {
      set.delete(res);
      if (set.size === 0) this.userStreams.delete(userId);
    });
  }

  subscribeOperators(res: Response) {
    res.writeHead(200, sseHeaders());
    res.write(`:\n\n`);
    this.operatorStreams.add(res);
    logger.info({ msg: '[SSE] operator subscribed', total: this.operatorStreams.size });
    res.on('close', () => {
      this.operatorStreams.delete(res);
    });
  }

  emitToClient(clientId: number, event: string, payload: any) {
    // Throttle de notificaciones duplicadas al cliente (30 min por pedido/tipo)
    try {
      if (event === 'notification:new' && payload && typeof payload === 'object') {
        const tipo = payload?.tipo;
        const pedidoId = Number(payload?.pedido_id || payload?.pedidoId);
        const clave = `${clientId}:${pedidoId || 'na'}:${tipo || 'na'}`;
        if (tipo && pedidoId) {
          const now = Date.now();
          const last = this.clientNotifThrottle.get(clave) || 0;
          const THROTTLE_MS = 30 * 60 * 1000; // 30 min
          if (now - last < THROTTLE_MS) return; // suprimir duplicado reciente
          this.clientNotifThrottle.set(clave, now);
        }
      }
    } catch {}

    const set = this.clientStreams.get(clientId);
    if (!set) return;
    for (const s of set) writeEvent(s, event, payload);
  }

  emitToUser(userId: number, event: string, payload: any) {
    const set = this.userStreams.get(userId);
    if (!set) return;
    for (const s of set) writeEvent(s, event, payload);
  }

  emitToOperators(event: string, payload: any) {
    for (const s of this.operatorStreams) writeEvent(s, event, payload);
  }

  // Helper para alertas visibles en la web (operadores/admin)
  async emitWebAlert(type: string, message: string, data?: any) {
    const now = new Date();
    const pedidoId = data?.pedidoId ? Number(data.pedidoId) : null;
    // Cooldown por tipo para evitar spam visual duplicado
    const cooldownMinMap: Record<string, number> = {
      'RETRASO': 30,           // 30 minutos para alertas de retraso
      'PROXIMA_ENTREGA': 360,  // 6 horas para proximas entregas
    };
    const cooldownMin = cooldownMinMap[type] ?? 0;

    if (cooldownMin > 0 && pedidoId) {
      try {
        const cutoff = new Date(now.getTime() - cooldownMin * 60 * 1000);
        const recent = await prisma.alertas.findFirst({
          where: { tipo: type, pedido_id: pedidoId, fecha: { gte: cutoff } },
          orderBy: { id: 'desc' },
        });
        if (recent) {
          return; // throttle: no emitir ni persistir duplicado reciente
        }
      } catch {}
    }

    const payload = { type, message, data: data ?? null, ts: now.toISOString() };
    this.emitToOperators('alert:web', payload);
    // Persistir en tabla alertas para reportes/historial (best effort)
    try {
      const severityMap: Record<string, 'VERDE'|'AMARILLO'|'ROJO'> = {
        'RETRASO': 'ROJO',
        'PROXIMA_ENTREGA': 'AMARILLO',
        'ENTREGA_COMPLETADA': 'VERDE',
        'ASIGNACION': 'VERDE',
        'TRABAJO_AGREGADO': 'VERDE',
      };
      const severidad = severityMap[type] || 'VERDE';
      await prisma.alertas.create({ data: { tipo: type, severidad, descripcion: message, pedido_id: pedidoId ?? undefined } }).catch(() => {});
    } catch {}
  }
}

export const RealtimeService = new Realtime();
export default RealtimeService;
