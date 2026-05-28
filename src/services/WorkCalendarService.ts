import { prisma } from '../prisma/client.js';

export type WorkShift = { startMin: number; endMin: number };
export type WorkerSchedule = { shifts: WorkShift[]; workdays?: Set<number> } | null;

const DEFAULT_WORK_DAYS = process.env.WORKDAYS || '1-6';
const DEFAULT_WORKDAY_SHIFTS = process.env.WORKDAY_SHIFTS || '08:00-12:00,13:00-17:00';
const DEFAULT_WORKDAY_SHIFTS_SAT = process.env.WORKDAY_SHIFTS_SAT || '08:00-12:00';
const ETA_TIMEZONE_OFFSET_MIN = Number(process.env.ETA_TIMEZONE_OFFSET_MIN ?? -240);
const MAX_DAILY_WORK_MINUTES = Math.max(
  60,
  Math.min(24 * 60, Math.round((Number(process.env.WORKER_MAX_DAILY_HOURS ?? 8) || 8) * 60))
);
const ETA_TZ_OFFSET_MS = (Number.isFinite(ETA_TIMEZONE_OFFSET_MIN) ? ETA_TIMEZONE_OFFSET_MIN : -240) * 60 * 1000;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const parseHHMM = (value: string): { h: number; m: number } => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value || '');
  if (!match) return { h: 8, m: 0 };
  return {
    h: clamp(Number(match[1]), 0, 23),
    m: clamp(Number(match[2]), 0, 59),
  };
};

const capShiftsToDailyLimit = (shifts: WorkShift[]): WorkShift[] => {
  const ordered = [...shifts].sort((a, b) => a.startMin - b.startMin);
  const out: WorkShift[] = [];
  let remaining = MAX_DAILY_WORK_MINUTES;

  for (const shift of ordered) {
    if (remaining <= 0) break;
    const len = shift.endMin - shift.startMin;
    if (len <= 0) continue;

    if (len <= remaining) {
      out.push(shift);
      remaining -= len;
      continue;
    }

    out.push({ startMin: shift.startMin, endMin: shift.startMin + remaining });
    remaining = 0;
  }

  return out;
};

export const parseWorkShifts = (raw: string): WorkShift[] => {
  const shifts: WorkShift[] = [];
  const parts = (raw || '').split(',').map((part) => part.trim()).filter(Boolean);

  for (const part of parts) {
    const [startRaw, endRaw] = part.split('-').map((item) => (item || '').trim());
    if (!startRaw || !endRaw) continue;
    const start = parseHHMM(startRaw);
    const end = parseHHMM(endRaw);
    const startMin = start.h * 60 + start.m;
    const endMin = end.h * 60 + end.m;
    if (endMin > startMin) shifts.push({ startMin, endMin });
  }

  const capped = capShiftsToDailyLimit(shifts);
  return capped.length ? capped : [{ startMin: 8 * 60, endMin: 16 * 60 }];
};

export const parseWorkdays = (raw: string): Set<number> => {
  const parts = (raw || '').split(',').map((part) => part.trim()).filter(Boolean);
  const out = new Set<number>();

  for (const part of parts) {
    if (part.includes('-')) {
      const [fromRaw, toRaw] = part.split('-');
      const from = Number(fromRaw);
      const to = Number(toRaw);
      if (Number.isFinite(from) && Number.isFinite(to)) {
        for (let day = clamp(from, 0, 6); day <= clamp(to, 0, 6); day++) {
          out.add(day);
        }
      }
      continue;
    }

    const day = Number(part);
    if (Number.isFinite(day)) out.add(clamp(day, 0, 6));
  }

  if (!out.size) {
    for (let day = 1; day <= 6; day++) out.add(day);
  }

  return out;
};

const globalWorkdays = parseWorkdays(DEFAULT_WORK_DAYS);
const globalShifts = parseWorkShifts(DEFAULT_WORKDAY_SHIFTS);
const saturdayShifts = parseWorkShifts(DEFAULT_WORKDAY_SHIFTS_SAT);

function getShiftsForDay(dayIdx: number, schedule?: WorkerSchedule): WorkShift[] {
  const workdays = schedule?.workdays && schedule.workdays.size ? schedule.workdays : globalWorkdays;
  if (!workdays.has(dayIdx)) return [];
  if (schedule?.shifts?.length) return schedule.shifts;
  if (dayIdx === 6 && saturdayShifts.length) return saturdayShifts;
  return globalShifts;
}

function dayStartAt(day: Date, minuteOfDay: number) {
  const date = new Date(day);
  date.setUTCHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return date;
}

function toWorkshopWallClock(date: Date): Date {
  return new Date(date.getTime() + ETA_TZ_OFFSET_MS);
}

function fromWorkshopWallClock(date: Date): Date {
  return new Date(date.getTime() - ETA_TZ_OFFSET_MS);
}

