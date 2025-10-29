import type { Request, Response, NextFunction  } from "express";

const API_TOKEN = process.env.API_TOKEN || '';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'] as string | undefined;
  if (!API_TOKEN) return res.status(500).json({ error: 'Configuración del servidor inválida: falta API_TOKEN' });
  if (!key || key !== API_TOKEN) return res.status(401).json({ error: 'API key inválida' });
  next();
}

export default apiKeyAuth;
