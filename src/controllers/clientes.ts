import type { Request, Response, NextFunction  } from "express";
import { prisma } from '../prisma/client';
import { success, fail } from '../utils/response';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clients = await prisma.clientes.findMany();
    return success(res, clients);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nombre, email, telefono, direccion, ci_rut } = req.body;
    if (!nombre || !telefono) return fail(res, 'VALIDATION_ERROR', 'nombre y telefono son requeridos', 400);
    const client = await prisma.clientes.create({ data: { nombre, email: email || null, telefono, direccion: direccion || null, ci_rut: ci_rut || null } });
    return success(res, client, 201);
  } catch (err: any) {
    if (err?.code === 'P2002') return fail(res, 'CONFLICT', 'Valor único en conflicto', 409);
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
    return success(res, null, 204);
  } catch (err) { next(err); }
};