function nextBusinessStart(fromWallClock: Date, schedule?: WorkerSchedule): Date {
  const base = new Date(fromWallClock);
  for (let dayOffset = 0; dayOffset < 370; dayOffset++) {
    const day = new Date(base);
    day.setUTCDate(base.getUTCDate() + dayOffset);
    day.setUTCHours(0, 0, 0, 0);
    const shifts = getShiftsForDay(day.getUTCDay(), schedule);

    for (const shift of shifts) {
      const start = dayStartAt(day, shift.startMin);
      if (start.getTime() > fromWallClock.getTime()) return start;
    }
  }

  return new Date(fromWallClock);
}

function forwardBusinessSecondsWallClock(from: Date, to: Date, schedule?: WorkerSchedule): number {
  let total = 0;
  let cursor = new Date(from);
  let guard = 0;

  while (cursor < to && guard < 3700) {
    const day = new Date(cursor);
    day.setUTCHours(0, 0, 0, 0);
    const shifts = getShiftsForDay(day.getUTCDay(), schedule);

    for (const shift of shifts) {
      const start = dayStartAt(day, shift.startMin);
      const end = dayStartAt(day, shift.endMin);
      const fromPoint = cursor > start ? cursor : start;
      const toPoint = to < end ? to : end;
      if (toPoint > fromPoint) {
        total += Math.round((toPoint.getTime() - fromPoint.getTime()) / 1000);
      }
    }

    cursor = new Date(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard++;
  }

  return total;
}

function addBusinessSecondsWallClock(from: Date, seconds: number, schedule?: WorkerSchedule): Date {
  let remaining = Math.max(0, Math.round(seconds));
  let cursor = new Date(from);
  let guard = 0;

  if (remaining <= 0) return cursor;

  while (remaining > 0 && guard < 5000) {
    const shifts = getShiftsForDay(cursor.getUTCDay(), schedule);
    let advancedInDay = false;

    for (const shift of shifts) {
      const start = dayStartAt(cursor, shift.startMin);
      const end = dayStartAt(cursor, shift.endMin);
      if (cursor < start) cursor = new Date(start);
      if (cursor >= end) continue;

      const slotSec = Math.floor((end.getTime() - cursor.getTime()) / 1000);
      if (slotSec <= 0) continue;
      advancedInDay = true;

      if (remaining <= slotSec) {
        return new Date(cursor.getTime() + remaining * 1000);
      }

      remaining -= slotSec;
      cursor = new Date(end);
    }

    cursor = advancedInDay
      ? nextBusinessStart(new Date(cursor.getTime() + 1000), schedule)
      : nextBusinessStart(cursor, schedule);
    guard++;
  }

  return cursor;
}

function normalizeSchedule(shifts?: WorkShift[], workdays?: Set<number>): WorkerSchedule {
  if (!shifts?.length && !workdays?.size) return null;
  return { shifts: shifts ?? [], workdays };
}

export async function getWorkerSchedule(workerId: number): Promise<WorkerSchedule> {
  try {
    const worker = await prisma.trabajadores.findUnique({
      where: { id: workerId },
      select: { disponibilidad: true },
    });
    const disponibilidad = worker?.disponibilidad as any;
    if (!disponibilidad || typeof disponibilidad !== 'object') return null;

    const shifts = Array.isArray(disponibilidad.shifts)
      ? parseWorkShifts(disponibilidad.shifts.join(','))
      : [];
    const workdays = Array.isArray(disponibilidad.days)
      ? new Set<number>(
          disponibilidad.days
            .map((day: any) => Number(day))
            .filter((day: number) => Number.isFinite(day) && day >= 0 && day <= 6)
        )
      : undefined;

    if (!shifts.length && !workdays?.size) return null;
    return { shifts, workdays };
  } catch {
    return null;
  }
}

export function businessSecondsBetween(
  start: Date,
  end: Date,
  customShifts?: WorkShift[],
  customWorkdays?: Set<number>
): number {
  if (!start || !end || end <= start) return 0;
  const schedule = normalizeSchedule(customShifts, customWorkdays);
  return forwardBusinessSecondsWallClock(toWorkshopWallClock(start), toWorkshopWallClock(end), schedule);
}

export function businessSecondsBetweenSigned(
  from: Date,
  to: Date,
  schedule?: WorkerSchedule
): number {
  if (from.getTime() === to.getTime()) return 0;
  const fromWall = toWorkshopWallClock(from);
  const toWall = toWorkshopWallClock(to);
  if (toWall > fromWall) return forwardBusinessSecondsWallClock(fromWall, toWall, schedule);
  return -forwardBusinessSecondsWallClock(toWall, fromWall, schedule);
}

export async function calculateSuggestedDueDate(
  estimatedSec: number,
  workerId?: number | null,
  fromDate = new Date()
): Promise<Date> {
  const schedule = workerId ? await getWorkerSchedule(workerId) : null;
  const dueWallClock = addBusinessSecondsWallClock(toWorkshopWallClock(fromDate), estimatedSec, schedule);
  return fromWorkshopWallClock(dueWallClock);
}

export function getLatestShiftEndMinute(shifts?: WorkShift[] | null): number | null {
  const ends = (shifts || [])
    .map((shift) => Number(shift.endMin))
    .filter((end) => Number.isFinite(end) && end > 0)
    .sort((a, b) => b - a);
  return ends[0] ?? null;
}
