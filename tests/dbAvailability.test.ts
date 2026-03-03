import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransientDatabaseError,
  getDatabaseErrorPublicInfo,
  getDatabaseStatusSnapshot,
  isDatabaseRecentlyDown,
  isRetryableDatabaseError,
  markDatabaseDown,
  markDatabaseUp,
} from '../src/prisma/dbAvailability.js';

test('maps prisma connectivity errors to DB_SLEEPING public metadata', () => {
  const info = getDatabaseErrorPublicInfo({
    name: 'PrismaClientKnownRequestError',
    code: 'P1001',
    message: "Can't reach database server at `example.neon.tech`",
  });
  assert.ok(info);
  assert.equal(info?.code, 'DB_SLEEPING');
  assert.equal(info?.effect, 'db-sleeping');
  assert.equal(info?.retryAfterSec, 4);
});

test('retryable classifier excludes non-transient prisma constraint errors', () => {
  const retryable = isRetryableDatabaseError({
    name: 'PrismaClientKnownRequestError',
    code: 'P2002',
    message: 'Unique constraint failed',
  });
  assert.equal(retryable, false);
});

test('database state transitions from down to up', () => {
  markDatabaseDown(
    {
      name: 'PrismaClientInitializationError',
      code: 'P1002',
      message: 'Database timed out',
    },
    { source: 'test-down' }
  );
  let snapshot = getDatabaseStatusSnapshot();
  assert.equal(snapshot.status, 'down');
  assert.equal(snapshot.available, false);

  markDatabaseUp({ source: 'test-up', latencyMs: 123 });
  snapshot = getDatabaseStatusSnapshot();
  assert.equal(snapshot.status, 'up');
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.latencyMs, 123);
});

test('recent-down helper and transient error factory behave as expected', () => {
  markDatabaseDown(
    {
      name: 'PrismaClientInitializationError',
      code: 'P1001',
      message: "Can't reach database server",
    },
    { source: 'test-recent-down' }
  );
  assert.equal(isDatabaseRecentlyDown(10_000), true);
  assert.equal(isDatabaseRecentlyDown(0), false);

  const err = createTransientDatabaseError('P1002', 'Timed out');
  assert.equal(err.name, 'PrismaClientInitializationError');
  assert.equal((err as any).code, 'P1002');
});
