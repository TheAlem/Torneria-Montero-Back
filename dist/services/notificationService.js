import { logger } from '../utils/logger';
export class NotificationService {
    static async sendAppAccess(email, phone, code) {
        const base = process.env.APP_BASE_URL || 'http://localhost:3000';
        const link = `${base}/pedido/${encodeURIComponent(code)}`;
        logger.info({ msg: '[NotificationService] sendAppAccess', email, phone, code, link });
        return true;
    }
    static async sendDelayNotice(args) {
        const { clienteEmail, clienteTelefono, pedidoId, nuevaFecha, motivo } = args;
        const payload = { type: 'DELAY_NOTICE', pedidoId, nuevaFecha, motivo };
        logger.info({ msg: '[NotificationService] sendDelayNotice', email: clienteEmail, phone: clienteTelefono, payload });
        return true;
    }
}
export default NotificationService;
