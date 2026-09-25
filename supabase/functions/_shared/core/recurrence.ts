// Minimal RRULE subset. A recurring task is ONE row that advances to its next
// occurrence when completed or when an occurrence passes – never 500 copies.
//
// Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY; INTERVAL=n; BYDAY=MO,TU (weekly)
// or BYDAY=1MO / -1FR (monthly "first Monday", "last Friday"); BYMONTHDAY=15|-1.

import { addDays, daysInMonth, diffDays, pad, weekdayOf } from './tz.ts';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface Rule {
  freq: Freq;
  interval: number;
  byDay: Array<{ day: number; nth: number | null }>;
  byMonthDay: number | null;
}

export function parseRule(rrule: string): Rule | null {
  const parts = new Map<string, string>();
  for (const seg of rrule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = seg.split('=');
    if (k && v) parts.set(k.trim().toUpperCase(), v.trim().toUpperCase());
  }
  const freq = parts.get('FREQ') as Freq | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 366) return null;
  const byDay: Rule['byDay'] = [];
  if (parts.has('BYDAY')) {
    for (const tok of parts.get('BYDAY')!.split(',')) {
      const m = tok.match(/^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/);
      if (!m) return null;
      const nth = m[1] ? Number(m[1]) : null;
      if (nth !== null && (nth === 0 || nth < -1 || nth > 5)) return null;
      byDay.push({ day: DAY_CODES.indexOf(m[2] as (typeof DAY_CODES)[number]), nth });
    }
  }
  let byMonthDay: number | null = null;
  if (parts.has('BYMONTHDAY')) {
    byMonthDay = Number(parts.get('BYMONTHDAY'));
    if (!Number.isInteger(byMonthDay) || byMonthDay === 0 || byMonthDay < -1 || byMonthDay > 31) return null;
  }
  return { freq, interval, byDay, byMonthDay };
}

export function isValidRule(rrule: unknown): rrule is string {
  return typeof rrule === 'string' && rrule.length < 200 && parseRule(rrule) !== null;
}

function nthWeekdayOfMonth(y: number, m: number, day: number, nth: number): string | null {
  const dim = daysInMonth(y, m);
  if (nth === -1) {
    for (let d = dim; d > dim - 7; d--) {
      const s = `${y}-${pad(m)}-${pad(d)}`;
      if (weekdayOf(s) === day) return s;
    }
    return null;
  }
  let count = 0;
  for (let d = 1; d <= dim; d++) {
    const s = `${y}-${pad(m)}-${pad(d)}`;
    if (weekdayOf(s) === day && ++count === nth) return s;
  }
  return null;
}

function matches(rule: Rule, date: string, anchor: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const [ay, am] = anchor.split('-').map(Number);
  switch (rule.freq) {
    case 'DAILY':
      return diffDays(anchor, date) % rule.interval === 0;
    case 'WEEKLY': {
      // week index relative to the anchor's Monday
      const anchorMon = addDays(anchor, -((weekdayOf(anchor) + 6) % 7));
      const weeks = Math.floor(diffDays(anchorMon, date) / 7);
      if (weeks % rule.interval !== 0) return false;
      const days = rule.byDay.length ? rule.byDay.map((b) => b.day) : [weekdayOf(anchor)];
      return days.includes(weekdayOf(date));
    }
    case 'MONTHLY': {
      const months = (y - ay) * 12 + (m - am);
      if (months % rule.interval !== 0) return false;
      if (rule.byDay.length) {
        return rule.byDay.some((b) => (b.nth === null ? weekdayOf(date) === b.day : nthWeekdayOfMonth(y, m, b.day, b.nth) === date));
      }
      const target = rule.byMonthDay ?? Number(anchor.slice(8, 10));
      const dim = daysInMonth(y, m);
      const want = target === -1 ? dim : Math.min(target, dim);
      return d === want;
    }
    case 'YEARLY': {
      if ((y - ay) % rule.interval !== 0) return false;
      return date.slice(5) === anchor.slice(5) || (anchor.slice(5) === '02-29' && date.slice(5) === '02-28' && daysInMonth(y, 2) === 28);
    }
  }
}

/**
 * First occurrence date strictly after `after` (YYYY-MM-DD). `anchor` is the
 * series start date (first occurrence) and defines phase for INTERVAL.
 */
export function nextOccurrence(rrule: string, anchor: string, after: string): string | null {
  const rule = parseRule(rrule);
  if (!rule) return null;
  let d = addDays(after, 1);
  if (d < anchor) d = anchor;
  // bounded scan: 3 years is enough for any supported rule
  for (let i = 0; i < 366 * 3 + 7; i++) {
    if (matches(rule, d, anchor)) return d;
    d = addDays(d, 1);
  }
  return null;
}

/** First occurrence on or after `from` (used when a recurring task is created). */
export function firstOccurrence(rrule: string, from: string): string | null {
  const rule = parseRule(rrule);
  if (!rule) return null;
  // For weekly/monthly rules with BYDAY the anchor itself may not match; scan.
  let d = from;
  for (let i = 0; i < 366 * 3 + 7; i++) {
    if (matches(rule, d, from) || (rule.freq !== 'DAILY' && matchesIgnoringPhase(rule, d))) return d;
    d = addDays(d, 1);
  }
  return null;
}

function matchesIgnoringPhase(rule: Rule, date: string): boolean {
  return matches({ ...rule, interval: 1 }, date, date.slice(0, 8) + (rule.byMonthDay ? pad(Math.max(1, rule.byMonthDay)) : date.slice(8)));
}
