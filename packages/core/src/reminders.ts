// Reminder strategy. Different kinds of tasks need different reminders:
//   appointment / travel / document → evening-before prep, departure (if travel), main before start
//   call                            → at the time itself
//   payment                         → day before + morning of the due date
//   date-only / flexible            → at the window's time (morning/afternoon/evening/default)
// Every timed task gets a follow-up ("Did you manage?") unless disabled.

import type { DayWindow, Preferences, ReminderKind, SoundLevel, Task } from './types.ts';
import { addDays, hhmmToMinutes, minutesToHHMM, zonedToUtc } from './tz.ts';

export interface PlannedReminder {
  kind: ReminderKind;
  fire_at: string; // ISO UTC
  sound: SoundLevel;
}

export const WINDOW_TIME: Record<DayWindow, string | null> = {
  morning: '09:00',
  afternoon: '14:00',
  evening: '19:00',
  anytime: null,
};

type PlanTask = Pick<
  Task,
  'kind' | 'due_date' | 'due_time' | 'time_window' | 'timezone' | 'duration_min' | 'travel_min' | 'buffer_min' | 'priority' | 'status'
>;

/** Wall-clock time used for a date-only task. */
export function effectiveTime(t: Pick<Task, 'due_time' | 'time_window'>, prefs: Preferences): string {
  if (t.due_time) return t.due_time;
  return (t.time_window && WINDOW_TIME[t.time_window]) || prefs.default_time;
}

/** UTC start instant of a task (null when there is no date). */
export function computeStartAt(t: Pick<Task, 'due_date' | 'due_time' | 'time_window' | 'timezone'>, prefs: Preferences): string | null {
  if (!t.due_date) return null;
  return zonedToUtc(t.due_date, effectiveTime(t, prefs), t.timezone).toISOString();
}

/** Recommended local departure time, e.g. appointment 10:00, travel 150, buffer 30 → "07:00". */
export function departureTime(t: Pick<Task, 'due_time' | 'travel_min' | 'buffer_min'>, prefs: Preferences): string | null {
  if (!t.due_time || !t.travel_min) return null;
  const buffer = t.buffer_min ?? prefs.travel_buffer_min;
  const mins = hhmmToMinutes(t.due_time) - t.travel_min - buffer;
  // round down to 5 minutes – people leave "around 7", not at 07:03
  return minutesToHHMM(Math.floor(mins / 5) * 5);
}

function departureInstant(t: PlanTask, prefs: Preferences): Date | null {
  if (!t.due_date || !t.due_time || !t.travel_min) return null;
  const buffer = t.buffer_min ?? prefs.travel_buffer_min;
  const start = zonedToUtc(t.due_date, t.due_time, t.timezone).getTime();
  const mins = t.travel_min + buffer;
  const dep = start - mins * 60000;
  return new Date(Math.floor(dep / 300000) * 300000);
}

export function planReminders(t: PlanTask, prefs: Preferences, now: Date): PlannedReminder[] {
  if (!prefs.notifications || !t.due_date) return [];
  if (t.status === 'completed' || t.status === 'cancelled' || t.status === 'needs_clarification') return [];

  const out: PlannedReminder[] = [];
  const sound: SoundLevel = t.priority === 'high' && prefs.sound !== 'silent' ? 'important' : prefs.sound;
  const at = (date: string, time: string) => zonedToUtc(date, time, t.timezone);
  const push = (kind: ReminderKind, d: Date | null, s: SoundLevel = sound) => {
    if (d && d.getTime() > now.getTime() + 30_000) out.push({ kind, fire_at: d.toISOString(), sound: s });
  };

  const timed = !!t.due_time;
  const start = at(t.due_date, effectiveTime(t, prefs));

  switch (t.kind) {
    case 'payment':
      push('prep', at(addDays(t.due_date, -1), '10:00'));
      push('main', at(t.due_date, timed ? t.due_time! : '09:00'));
      break;
    case 'call':
      push('main', start);
      break;
    case 'appointment':
    case 'travel':
    case 'document': {
      if (prefs.day_before) {
        const eve = at(addDays(t.due_date, -1), prefs.evening_time);
        // only if it is really "the evening before" and not in the past
        if (eve.getTime() < start.getTime() - 6 * 3600_000) push('prep', eve, prefs.sound === 'silent' ? 'silent' : 'normal');
      }
      const dep = departureInstant(t, prefs);
      if (dep) {
        push('departure', new Date(dep.getTime() - 15 * 60000), sound); // "in ~15 min you should leave"
        push('main', dep, sound); // "leave now"
      } else if (timed) {
        push('main', new Date(start.getTime() - prefs.reminder_lead_min * 60000));
      } else {
        push('main', start);
      }
      break;
    }
    default:
      push('main', timed ? new Date(start.getTime() - (t.kind === 'generic' ? 0 : prefs.reminder_lead_min) * 60000) : start);
  }

  // If every "before" reminder is already in the past but the task is still ahead, remind at the start.
  if (!out.some((r) => r.kind === 'main' || r.kind === 'departure') && start.getTime() > now.getTime() + 60_000) {
    push('main', start);
  }

  if (prefs.followups) {
    const end = timed
      ? new Date(start.getTime() + (t.duration_min ?? (t.kind === 'call' ? 30 : 60)) * 60000)
      : at(t.due_date, prefs.evening_time);
    push('followup', timed ? new Date(end.getTime() + 15 * 60000) : end, prefs.sound === 'silent' ? 'silent' : 'normal');
  }
  return out.sort((a, b) => a.fire_at.localeCompare(b.fire_at));
}

export type SnoozePreset = '10m' | '30m' | '1h' | '2h' | 'tonight' | 'tomorrow';

/** Resolve a snooze to an instant. `tonight` = evening_time today (or +1h if already later). */
export function snoozeUntil(preset: SnoozePreset | number, now: Date, tz: string, prefs: Preferences, today: string): Date {
  if (typeof preset === 'number') return new Date(now.getTime() + preset * 60000);
  switch (preset) {
    case '10m':
      return new Date(now.getTime() + 10 * 60000);
    case '30m':
      return new Date(now.getTime() + 30 * 60000);
    case '1h':
      return new Date(now.getTime() + 60 * 60000);
    case '2h':
      return new Date(now.getTime() + 120 * 60000);
    case 'tonight': {
      const d = zonedToUtc(today, prefs.evening_time, tz);
      return d.getTime() > now.getTime() + 10 * 60000 ? d : new Date(now.getTime() + 60 * 60000);
    }
    case 'tomorrow':
      return zonedToUtc(addDays(today, 1), prefs.default_time, tz);
  }
}

/** Delay before re-asking after the user says "not yet" to a follow-up. */
export function followupRetryMinutes(count: number): number {
  return [120, 240, 24 * 60][Math.min(count, 2)];
}
