import { logger } from '../utils/logger.js';

export type DatabaseStatus = 'unknown' | 'up' | 'down';

export interface DatabaseStatusSnapshot {
  status: DatabaseStatus;
  available: boolean;
  code: string | null;
  reason: string | null;
  message: string;
  effect: 'db-online' | 'db-offline' | 'db-unknown';
  failureCount: number;
  source: string;
  checkedAt: string;
  changedAt: string;
  latencyMs: number | null;
}

export interface DatabaseErrorPublicInfo {
  code: 'DB_SLEEPING' | 'DB_UNAVAILABLE';
  message: string;
  reason: string;
  effect: 'db-sleeping' | 'db-unavailable';
  retryAfterSec: number;
}

interface InternalState {
  status: DatabaseStatus;
  code: string | null;
  reason: string | null;
  message: string;
  failureCount: number;
  source: string;
  checkedAt: Date;
  changedAt: Date;
  latencyMs: number | null;
}

interface DatabaseErrorClassification {
  isDatabaseError: boolean;
  retryable: boolean;
  likelySleeping: boolean;
  prismaCode: string | null;
  reason: string;
}

const RETRYABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const DB_MESSAGE_PATTERNS = [
  /can'?t reach database server/i,
  /database server .* timed out/i,
  /timed out fetching a new connection/i,
  /connection terminated unexpectedly/i,
  /server has closed the connection/i,
  /socket hang up/i,
  /database (is )?(paused|sleeping|suspended)/i,
  /connection pool timed out/i,
];

const DB_INIT_NAMES = new Set([
  'PrismaClientInitializationError',
  'PrismaClientUnknownRequestError',
  'PrismaClientRustPanicError',
]);

const dbListeners = new Set<(snapshot: DatabaseStatusSnapshot) => void>();

const now = new Date();
const dbState: InternalState = {
  status: 'unknown',
  code: null,
  reason: null,
  message: 'Estado de base de datos aun no verificado.',
  failureCount: 0,
  source: 'startup',
  checkedAt: now,
  changedAt: now,
  latencyMs: null,
};

function toSnapshot(): DatabaseStatusSnapshot {
  return {
    status: dbState.status,
    available: dbState.status === 'up',
    code: dbState.code,
    reason: dbState.reason,
    message: dbState.message,
    effect: dbState.status === 'up' ? 'db-online' : dbState.status === 'down' ? 'db-offline' : 'db-unknown',
    failureCount: dbState.failureCount,
    source: dbState.source,
    checkedAt: dbState.checkedAt.toISOString(),
    changedAt: dbState.changedAt.toISOString(),
    latencyMs: dbState.latencyMs,
  };
}

function normalizeCode(err: any): string | null {
  const code = err?.code ?? err?.errno ?? err?.errorCode;
  if (!code) return null;
  return String(code).toUpperCase();
}

