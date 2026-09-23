import { describe, expect, it } from 'vitest';
import { firstOccurrence, nextOccurrence, parseRule } from '../src/recurrence.ts';
import { departureTime, planReminders, snoozeUntil } from '../src/reminders.ts';
import { activityBucket, canTransition, nextStatus } from '../src/status.ts';
import { validatePlan } from '../src/ai.ts';
import { toZoned, zonedToUtc } from '../src/tz.ts';
import { DEFAULT_PREFERENCES, type Task } from '../src/types.ts';
import { describeRule, formatWhen } from '../src/replies.ts';

describe('timezones', () => {
  it('converts local → UTC across DST', () => {
    expect(zonedToUtc('2026-09-24', '10:00', 'Europe/Rome').toISOString()).toBe('2026-09-24T08:00:00.000Z');
    expect(zonedToUtc('2026-12-24', '10:00', 'Europe/Rome').toISOString()).toBe('2026-12-24T09:00:00.000Z');
    expect(zonedToUtc('2026-09-24', '10:00', 'America/New_York').toISOString()).toBe('2026-09-24T14:00:00.000Z');
    // spring-forward day in Rome: 2026-03-29
    expect(zonedToUtc('2026-03-29', '10:00', 'Europe/Rome').toISOString()).toBe('2026-03-29T08:00:00.000Z');
  });
  it('same task, different traveller timezone', () => {
    const rome = zonedToUtc('2026-09-24', '09:00', 'Europe/Rome');
    const london = zonedToUtc('2026-09-24', '09:00', 'Europe/London');
    expect(london.getTime() - rome.getTime()).toBe(3600_000);
    expect(toZoned(rome, 'Europe/London').time).toBe('08:00');
  });
});

