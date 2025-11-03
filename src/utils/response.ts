import type { Response } from 'express';

export function success(res: Response, data: any = null, statusCode: number = 200, message: string = '') {
  return res.status(statusCode).json({
    status: 'success',
    data,
    message,
  });
}

export function fail(res: Response, code: string, message: string, statusCode: number = 400, errors?: any) {
  const payload: any = {
    status: 'error',
    data: null,
    message,
    code,
  };
  if (typeof errors !== 'undefined') payload.errors = errors;
  return res.status(statusCode).json(payload);
}

export function fieldsValidation(res: Response, errors: any) {
  return res.status(422).json({
    status: 'fields-validation',
    data: errors,
    message: ''
  });
}