function matchesAny(message: string): boolean {
  return DB_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function classifyDatabaseError(err: unknown): DatabaseErrorClassification {
  const anyErr = err as any;
  const name = String(anyErr?.name || '');
  const message = String(anyErr?.message || '');
  const prismaCode = normalizeCode(anyErr);
  const fromRetryablePrismaCode = prismaCode ? RETRYABLE_PRISMA_CODES.has(prismaCode) : false;
  const fromRetryableNetworkCode = prismaCode ? RETRYABLE_NETWORK_CODES.has(prismaCode) : false;
  const fromPrismaInitialization = DB_INIT_NAMES.has(name);
  const fromMessage = matchesAny(message);
  const fromPrismaKnownRequest =
    name === 'PrismaClientKnownRequestError' && (fromRetryablePrismaCode || fromMessage);

  const isDatabaseError = Boolean(
    fromRetryablePrismaCode ||
      fromRetryableNetworkCode ||
      fromPrismaInitialization ||
      fromPrismaKnownRequest ||
      fromMessage
  );
  const retryable = Boolean(
    fromRetryablePrismaCode ||
      fromRetryableNetworkCode ||
      fromPrismaInitialization ||
      fromMessage
  );
  const likelySleeping = Boolean(
    fromRetryablePrismaCode ||
      /database (is )?(paused|sleeping|suspended)/i.test(message) ||
      /cold start/i.test(message) ||
      /wake up/i.test(message)
  );

  let reason = 'database_unavailable';
  if (prismaCode === 'P1001') reason = 'database_unreachable';
  else if (prismaCode === 'P1002') reason = 'database_timeout';
  else if (prismaCode === 'P2024') reason = 'connection_pool_timeout';
  else if (fromRetryableNetworkCode) reason = 'network_connectivity';

  return {
    isDatabaseError,
    retryable,
    likelySleeping,
    prismaCode,
    reason,
  };
}

function updateState(patch: Partial<InternalState>): { changed: boolean; snapshot: DatabaseStatusSnapshot } {
  const previous = toSnapshot();
  const prevStatus = dbState.status;
  const prevCode = dbState.code;
  const prevReason = dbState.reason;
  const prevMessage = dbState.message;
  const prevSource = dbState.source;
  const prevCheckedAt = dbState.checkedAt.getTime();
  const prevFailureCount = dbState.failureCount;
  const prevLatency = dbState.latencyMs;

  const nextCheckedAt = patch.checkedAt ?? new Date();
  dbState.status = patch.status ?? dbState.status;
  dbState.code = typeof patch.code === 'undefined' ? dbState.code : patch.code;
  dbState.reason = typeof patch.reason === 'undefined' ? dbState.reason : patch.reason;
  dbState.message = patch.message ?? dbState.message;
  dbState.source = patch.source ?? dbState.source;
  dbState.checkedAt = nextCheckedAt;
  dbState.failureCount =
    typeof patch.failureCount === 'number' ? Math.max(0, patch.failureCount) : dbState.failureCount;
  dbState.latencyMs = typeof patch.latencyMs === 'number' ? Math.max(0, patch.latencyMs) : patch.latencyMs ?? null;

  const changed =
    prevStatus !== dbState.status ||
    prevCode !== dbState.code ||
    prevReason !== dbState.reason ||
    prevMessage !== dbState.message ||
    prevSource !== dbState.source ||
    prevCheckedAt !== dbState.checkedAt.getTime() ||
    prevFailureCount !== dbState.failureCount ||
    prevLatency !== dbState.latencyMs;

  if (changed && (prevStatus !== dbState.status || prevCode !== dbState.code || prevReason !== dbState.reason)) {
    dbState.changedAt = nextCheckedAt;
  }

  const snapshot = toSnapshot();
  if (changed && (previous.status !== snapshot.status || previous.code !== snapshot.code || previous.reason !== snapshot.reason)) {
    for (const listener of dbListeners) {
      try {
        listener(snapshot);
      } catch (listenerError) {
        logger.warn({ msg: '[DB] status listener failed', err: (listenerError as any)?.message });
      }
    }
  }
  return { changed, snapshot };
}

export function getDatabaseStatusSnapshot(): DatabaseStatusSnapshot {
  return toSnapshot();
}

export function isDatabaseRecentlyDown(windowMs: number): boolean {
  if (dbState.status !== 'down') return false;
  const safeWindowMs = Math.max(0, Number.isFinite(windowMs) ? windowMs : 0);
  if (safeWindowMs <= 0) return false;
  return Date.now() - dbState.checkedAt.getTime() <= safeWindowMs;
}

export function onDatabaseStatusChange(listener: (snapshot: DatabaseStatusSnapshot) => void): () => void {
  dbListeners.add(listener);
  return () => dbListeners.delete(listener);
}

export function markDatabaseUp(meta: { source?: string; latencyMs?: number } = {}): { changed: boolean; snapshot: DatabaseStatusSnapshot } {
  return updateState({
    status: 'up',
    code: null,
    reason: null,
    message: 'Base de datos disponible.',
    failureCount: 0,
    source: meta.source ?? 'query',
    latencyMs: typeof meta.latencyMs === 'number' ? meta.latencyMs : null,
    checkedAt: new Date(),
  });
}

export function markDatabaseDown(err: unknown, meta: { source?: string } = {}): { changed: boolean; snapshot: DatabaseStatusSnapshot } {
  const classified = classifyDatabaseError(err);
  if (!classified.isDatabaseError) return { changed: false, snapshot: getDatabaseStatusSnapshot() };
  const fallbackCode = classified.prismaCode ?? normalizeCode(err as any);
  const currentFailureCount = dbState.failureCount + 1;

  return updateState({
    status: 'down',
    code: fallbackCode,
    reason: classified.reason,
    message: classified.likelySleeping
      ? 'Base de datos en pausa o iniciando.'
      : 'Base de datos temporalmente no disponible.',
    failureCount: currentFailureCount,
    source: meta.source ?? 'query',
    latencyMs: null,
    checkedAt: new Date(),
  });
}

export function isRetryableDatabaseError(err: unknown): boolean {
  const classified = classifyDatabaseError(err);
  return classified.isDatabaseError && classified.retryable;
}

export function getDatabaseErrorPublicInfo(err: unknown): DatabaseErrorPublicInfo | null {
  const classified = classifyDatabaseError(err);
  if (!classified.isDatabaseError || !classified.retryable) return null;

  if (classified.likelySleeping || classified.reason === 'database_timeout') {
    return {
      code: 'DB_SLEEPING',
      message: 'La base de datos esta en pausa o iniciando. Reintenta en unos segundos.',
      reason: classified.reason,
      effect: 'db-sleeping',
      retryAfterSec: 4,
    };
  }

  return {
    code: 'DB_UNAVAILABLE',
    message: 'La base de datos no esta disponible temporalmente.',
    reason: classified.reason,
    effect: 'db-unavailable',
    retryAfterSec: 8,
  };
}

export async function waitMs(ms: number): Promise<void> {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (safeMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, safeMs));
}

export function createTransientDatabaseError(
  code: 'P1001' | 'P1002',
  message: string,
  reason?: string
): Error & { code: string; reason?: string } {
  const error = new Error(message) as Error & { code: string; reason?: string; name: string };
  error.name = 'PrismaClientInitializationError';
  error.code = code;
  if (reason) error.reason = reason;
  return error;
}
