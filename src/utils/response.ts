import type { Response  } from "express";

export function success(res: Response, data: any = null, statusCode: number = 200, message: string | null = null) {
  return res.status(statusCode).json({
    status: 'success',
    message,
    data,
  });
}

export function fail(res: Response, code: string, message: string, statusCode: number = 400, errors?: any) {
  const payload: any = {
    status: 'error',
    code,
    message,
    data: null,
  };
  if (typeof errors !== 'undefined') payload.errors = errors;
  return res.status(statusCode).json(payload);
}
