import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';
import { success, fail, fieldsValidation } from '../utils/response.js';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clients = await prisma.clientes.findMany();
    return success(res, clients);
  } catch (err) { next(err); }
};

export const buscar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ci_rut, nombre, telefono } = req.query as Record<string, string | undefined>;

    // 1) Si viene CI/RUT, prioridad a búsqueda exacta (case-insensitive)
    if (ci_rut && ci_rut.trim()) {
      const client = await prisma.clientes.findFirst({
        where: { ci_rut: { equals: ci_rut.trim(), mode: 'insensitive' } }
      });
      if (client) return success(res, { match: true, client });
      // Si no hay match exacto por CI, retornar sugerencias por nombre/teléfono si vienen
    }

    // 2) Búsqueda por nombre/telefono con contains (insensible a mayúsculas)
    if ((nombre && nombre.trim()) || (telefono && telefono.trim())) {
      const candidates = await prisma.clientes.findMany({
        where: {
          AND: [
            nombre && nombre.trim() ? { nombre: { contains: nombre.trim(), mode: 'insensitive' } } : {},
            telefono && telefono.trim() ? { telefono: { contains: telefono.trim(), mode: 'insensitive' } } : {},
          ]
        },
        take: 10,
        orderBy: { fecha_registro: 'desc' }
      });
      return success(res, { match: false, candidates });
    }

    return fail(res, 'VALIDATION_ERROR', 'Proporcione ci_rut o nombre/telefono para buscar', 400);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nombre, email, telefono, direccion, ci_rut } = req.body;
    if (!nombre || !telefono) {
      const errors: any = {};
      if (!nombre) errors.nombre = 'El campo nombre es obligatorio.';
      if (!telefono) errors.telefono = 'El campo teléfono es obligatorio.';
      return fieldsValidation(res, errors);
    }
    const client = await prisma.clientes.create({ data: { nombre, email: email || null, telefono, direccion: direccion || null, ci_rut: ci_rut || null } });
    return success(res, client, 201);
  } catch (err: any) {
    if (err?.code === 'P2002') return fail(res, 'UNIQUE_CONSTRAINT', 'Ya existe un registro con estos datos únicos.', 409);
    next(err);
  }
};

export const obtener = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const client = await prisma.clientes.findUnique({ where: { id }, include: { pedidos: true } });
    if (!client) return fail(res, 'NOT_FOUND', 'Cliente no encontrado', 404);
    return success(res, client);
  } catch (err) { next(err); }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { name, email, phone, address } = req.body;
    const client = await prisma.clientes.update({ where: { id }, data: { nombre: name, email, telefono: phone, direccion: address } });
    return success(res, client);
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    await prisma.clientes.delete({ where: { id } });
    return success(res, null, 200, 'Cliente eliminado');
  } catch (err: any) {
    if (err?.code === 'P2025') return fail(res, 'NOT_FOUND', 'Cliente no encontrado', 404);
    if (err?.code === 'P2003') return fail(res, 'CONFLICT', 'No se puede eliminar el cliente porque tiene registros asociados.', 409);
    next(err);
  }
};