describe('recurrence', () => {
  it('parses and rejects', () => {
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO')).toBeTruthy();
    expect(parseRule('FREQ=HOURLY')).toBeNull();
    expect(parseRule('FREQ=MONTHLY;BYDAY=0MO')).toBeNull();
  });
  it('every Monday', () => {
    expect(firstOccurrence('FREQ=WEEKLY;BYDAY=MO', '2026-09-23')).toBe('2026-09-28');
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=MO', '2026-09-28', '2026-09-28')).toBe('2026-10-05');
  });
  it('every weekday', () => {
    const r = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    expect(nextOccurrence(r, '2026-09-25', '2026-09-25')).toBe('2026-09-28'); // Fri → Mon
  });
  it('every 2 weeks', () => {
    expect(nextOccurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', '2026-09-29', '2026-09-29')).toBe('2026-10-13');
  });
  it('every 15th and last day', () => {
    expect(nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=15', '2026-09-15', '2026-09-15')).toBe('2026-10-15');
    expect(firstOccurrence('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-09-23')).toBe('2026-09-30');
    expect(nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=31', '2026-01-31', '2026-01-31')).toBe('2026-02-28');
  });
  it('first Monday of month', () => {
    expect(firstOccurrence('FREQ=MONTHLY;BYDAY=1MO', '2026-09-23')).toBe('2026-10-05');
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=1MO', '2026-10-05', '2026-10-05')).toBe('2026-11-02');
  });
  it('daily and yearly', () => {
    expect(nextOccurrence('FREQ=DAILY', '2026-09-23', '2026-09-23')).toBe('2026-09-24');
    expect(nextOccurrence('FREQ=YEARLY', '2026-03-10', '2026-03-10')).toBe('2027-03-10');
  });
  it('describes', () => {
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO', '08:00', 'ro', null)).toBe('în fiecare luni la 8');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO', '08:00', 'en', null)).toBe('every Monday at 8 AM');
    expect(describeRule('FREQ=WEEKLY;BYDAY=WE', '08:00', 'ru', null)).toBe('каждую среду в 8');
  });
});

const base = (over: Partial<Task> = {}): Task => ({
  id: 't', user_id: 'u', title: 'X', notes: null, kind: 'generic', status: 'scheduled', priority: 'normal',
  due_date: '2026-09-24', due_time: '10:00', time_window: null, timezone: 'Europe/Rome', time_binding: 'floating',
  start_at: null, duration_min: null, location: null, travel_min: null, buffer_min: null, recurrence: null,
  missing_fields: [], followup_count: 0, max_followups: 3, source_message: null, confidence: null, client_request_id: null,
  created_at: '', updated_at: '', completed_at: null, metadata: {}, ...over,
});
const now = new Date('2026-09-23T12:00:00Z'); // 14:00 Rome, Wednesday

describe('reminders', () => {
  it('consulate: 10:00, travel 2h30, buffer 30 → leave at 07:00', () => {
    const t = base({ kind: 'appointment', travel_min: 150 });
    expect(departureTime(t, DEFAULT_PREFERENCES)).toBe('07:00');
    const r = planReminders(t, DEFAULT_PREFERENCES, now);
    expect(r.map((x) => [x.kind, toZoned(x.fire_at, 'Europe/Rome').date + ' ' + toZoned(x.fire_at, 'Europe/Rome').time])).toEqual([
      ['prep', '2026-09-23 20:00'],
      ['departure', '2026-09-24 06:45'],
      ['main', '2026-09-24 07:00'],
      ['followup', '2026-09-24 11:15'],
    ]);
  });
  it('call at the exact time', () => {
    const r = planReminders(base({ kind: 'call', due_time: '09:00' }), DEFAULT_PREFERENCES, now);
    expect(r[0]).toMatchObject({ kind: 'main', fire_at: '2026-09-24T07:00:00.000Z' });
  });
  it('appointment uses lead time preference', () => {
    const r = planReminders(base({ kind: 'appointment' }), { ...DEFAULT_PREFERENCES, reminder_lead_min: 60, day_before: false }, now);
    expect(r[0]).toMatchObject({ kind: 'main', fire_at: '2026-09-24T07:00:00.000Z' });
  });
  it('date-only task uses window / default time', () => {
    const r = planReminders(base({ due_time: null, time_window: 'evening' }), DEFAULT_PREFERENCES, now);
    expect(toZoned(r[0].fire_at, 'Europe/Rome').time).toBe('19:00');
    const r2 = planReminders(base({ due_time: null }), DEFAULT_PREFERENCES, now);
    expect(toZoned(r2[0].fire_at, 'Europe/Rome').time).toBe('09:00');
  });
  it('no reminders in the past, none for inbox or disabled notifications', () => {
    expect(planReminders(base({ due_date: '2026-09-20' }), DEFAULT_PREFERENCES, now)).toEqual([]);
    expect(planReminders(base({ due_date: null }), DEFAULT_PREFERENCES, now)).toEqual([]);
    expect(planReminders(base(), { ...DEFAULT_PREFERENCES, notifications: false }, now)).toEqual([]);
  });
  it('snooze presets', () => {
    expect(snoozeUntil('30m', now, 'Europe/Rome', DEFAULT_PREFERENCES, '2026-09-23').toISOString()).toBe('2026-09-23T12:30:00.000Z');
    expect(toZoned(snoozeUntil('tonight', now, 'Europe/Rome', DEFAULT_PREFERENCES, '2026-09-23'), 'Europe/Rome').time).toBe('20:00');
    expect(toZoned(snoozeUntil('tomorrow', now, 'Europe/Rome', DEFAULT_PREFERENCES, '2026-09-23'), 'Europe/Rome').date).toBe('2026-09-24');
  });
});

describe('state machine', () => {
  it('allows and rejects', () => {
    expect(nextStatus('scheduled', 'complete')).toBe('completed');
    expect(canTransition('completed', 'complete')).toBe(false);
    expect(canTransition('cancelled', 'reopen')).toBe(true);
    expect(() => nextStatus('cancelled', 'remind')).toThrow();
  });
  it('activity buckets', () => {
    expect(activityBucket({ status: 'scheduled', due_date: '2026-09-23' }, '2026-09-23')).toBe('today');
    expect(activityBucket({ status: 'scheduled', due_date: '2026-09-25' }, '2026-09-23')).toBe('upcoming');
    expect(activityBucket({ status: 'needs_clarification', due_date: null }, '2026-09-23')).toBe('attention');
    expect(activityBucket({ status: 'captured', due_date: null }, '2026-09-23')).toBe('inbox');
    expect(activityBucket({ status: 'scheduled', due_date: '2026-09-20' }, '2026-09-23')).toBe('attention');
  });
});

describe('AI plan validation', () => {
  it('keeps valid actions, drops invalid ones', () => {
    const { plan, errors } = validatePlan(
      JSON.stringify({
        language: 'ro',
        actions: [
          { type: 'create_task', task: { title: 'Dentist', kind: 'appointment', date: '2026-09-24', time: '9:00' } },
          { type: 'create_task', task: { title: 'Bad', date: '2026-02-31' } },
          { type: 'drop_database' },
          { type: 'update_task', ref: 't1', changes: {} },
          { type: 'create_task', task: { kind: 'call' } },
        ],
        ask: null,
        reply: 'ok',
      }),
      'en',
    );
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0]).toMatchObject({ type: 'create_task', task: { time: '09:00' } });
    expect(plan.actions[1]).toMatchObject({ type: 'create_task', task: { title: 'Bad' } });
    expect((plan.actions[1] as { task: { date?: string } }).task.date).toBeUndefined();
    expect(errors).toEqual(expect.arrayContaining(['bad_date:2026-02-31', 'unknown_action:drop_database', 'empty_update', 'create_without_title']));
  });
  it('survives garbage', () => {
    expect(validatePlan('not json', 'it').plan).toEqual({ language: 'it', actions: [], ask: null, reply: '' });
    expect(validatePlan('```json\n{"language":"ru","actions":[],"reply":"Привет"}\n```', 'en').plan.reply).toBe('Привет');
  });
});

describe('formatWhen', () => {
  it('speaks naturally', () => {
    expect(formatWhen('2026-09-24', '09:00', '2026-09-23', 'ro')).toBe('mâine la 9');
    expect(formatWhen('2026-09-29', '10:30', '2026-09-23', 'ro')).toBe('marți la 10:30');
    expect(formatWhen('2026-10-15', null, '2026-09-23', 'ro')).toBe('pe 15 octombrie');
    expect(formatWhen('2026-09-24', '09:00', '2026-09-23', 'en')).toBe('tomorrow at 9 AM');
    expect(formatWhen('2026-09-24', '13:00', '2026-09-23', 'it')).toBe('domani alle 13');
    expect(formatWhen('2026-09-24', '01:00', '2026-09-23', 'it')).toBe("domani all'una");
    expect(formatWhen('2026-09-29', '10:00', '2026-09-23', 'ru')).toBe('во вторник в 10');
  });
});
