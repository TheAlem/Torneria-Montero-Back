import winston from 'winston';
const { combine, timestamp, printf, colorize } = winston.format;
const myFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${typeof message === 'string' ? message : JSON.stringify(message)}`;
});
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(timestamp(), myFormat),
    transports: [
        new winston.transports.Console({ format: combine(colorize(), timestamp(), myFormat) })
    ],
});
export default logger;
