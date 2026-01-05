import { logger } from './utils/logger.js';
import dotenv from 'dotenv';
import os from 'os';
import { prisma } from './prisma/client.js';
import { envFlag } from './utils/env.js';
dotenv.config();

// When running via ts-node/esm import the compiled JS path
import app from './app.js';
import RealtimeService from './realtime/RealtimeService.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = '0.0.0.0';

const getNetworkAddress = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

app.listen(PORT, HOST, async () => {
  logger.info(`Server listening on http://localhost:${PORT}`);
  logger.info(`On your network: http://${getNetworkAddress()}:${PORT}`);
  try {
    await prisma.$connect();
    // Keep-alive to avoid cold starts on first auth/login
    setInterval(() => prisma.$queryRaw`SELECT 1`.catch(() => {}), 120_000);
  } catch (e) {
    logger.error({ msg: 'Prisma connect failed', err: (e as any)?.message });
  }
  const enabled = envFlag('KANBAN_MONITOR_ENABLED', false);
  const everySecRaw = Number(process.env.KANBAN_MONITOR_INTERVAL_SEC || 300);
  const intervalSec = Math.max(60, Number.isFinite(everySecRaw) ? everySecRaw : 300);
  if (enabled) {
    import('./services/KanbanMonitorService.js').then(({ evaluateAndNotify }) => {
      const run = async () => {
        try { await evaluateAndNotify(); } catch (e) { logger.error('Kanban monitor error', e as any); }
      };
      run();
      setInterval(() => {
        run();
      }, intervalSec * 1000);
      logger.info(`Kanban monitor enabled. Interval=${intervalSec}s`);
    });
  }

  // Nightly ML training (auto aprendizaje por trabajador/tiempos)
  const mlEnabled = envFlag('ML_TRAIN_ENABLED', false);
  if (mlEnabled) {
    const parseHour = (value?: string) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : undefined;
    };
    const boliviaHourRaw =
      parseHour(process.env.ML_TRAIN_BOLIVIA_HOUR) ??
      parseHour(process.env.ML_TRAIN_LOCAL_HOUR) ??
      parseHour(process.env.ML_TRAIN_UTC_HOUR);
    const boliviaHour = Math.min(23, Math.max(0, boliviaHourRaw ?? 6));
    const BOLIVIA_TZ_OFFSET_MS = -4 * 60 * 60 * 1000; // America/La_Paz is UTC-4 all year
    const formatHour = (hour: number) => String(hour).padStart(2, '0');
    const limit = Math.max(100, Number(process.env.ML_TRAIN_LIMIT || 2000));
    const scheduleNext = () => {
      const now = new Date();
      const nowBolivia = new Date(now.getTime() + BOLIVIA_TZ_OFFSET_MS);
      const nextBolivia = new Date(nowBolivia);
      if (nowBolivia.getUTCHours() >= boliviaHour) {
        nextBolivia.setUTCDate(nextBolivia.getUTCDate() + 1);
      }
      nextBolivia.setUTCHours(boliviaHour, 0, 0, 0);
      const nextUtc = new Date(nextBolivia.getTime() - BOLIVIA_TZ_OFFSET_MS);
      const ms = Math.max(1000, nextUtc.getTime() - now.getTime());
      setTimeout(async () => {
        try {
          const { trainLinearDurationModelTF } = await import('./services/ml/train-tensor.js');
          const result = await trainLinearDurationModelTF(limit);
          logger.info({ msg: '[ML] Modelo entrenado', count: result.count, version: result.model.version });
          try {
            RealtimeService.emitWebAlert('ML_TRAINED', 'Modelo ML entrenado', {});
          } catch {}
        } catch (e) {
          logger.error('[ML] Error en entrenamiento nocturno', e as any);
        } finally {
          scheduleNext();
        }
      }, ms);
      logger.info(`[ML] Entrenamiento programado diariamente a las ${formatHour(boliviaHour)}:00 America/La_Paz (en ${(ms/3600000).toFixed(2)} h)`);
    };
    scheduleNext();
  }
});
