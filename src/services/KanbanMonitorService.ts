import { prisma } from '../prisma/client';
import NotificationService from './notificationService';
import { predictTiempoSec } from './MLService';
import { logger } from '../utils/logger';

export async function evaluateAndNotify() {
  const now = new Date();
  const activos = await prisma.pedidos.findMany({
    where: { estado: { in: ['PENDIENTE','ASIGNADO','EN_PROGRESO','QA'] } },
    include: { cliente: true, responsable: true }
  });
  const affected: any[] = [];
  for (const p of activos) {
    if (!p.fecha_estimada_fin) continue;
    const remainingMs = p.fecha_estimada_fin.getTime() - now.getTime();
    const remainingSec = Math.max(0, Math.round(remainingMs / 1000));

    const responsableId = p.responsable_id ?? 0;
    const estimSec = await predictTiempoSec(p.id, responsableId);

    // si la estimación supera el tiempo restante, riesgo de retraso
    if (estimSec > remainingSec) {
      // actualizar semáforo a ROJO
      await prisma.pedidos.update({ where: { id: p.id }, data: { semaforo: 'ROJO' } });

      // calcular nueva fecha sugerida
      const nuevaFecha = new Date(now.getTime() + estimSec * 1000);

      // crear notificación al cliente
      try {
        await prisma.notificaciones.create({
          data: {
            pedido_id: p.id,
            cliente_id: p.cliente_id,
            mensaje: `Retraso estimado. Nueva fecha sugerida: ${nuevaFecha.toISOString()}`,
            tipo: 'ALERTA',
          }
        });
      } catch {}

      await NotificationService.sendDelayNotice({
        clienteEmail: p.cliente?.email ?? null,
        clienteTelefono: p.cliente?.telefono ?? null,
        pedidoId: p.id,
        nuevaFecha: nuevaFecha.toISOString(),
        motivo: 'Capacidad insuficiente para cumplir el plazo actual',
      });

      affected.push({ id: p.id, oldDue: p.fecha_estimada_fin, suggestedDue: nuevaFecha });
      logger.info({ msg: '[KanbanMonitor] Pedido en riesgo', pedidoId: p.id, suggestedDue: nuevaFecha.toISOString() });
    } else {
      // si está en verde y ok, asegurar semáforo en VERDE (no forzamos amarillos aquí)
      if (p.semaforo !== 'VERDE') {
        await prisma.pedidos.update({ where: { id: p.id }, data: { semaforo: 'VERDE' } });
      }
    }
  }
  return { checked: activos.length, affected };
}

