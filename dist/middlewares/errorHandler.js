import { logger } from '../utils/logger';
import { fail } from '../utils/response';
export default function errorHandler(err, req, res, _next) {
    // Log legible en servidor
    try {
        logger.error({ message: 'API Error', error: err });
    }
    catch {
        // noop
    }
    let status = Number(err?.status || err?.statusCode || 500);
    let code = String(err?.code || 'SERVER_ERROR');
    let message = String(err?.message || 'Error interno del servidor.');
    let errors = undefined;
    // Prisma: errores conocidos
    if (err?.name === 'PrismaClientKnownRequestError') {
        switch (err.code) {
            case 'P2002':
                status = 409;
                code = 'UNIQUE_CONSTRAINT';
                message = 'Ya existe un registro con estos datos únicos.';
                break;
            case 'P2003':
                status = 409;
                code = 'FK_CONSTRAINT';
                message = 'Operación no permitida: existen referencias asociadas.';
                break;
            case 'P2025':
                status = 404;
                code = 'NOT_FOUND';
                message = 'Recurso no encontrado.';
                break;
            default:
                code = err.code || code;
        }
    }
    else if (err?.name === 'PrismaClientValidationError') {
        status = 400;
        code = 'VALIDATION_ERROR';
        message = 'Parámetros inválidos.';
    }
    // Zod u otros validadores
    if (err?.name === 'ZodError') {
        status = 422;
        // Respuesta especial de validación de campos
        return res.status(status).json({
            status: 'fields-validation',
            data: err?.errors ?? err,
            message: ''
        });
    }
    // Auth explícitos
    if (status === 401 || status === 403) {
        code = 'AUTH_ERROR';
    }
    else if (status === 400 && !code) {
        code = 'VALIDATION_ERROR';
    }
    else if (status === 404 && !code) {
        code = 'NOT_FOUND';
    }
    // Respuesta de error unificada
    return fail(res, code, message, status, errors);
}
