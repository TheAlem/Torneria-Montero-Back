import { Router } from 'express';
import * as ctrl from '../controllers/reportes.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

/**
 * @openapi
 * /reportes/semanal:
 *   get:
 *     tags:
 *       - Reportes
 *     summary: Reporte semanal (KPIs operativos)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           example: '2025-01-01T00:00:00.000Z'
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           example: '2025-01-07T23:59:59.999Z'
 *     responses:
 *       '200':
 *         description: Reporte semanal con KPIs (SLA, tiempos, backlog, tops, ganancia)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 *             example:
 *               status: success
 *               data:
 *                 periodo: semanal
 *                 fechaGeneracion: '2025-05-01T00:00:00.000Z'
 *                 rango: { from: '2025-04-24T00:00:00.000Z', to: '2025-05-01T00:00:00.000Z' }
 *                 datos:
 *                   total: 12
 *                   gananciaTotal: 3200
 *                   porEstado: { PENDIENTE: 3, EN_PROGRESO: 4, QA: 1, ENTREGADO: 4 }
 *                   porPrioridad: { ALTA: 3, MEDIA: 6, BAJA: 3 }
 *                   porSemaforo: { VERDE: 7, AMARILLO: 3, ROJO: 2 }
 *                   resumen: { completados: 4, enProgreso: 4, pendientes: 3, atrasadosAbiertos: 2 }
 *                   sla: { onTime: 3, late: 1, rate: 0.75 }
 *                   tiempos: { leadTimeMedSec: 82000, leadTimeAvgSec: 90000, promedioEstimadoSec: 70000, promedioRealSec: 91000, maeEstimVsReal: 21000 }
 *                   throughputPorDia: 0.57
 *                   topResponsables: [{ id: 2, nombre: 'Juan', total: 5, completados: 3, enProceso: 1, atrasados: 1 }]
 *                   topClientes: [{ id: 5, nombre: 'Cliente ABC', total: 4, completados: 2, enProceso: 1, atrasados: 1 }]
 *                   entregasRecientes:
 *                     - { id: 10, titulo: 'Reparar eje', cliente: 'ABC', responsable: 'Juan', prioridad: 'ALTA', estado: 'ENTREGADO', semaforo: 'VERDE', fecha_inicio: '2025-04-27T00:00:00.000Z', fecha_estimada_fin: '2025-04-29T00:00:00.000Z', fecha_entrega: '2025-04-28T18:00:00.000Z', tiempo_estimado_sec: 72000, tiempo_real_sec: 65000, atraso_sec: -7000 }
 *                   trabajos:
 *                     - { id: 10, titulo: 'Reparar eje', descripcion: 'Rectificado...', estado: 'ENTREGADO', prioridad: 'ALTA', semaforo: 'VERDE', fecha_inicio: '2025-04-27T00:00:00.000Z', fecha_estimada_fin: '2025-04-29T00:00:00.000Z', fecha_actualizacion: '2025-04-28T18:00:00.000Z', tiempo_estimado_sec: 72000, tiempo_real_sec: 65000, cliente_id: 5, responsable_id: 2, precio: 800, monto: 800, importe: 800, estado_pago: 'PAGADO', paymentStatus: 'PAGADO', notas: null, cliente: { id: 5, nombre: 'Cliente ABC', direccion: 'Calle 1', telefono: '7000' }, responsable: { id: 2, rol_tecnico: 'Soldador', usuario: { nombre: 'Juan' }, direccion: 'Av 2' } }
 */
router.get('/semanal', authenticate, ctrl.semanal);

/**
 * @openapi
 * /reportes/mensual:
 *   get:
 *     tags:
 *       - Reportes
 *     summary: Reporte mensual (KPIs operativos)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           example: '2025-04-01T00:00:00.000Z'
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           example: '2025-04-30T23:59:59.999Z'
 *     responses:
 *       '200':
 *         description: Reporte mensual con KPIs (SLA, tiempos, backlog, tops, ganancia)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/mensual', authenticate, ctrl.mensual);

/**
 * @openapi
 * /reportes/alertas:
 *   get:
 *     tags:
 *       - Reportes
 *     summary: Historial de alertas (web) con resumen
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           example: 50
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *           example: '2025-01-01T00:00:00.000Z'
 *     responses:
 *       '200':
 *         description: Lista de alertas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnifiedSuccess'
 */
router.get('/alertas', authenticate, ctrl.alertas);

export default router;
