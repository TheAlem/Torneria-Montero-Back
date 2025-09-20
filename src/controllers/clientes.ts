import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client.js';

export const listar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientes = await prisma.cliente.findMany();
    res.json(clientes);
  } catch (err) { next(err); }
};

export const crear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nombre, email, telefono } = req.body;
    const cliente = await prisma.cliente.create({ data: { nombre, email, telefono } });
    res.status(201).json(cliente);
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email ya existe' });
    next(err);
  }
};

export const obtener = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const id = parseInt(req.params.id as string, 10);
    const cliente = await prisma.cliente.findUnique({ where: { id }, include: { pedidos: true } });
    if (!cliente) return res.status(404).json({ error: 'No encontrado' });
    res.json(cliente);
  } catch (err) { next(err); }
};

export const actualizar = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const id = parseInt(req.params.id as string, 10);
    const { nombre, email, telefono } = req.body;
    const cliente = await prisma.cliente.update({ where: { id }, data: { nombre, email, telefono } });
    res.json(cliente);
  } catch (err) { next(err); }
};

export const eliminar = async (req: Request, res: Response, next: NextFunction) => {
  try {
  const id = parseInt(req.params.id as string, 10);
    await prisma.cliente.delete({ where: { id } });
    res.status(204).end();
  } catch (err) { next(err); }
};
