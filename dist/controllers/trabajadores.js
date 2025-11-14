import { prisma } from '../prisma/client';
import { success, fail } from '../utils/response';
export const listar = async (req, res, next) => {
    try {
        const workers = await prisma.trabajadores.findMany({ include: { usuario: true } });
        return success(res, workers);
    }
    catch (err) {
        next(err);
    }
};
export const obtener = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const w = await prisma.trabajadores.findUnique({ where: { id }, include: { pedidosResponsable: true, usuario: true } });
        if (!w)
            return fail(res, 'NOT_FOUND', 'Trabajador no encontrado', 404);
        return success(res, w);
    }
    catch (err) {
        next(err);
    }
};
export const actualizar = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const body = (req.body || {});
        const { direccion, rol_tecnico, estado, skills, carga_actual, disponibilidad } = body;
        const data = {};
        if (typeof direccion !== 'undefined')
            data.direccion = direccion;
        if (typeof rol_tecnico !== 'undefined')
            data.rol_tecnico = rol_tecnico;
        if (typeof estado !== 'undefined')
            data.estado = estado;
        if (typeof skills !== 'undefined')
            data.skills = skills; // JSON array o libre
        if (typeof disponibilidad !== 'undefined')
            data.disponibilidad = disponibilidad; // JSON libre
        if (typeof carga_actual !== 'undefined') {
            const n = Number(carga_actual);
            if (Number.isFinite(n))
                data.carga_actual = n;
        }
        if (Object.keys(data).length === 0) {
            return fail(res, 'VALIDATION_ERROR', 'No hay campos para actualizar', 422);
        }
        const w = await prisma.trabajadores.update({ where: { id }, data });
        return success(res, w);
    }
    catch (err) {
        next(err);
    }
};
export const eliminar = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        await prisma.trabajadores.delete({ where: { id } });
        // Respuesta consistente con cuerpo JSON
        return success(res, null, 200, 'Trabajador eliminado');
    }
    catch (err) {
        if (err?.code === 'P2025') {
            return fail(res, 'NOT_FOUND', 'Trabajador no encontrado', 404);
        }
        if (err?.code === 'P2003') {
            return fail(res, 'CONFLICT', 'No se puede eliminar el trabajador porque tiene registros asociados (asignaciones, tiempos o aparece como responsable). Desactívelo o quite las referencias antes de eliminar.', 409);
        }
        next(err);
    }
};
export const listarActivos = async (req, res, next) => {
    try {
        const workers = await prisma.trabajadores.findMany({ where: { estado: 'Activo' }, include: { usuario: true } });
        return success(res, workers.map((w) => ({ id: w.id, nombre: w.usuario?.nombre || null })));
    }
    catch (err) {
        next(err);
    }
};
