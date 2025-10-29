import { logger } from './utils/logger';
import dotenv from 'dotenv';
dotenv.config();

// When running via ts-node/esm import the compiled JS path
import app from './app';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.listen(PORT, () => {
  logger.info(`Server listening on http://localhost:${PORT}`);  
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
});
