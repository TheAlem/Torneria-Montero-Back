import test from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveDueDate, isPastEffectiveDueDate } from '../src/services/dueDates.js';

test('getEffectiveDueDate treats date-only midnight as workshop end of day', () => {
  const effective = getEffectiveDueDate(new Date('2026-05-25T00:00:00.000Z'));
  assert.equal(effective?.toISOString(), '2026-05-25T21:00:00.000Z');
});

test('getEffectiveDueDate uses worker shift end for date-only deadlines', () => {
  const effective = getEffectiveDueDate(new Date('2026-05-25T00:00:00.000Z'), [
    { startMin: 8 * 60, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 15 * 60 + 30 },
  ]);
  assert.equal(effective?.toISOString(), '2026-05-25T19:30:00.000Z');
});

test('getEffectiveDueDate keeps explicit due time unchanged', () => {
  const dueAt = new Date('2026-05-25T19:00:00.000Z');
  const effective = getEffectiveDueDate(dueAt);
  assert.equal(effective?.toISOString(), '2026-05-25T19:00:00.000Z');
});

test('isPastEffectiveDueDate does not mark same-day date-only deadlines as overdue before end of day', () => {
  const dueAt = new Date('2026-05-25T00:00:00.000Z');
  assert.equal(isPastEffectiveDueDate(dueAt, new Date('2026-05-25T18:00:00.000Z')), false);
  assert.equal(isPastEffectiveDueDate(dueAt, new Date('2026-05-25T22:00:00.000Z')), true);
});
