export class NotificationService {
  static async sendAppAccess(email: string | null | undefined, phone: string | null | undefined, code: string) {
    const base = process.env.APP_BASE_URL || 'http://localhost:3000';
    const link = `${base}/pedido/${encodeURIComponent(code)}`;
    console.log('[NotificationService] sendAppAccess', { email, phone, code, link });
    return true;
  }
}

export default NotificationService;
