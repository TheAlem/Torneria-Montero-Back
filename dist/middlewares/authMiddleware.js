import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client';
import { fail } from '../utils/response';
import { logger } from '../utils/logger';
const JWT_SECRET = process.env.JWT_SECRET ?? '';
export async function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    // Permitir token por query para SSE/EventSource (no soporta headers personalizados)
    const tokenFromQuery = (req.query?.token || req.query?.access_token);
    let token;
    if (auth) {
        const parts = auth.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer')
            return fail(res, 'AUTH_ERROR', 'Token malformado', 401);
        token = parts[1];
    }
    else if (typeof tokenFromQuery === 'string' && tokenFromQuery.length > 0) {
        token = tokenFromQuery;
    }
    else {
        return fail(res, 'AUTH_ERROR', 'Token no provisto', 401);
    }
    try {
        if (!JWT_SECRET) {
            logger.error('Configuración del servidor inválida: falta JWT_SECRET');
            return fail(res, 'SERVER_ERROR', 'Configuración del servidor inválida', 500);
        }
        const payload = jwt.verify(token, JWT_SECRET);
        const profile = await prisma.usuarios.findUnique({ where: { id: Number(payload.id) } });
        if (!profile)
            return fail(res, 'AUTH_ERROR', 'Usuario no encontrado', 401);
        if (String(profile.rol).toUpperCase() === 'TRABAJADOR') {
            return fail(res, 'AUTH_ERROR', 'Acceso denegado', 403);
        }
        req.user = { id: profile.id, role: profile.rol, email: profile.email };
        next();
    }
    catch (err) {
        return fail(res, 'AUTH_ERROR', 'Token inválido', 401);
    }
}
export function requireRole(...roles) {
    return (req, res, next) => {
        const user = req.user;
        if (!user)
            return fail(res, 'AUTH_ERROR', 'No autenticado', 401);
        const expected = roles.map(r => r.toUpperCase());
        const actual = String(user.role).toUpperCase();
        if (!expected.includes(actual))
            return fail(res, 'AUTH_ERROR', 'Acceso denegado', 403);
        next();
    };
}
