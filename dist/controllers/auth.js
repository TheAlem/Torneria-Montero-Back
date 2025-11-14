import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client';
import { success, fail, fieldsValidation } from '../utils/response';
import { logger } from '../utils/logger';
export const register = async (req, res, next) => {
    try {
        const JWT_SECRET = process.env.JWT_SECRET;
        const { email, password, nombre, ci_rut, telefono, direccion, rol } = req.body;
        const normalizedRole = String(rol || 'CLIENTE').toUpperCase();
        if (!email || !password) {
            const errors = {};
            if (!email)
                errors.email = 'El email es obligatorio.';
            if (!password)
                errors.password = 'La contraseña es obligatoria.';
            return fieldsValidation(res, errors);
        }
        const exists = await prisma.usuarios.findUnique({ where: { email } });
        if (exists)
            return fail(res, 'CONFLICT', 'Email en uso', 409);
        const hash = await bcrypt.hash(password, 10);
        let user;
        if (normalizedRole === 'TRABAJADOR') {
            if (!ci_rut)
                return fieldsValidation(res, { ci_rut: 'El campo ci_rut es obligatorio para TRABAJADOR.' });
            user = await prisma.usuarios.create({
                data: {
                    email,
                    password_hash: hash,
                    rol: 'TRABAJADOR',
                    nombre: nombre || '',
                    telefono: telefono || null,
                    trabajador: { create: { ci: ci_rut, direccion: direccion || null } }
                },
                include: { trabajador: true }
            });
        }
        else {
            user = await prisma.usuarios.create({
                data: {
                    email,
                    password_hash: hash,
                    rol: 'CLIENTE',
                    nombre: nombre || '',
                    telefono: telefono || null,
                    cliente: {
                        create: {
                            nombre: nombre || '',
                            email,
                            ci_rut: ci_rut || '',
                            telefono: telefono || '',
                            direccion: direccion || ''
                        }
                    }
                },
                include: { cliente: true }
            });
        }
        logger.info({ msg: 'Creating user', email });
        if (!JWT_SECRET) {
            throw new Error('JWT_SECRET is not defined or empty');
        }
        const token = normalizedRole === 'TRABAJADOR' ? null : jwt.sign({ id: user.id, role: user.rol }, JWT_SECRET, { expiresIn: '8h' });
        return success(res, { token, profile: { id: user.id, email: user.email, role: user.rol } }, 201);
    }
    catch (err) {
        next(err);
    }
};
export const login = async (req, res, next) => {
    try {
        const JWT_SECRET = process.env.JWT_SECRET;
        const { email, password } = req.body;
        const user = await prisma.usuarios.findUnique({ where: { email } });
        if (!user)
            return fail(res, 'AUTH_ERROR', 'Credenciales inválidas', 401);
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok)
            return fail(res, 'AUTH_ERROR', 'Credenciales inválidas', 401);
        const token = jwt.sign({ id: user.id, role: user.rol }, JWT_SECRET, { expiresIn: '8h' });
        return success(res, { token, profile: { id: user.id, email: user.email, role: user.rol } });
    }
    catch (err) {
        next(err);
    }
};
export const adminCreate = async (req, res, next) => {
    try {
        const { email, password, nombre, ci_rut, telefono, direccion, rol, rol_tecnico } = req.body;
        if (!email || !password || !rol) {
            const errors = {};
            if (!email)
                errors.email = 'El email es obligatorio.';
            if (!password)
                errors.password = 'La contraseña es obligatoria.';
            if (!rol)
                errors.rol = 'El rol es obligatorio.';
            return fieldsValidation(res, errors);
        }
        const normalizedRole = String(rol).toUpperCase();
        if (!['TRABAJADOR', 'TORNERO', 'ADMIN'].includes(normalizedRole)) {
            return fail(res, 'VALIDATION_ERROR', 'Solo se permite crear roles TORNERO, TRABAJADOR o ADMIN', 400);
        }
        const exists = await prisma.usuarios.findUnique({ where: { email } });
        if (exists)
            return fail(res, 'CONFLICT', 'Email en uso', 409);
        const hash = await bcrypt.hash(password, 10);
        let user;
        if (normalizedRole === 'TRABAJADOR') {
            if (!ci_rut)
                return fieldsValidation(res, { ci_rut: 'El campo ci_rut es obligatorio para TRABAJADOR.' });
            user = await prisma.usuarios.create({
                data: {
                    email,
                    password_hash: hash,
                    rol: 'TRABAJADOR',
                    nombre: nombre || '',
                    telefono: telefono || null,
                    trabajador: { create: { ci: ci_rut, direccion: direccion || null, rol_tecnico: rol_tecnico || null } }
                },
                include: { trabajador: true }
            });
        }
        else if (normalizedRole === 'TORNERO') {
            user = await prisma.usuarios.create({
                data: {
                    email,
                    password_hash: hash,
                    rol: 'TORNERO',
                    nombre: nombre || '',
                    telefono: telefono || null,
                    ...(ci_rut ? { trabajador: { create: { ci: ci_rut, direccion: direccion || null, rol_tecnico: rol_tecnico || null } } } : {})
                },
                include: { trabajador: true }
            });
        }
        else {
            user = await prisma.usuarios.create({
                data: {
                    email,
                    password_hash: hash,
                    rol: 'ADMIN',
                    nombre: nombre || '',
                    telefono: telefono || null,
                }
            });
        }
        return success(res, { profile: { id: user.id, email: user.email, role: user.rol }, trabajador: user.trabajador || null }, 201);
    }
    catch (err) {
        next(err);
    }
};
