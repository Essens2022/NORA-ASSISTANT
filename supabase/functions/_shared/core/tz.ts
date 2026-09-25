// Dependency-free timezone helpers built on Intl. Good enough for reminder
// scheduling (minute precision) and DST-safe.

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    dtf(tz);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function toZoned(instant: Date | number | string, tz: string): ZonedParts {
  const d = new Date(instant);
  const parts: Record<string, string> = {};
  for (const p of dtf(tz).formatToParts(d)) parts[p.type] = p.value;
  const year = +parts.year;
  const month = +parts.month;
  const day = +parts.day;
  const hour = +parts.hour % 24;
  const minute = +parts.minute;
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: WD[parts.weekday],
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${pad(hour)}:${parts.minute}`,
  };
}

/** Offset of `tz` from UTC at the given instant, in minutes (e.g. +120 for CEST). */
export function tzOffsetMin(instant: number, tz: string): number {
  const z = toZoned(instant, tz);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute);
  const floored = Math.floor(instant / 60000) * 60000;
  return Math.round((asUtc - floored) / 60000);
}

/** Convert a local wall-clock date + time in `tz` to a UTC Date. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMin(guess, tz);
  let result = guess - off * 60000;
  // Re-evaluate once around DST transitions.
  const off2 = tzOffsetMin(result, tz);
  if (off2 !== off) {
    off = off2;
    result = guess - off * 60000;
  }
  return new Date(result);
}

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function diffDays(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function minutesToHHMM(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function isValidTime(s: unknown): s is string {
  return typeof s === 'string' && TIME_RE.test(s);
}
