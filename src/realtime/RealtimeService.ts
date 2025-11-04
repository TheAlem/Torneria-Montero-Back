import type { Response } from 'express';
import { logger } from '../utils/logger';

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
}

export const RealtimeService = new Realtime();
export default RealtimeService;

