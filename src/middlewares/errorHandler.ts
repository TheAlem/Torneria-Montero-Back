import type { Request, Response, NextFunction  } from "express";
import { logger } from '../utils/logger';

export default function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // Log error server-side via Winston
  logger.error({ message: '💥 Error', error: err });

  const status = err.status || err.statusCode || 500;
  const code = err.code || (status === 400 ? 'VALIDATION_ERROR' : status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR');
  const message = err.message || 'Error interno del servidor.';

  res.status(status).json({
    status: 'error',
    data: null,
    error: { code, message }
  });
}
