import type { Response  } from "express";

export function success(res: Response, data: any = null, statusCode: number = 200) {
  return res.status(statusCode).json({
    status: 'success',
    data,
    error: null,
  });
}

export function fail(res: Response, code: string, message: string, statusCode: number = 400) {
  return res.status(statusCode).json({
    status: 'error',
    data: null,
    error: { code, message },
  });
}
