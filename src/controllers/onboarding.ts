import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';
import { success, fail } from '../utils/response.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

function deepLinkBase() {
  return process.env.MOBILE_APP_DEEPLINK_BASE || 'monteroapp://onboard';
}

function ttlMinutes() {
  const n = Number(process.env.ONBOARDING_TOKEN_TTL_MINUTES || 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export const crearQR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clienteId = Number(req.params.id);
    const cliente = await prisma.clientes.findUnique({ where: { id: clienteId } });
    if (!cliente) return fail(res, 'NOT_FOUND', 'Cliente no encontrado', 404);

    // Opcional: invalidar tokens anteriores no usados
    await prisma.onboarding_tokens.deleteMany({ where: { cliente_id: clienteId, used_at: null } });

    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + ttlMinutes() * 60_000);
    await prisma.onboarding_tokens.create({
      data: { cliente_id: clienteId, token, expires_at: expires }
    });

    const base = deepLinkBase();
    const onboardingUrl = `${base}?token=${encodeURIComponent(token)}`;
    return success(res, { token, expiresAt: expires.toISOString(), onboardingUrl }, 201);
  } catch (err) { next(err); }
};

async function getValidToken(token: string) {
  return prisma.onboarding_tokens.findFirst({
    where: {
      token,
      used_at: null,
      expires_at: { gt: new Date() }
    },
    include: { cliente: true }
  });
}

export const validar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.params.token);
    const entry = await getValidToken(token);
    if (!entry) return fail(res, 'AUTH_ERROR', 'Token invÃ¡lido o expirado', 401);

    const { cliente } = entry;
    return success(res, {
      cliente_id: cliente.id,
      nombre: cliente.nombre,
      email: cliente.email,
      telefono: cliente.telefono,
    });
  } catch (err) { next(err); }
};

export const completar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    const token = String(req.params.token);
    const { password } = req.body as any;
    if (!password || String(password).length < 6) return fail(res, 'VALIDATION_ERROR', 'ContraseÃ±a invÃ¡lida', 400);

    const entry = await getValidToken(token);
    if (!entry) return fail(res, 'AUTH_ERROR', 'Token invÃ¡lido o expirado', 401);

    const cliente = await prisma.clientes.findUnique({ where: { id: entry.cliente_id } });
    if (!cliente) return fail(res, 'NOT_FOUND', 'Cliente no encontrado', 404);
    if (cliente.usuario_id) return fail(res, 'CONFLICT', 'Cliente ya estÃ¡ vinculado a un usuario', 409);

    const hash = await bcrypt.hash(String(password), 10);
    // Email requerido por esquema: usar email real si existe o uno sintÃ©tico Ãºnico
    const syntheticEmail = `cliente-${cliente.id}@qr.local`;
    const email = cliente.email || syntheticEmail;

    // Evitar colisiÃ³n si existiera un usuario con ese email
    const existing = await prisma.usuarios.findUnique({ where: { email } }).catch(() => null);
    const finalEmail = existing ? `cliente-${cliente.id}-${Date.now()}@qr.local` : email;

    const user = await prisma.usuarios.create({
      data: {
        email: finalEmail,
        password_hash: hash,
        rol: 'CLIENTE' as any,
        nombre: cliente.nombre || '',
        telefono: cliente.telefono || null,
        cliente: { connect: { id: cliente.id } },
      }
    });

    // Marcar token como usado
    await prisma.onboarding_tokens.update({
      where: { id: entry.id },
      data: { used_at: new Date(), consumed_by: user.id }
    });

    if (!JWT_SECRET) return success(res, { profile: { id: user.id, email: user.email, role: user.rol } }, 201);
    const jwtToken = (jwt as any).sign({ id: user.id, role: user.rol }, JWT_SECRET, { expiresIn: '8h' });
    return success(res, { token: jwtToken, profile: { id: user.id, email: user.email, role: user.rol } }, 201);
  } catch (err) { next(err); }
};



