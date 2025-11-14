import { Router } from 'express';
import { authenticate } from '../middlewares/authMiddleware.js';
import { prisma } from '../prisma/client.js';
import RealtimeService from '../realtime/RealtimeService.js';

const router = Router();

// SSE stream for client/user notifications
router.get('/notifications', authenticate, async (req, res, next) => {
  try {
    const user = (req as any).user as { id: number; role: string };
    // Try to subscribe by client if exists; else by user
    const profile = await prisma.usuarios.findUnique({ where: { id: user.id }, include: { cliente: true } });
    if (profile?.cliente?.id) {
      RealtimeService.subscribeClient(profile.cliente.id, res);
    } else {
      RealtimeService.subscribeUser(user.id, res);
    }
  } catch (err) { next(err); }
});

// SSE stream for operators (ADMIN/TORNERO)
router.get('/kanban', authenticate, (req, res, next) => {
  try {
    const user = (req as any).user as { id: number; role: string };
    const role = String(user.role).toUpperCase();
    if (!['ADMIN','TORNERO'].includes(role)) {
      res.status(403).json({ status: 'error', data: null, message: 'Acceso denegado', code: 'AUTH_ERROR' });
      return;
    }
    RealtimeService.subscribeOperators(res);
  } catch (err) { next(err); }
});

export default router;

