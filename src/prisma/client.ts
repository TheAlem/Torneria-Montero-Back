import { PrismaClient } from '@prisma/client';
import {
  createTransientDatabaseError,
  isDatabaseRecentlyDown,
  isRetryableDatabaseError,
  markDatabaseDown,
  markDatabaseUp,
  waitMs,
} from './dbAvailability.js';
import { logger } from '../utils/logger.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const safeTimeoutMs = Math.max(500, Math.round(timeoutMs));
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        createTransientDatabaseError(
          'P1002',
          `Database query attempt timed out after ${safeTimeoutMs}ms.`,
          'query_attempt_timeout'
        )
      );
    }, safeTimeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

const retryAttempts = Math.max(1, Math.min(4, Math.round(parsePositiveNumber(process.env.DB_WAKE_RETRY_ATTEMPTS, 2))));
const retryDelayMs = Math.max(200, Math.round(parsePositiveNumber(process.env.DB_WAKE_RETRY_DELAY_MS, 900)));
const retryBackoff = Math.min(3, Math.max(1, parsePositiveNumber(process.env.DB_WAKE_RETRY_BACKOFF, 1.7)));
const attemptTimeoutMs = Math.max(1_000, Math.round(parsePositiveNumber(process.env.DB_WAKE_ATTEMPT_TIMEOUT_MS, 8_000)));
const downFastFailWindowMs = Math.max(
  0,
  Math.round(parseNonNegativeNumber(process.env.DB_DOWN_FAST_FAIL_WINDOW_MS, 4_000))
);

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = basePrisma;

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (isDatabaseRecentlyDown(downFastFailWindowMs)) {
          throw createTransientDatabaseError(
            'P1001',
            `Database is temporarily unavailable (fast-fail window ${downFastFailWindowMs}ms).`,
            'fast_fail_recent_down'
          );
        }

        let delayMs = retryDelayMs;
        let attempt = 1;

        while (attempt <= retryAttempts) {
          try {
            const result = await runWithTimeout(query(args), attemptTimeoutMs);
            markDatabaseUp({ source: `prisma:${String(model)}.${String(operation)}` });
            return result;
          } catch (err) {
            const retryable = isRetryableDatabaseError(err);
            if (!retryable) throw err;

            markDatabaseDown(err, { source: `prisma:${String(model)}.${String(operation)}` });
            if (attempt >= retryAttempts) throw err;

            logger.warn({
              msg: '[DB] retrying prisma query after transient error',
              model: model ?? 'raw',
              operation,
              attempt,
              nextDelayMs: delayMs,
              timeoutMs: attemptTimeoutMs,
              err: (err as any)?.message,
              code: (err as any)?.code,
            });
            await waitMs(delayMs);
            delayMs = Math.round(delayMs * retryBackoff);
            attempt += 1;
          }
        }

        throw new Error('Unexpected DB retry loop termination.');
      },
    },
  },
}) as PrismaClient;
