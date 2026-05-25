export type DueDateShift = { startMin: number; endMin: number };

const WORKSHOP_TZ_OFFSET_MIN = Number(process.env.ETA_TIMEZONE_OFFSET_MIN ?? -240);
const DEFAULT_END_MIN = (() => {
  const raw = Number(process.env.DATE_ONLY_DUE_END_MIN ?? 17 * 60);
  return Number.isFinite(raw) ? Math.max(0, Math.min(23 * 60 + 59, Math.round(raw))) : 17 * 60;
})();

const tzOffsetMin = Number.isFinite(WORKSHOP_TZ_OFFSET_MIN) ? WORKSHOP_TZ_OFFSET_MIN : -240;

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isLocalMidnight(value: Date) {
  return value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0 && value.getMilliseconds() === 0;
}

function isUtcMidnight(value: Date) {
  return value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0;
}

function resolveEndMin(shifts?: DueDateShift[] | null) {
  const shiftEnd = (shifts || [])
    .map((shift) => Number(shift.endMin))
    .filter((endMin) => Number.isFinite(endMin) && endMin > 0)
    .sort((a, b) => b - a)[0];

  return Number.isFinite(shiftEnd)
    ? Math.max(0, Math.min(23 * 60 + 59, Math.round(shiftEnd)))
    : DEFAULT_END_MIN;
}

function fromWorkshopWallClock(year: number, monthIndex: number, day: number, minuteOfDay: number) {
  const utcMs = Date.UTC(year, monthIndex, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return new Date(utcMs - tzOffsetMin * 60 * 1000);
}

/**
 * A due date stored at 00:00 usually came from a date-only selection.
 * Operationally, that means the promised workshop day, not midnight.
 */
export function getEffectiveDueDate(dueAt?: Date | string | null, shifts?: DueDateShift[] | null): Date | null {
  const raw = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  if (!isValidDate(raw)) return null;

  if (isLocalMidnight(raw)) {
    return fromWorkshopWallClock(raw.getFullYear(), raw.getMonth(), raw.getDate(), resolveEndMin(shifts));
  }

  if (isUtcMidnight(raw)) {
    return fromWorkshopWallClock(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), resolveEndMin(shifts));
  }

  return new Date(raw);
}

export function isPastEffectiveDueDate(
  dueAt?: Date | string | null,
  now: Date = new Date(),
  graceMinutes = 0,
  shifts?: DueDateShift[] | null
) {
  const effectiveDueAt = getEffectiveDueDate(dueAt, shifts);
  if (!effectiveDueAt) return false;
  const graceMs = Math.max(0, graceMinutes) * 60 * 1000;
  return now.getTime() > effectiveDueAt.getTime() + graceMs;
}
