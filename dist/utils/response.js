export function success(res, data = null, statusCode = 200, message = '') {
    return res.status(statusCode).json({
        status: 'success',
        data,
        message,
    });
}
export function fail(res, code, message, statusCode = 400, errors) {
    const payload = {
        status: 'error',
        data: null,
        message,
        code,
    };
    if (typeof errors !== 'undefined')
        payload.errors = errors;
    return res.status(statusCode).json(payload);
}
export function fieldsValidation(res, errors) {
    return res.status(422).json({
        status: 'fields-validation',
        data: errors,
        message: ''
    });
}
