import { logger } from './utils/logger';
import dotenv from 'dotenv';
import os from 'os';
dotenv.config();

// When running via ts-node/esm import the compiled JS path
import app from './app';

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

app.listen(PORT, HOST, () => {
  logger.info(`Server listening on http://localhost:${PORT}`);
  logger.info(`On your network: http://${getNetworkAddress()}:${PORT}`);
  const enabled = String(process.env.KANBAN_MONITOR_ENABLED || 'false').toLowerCase() === 'true';
  const everySec = Number(process.env.KANBAN_MONITOR_INTERVAL_SEC || 300);
  if (enabled) {
    import('./services/KanbanMonitorService').then(({ evaluateAndNotify }) => {
      setInterval(async () => {
        try { await evaluateAndNotify(); } catch (e) { logger.error('Kanban monitor error', e as any); }
      }, Math.max(60, everySec) * 1000);
      logger.info(`Kanban monitor enabled. Interval=${everySec}s`);
    });
  }

  // Nightly ML training (auto aprendizaje por trabajador/tiempos)
  const mlEnabled = String(process.env.ML_TRAIN_ENABLED || 'false').toLowerCase() === 'true';
  if (mlEnabled) {
    const hourUTC = Math.min(23, Math.max(0, Number(process.env.ML_TRAIN_UTC_HOUR || 6)));
    const limit = Math.max(100, Number(process.env.ML_TRAIN_LIMIT || 2000));
    const scheduleNext = () => {
      const now = new Date();
      const next = new Date(now);
      next.setUTCDate(now.getUTCDate() + (now.getUTCHours() >= hourUTC ? 1 : 0));
      next.setUTCHours(hourUTC, 0, 0, 0);
      const ms = Math.max(1000, next.getTime() - now.getTime());
      setTimeout(async () => {
        try {
          const { trainLinearDurationModelTF } = await import('./services/ml/train-tensor');
          const result = await trainLinearDurationModelTF(limit);
          logger.info({ msg: '[ML] Modelo entrenado', count: result.count, version: result.model.version });
          try {
            const { default: RealtimeService } = await import('./realtime/RealtimeService');
            RealtimeService.emitWebAlert('ML_TRAINED', 'Modelo ML entrenado', {});
          } catch {}
        } catch (e) {
          logger.error('[ML] Error en entrenamiento nocturno', e as any);
        } finally {
          scheduleNext();
        }
      }, ms);
      logger.info(`[ML] Entrenamiento programado diariamente a las ${hourUTC}:00 UTC (en ${(ms/3600000).toFixed(2)} h)`);
    };
    scheduleNext();
  }
});
