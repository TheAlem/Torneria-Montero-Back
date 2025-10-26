import type { Request, Response, NextFunction  } from "express";
import { prisma } from '../prisma/client';
import { success } from '../utils/response';

export const semanal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const trabajos = await prisma.pedidos.findMany({ where: { fecha_inicio: { gte: lastWeek } }, include: { cliente: true, responsable: true } });
    const resumen = trabajos.reduce((acc: any, t: any) => { acc[t.estado] = (acc[t.estado] || 0) + 1; return acc; }, {});
    const reporte = { periodo: 'semanal', fechaGeneracion: new Date(), datos: { total: trabajos.length, porEstado: resumen, trabajos } };
    return success(res, reporte);
  } catch (err) { next(err); }
};

export const mensual = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    const trabajos = await prisma.pedidos.findMany({ where: { fecha_inicio: { gte: lastMonth } }, include: { cliente: true, responsable: true } });
    const resumen = trabajos.reduce((acc: any, t: any) => { acc[t.estado] = (acc[t.estado] || 0) + 1; return acc; }, {});
    const reporte = { periodo: 'mensual', fechaGeneracion: new Date(), datos: { total: trabajos.length, porEstado: resumen, trabajos } };
    return success(res, reporte);
  } catch (err) { next(err); }
};
