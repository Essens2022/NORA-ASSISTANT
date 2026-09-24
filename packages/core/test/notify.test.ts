import { describe, expect, it } from 'vitest';
import { buildNotification, nudgePlan } from '../src/notify.ts';
import { DEFAULT_PREFERENCES, type Task } from '../src/types.ts';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', user_id: 'u', title: 'Sună contabilul', notes: null, kind: 'call', status: 'scheduled', priority: 'normal',
  due_date: '2026-09-24', due_time: '09:00', time_window: null, timezone: 'Europe/Rome', time_binding: 'floating',
  start_at: '2026-09-24T07:00:00.000Z', duration_min: null, location: null, travel_min: null, buffer_min: null, recurrence: null,
  missing_fields: [], followup_count: 0, max_followups: 3, source_message: null, confidence: null, client_request_id: null,
  created_at: '', updated_at: '', completed_at: null, metadata: {}, ...over,
});
const rem = (kind: 'main' | 'followup' | 'nudge' | 'departure' | 'prep') => ({ kind, sound: 'normal' as const, action_token: 'tok' });
const at = new Date('2026-09-24T07:00:00Z'); // 09:00 Rome

describe('notifications call the person', () => {
  it('at the time: by name, one clear sentence, done/snooze', () => {
    const n = buildNotification(rem('main'), task(), 'ro', DEFAULT_PREFERENCES, '2026-09-24', { name: 'Ion', now: at });
    expect(n.title).toBe('Ion, e momentul: Sună contabilul');
    expect(n.body).toBe('Acum, la 9. Te ocupi?');
    expect(n.actions.map((a) => a.action)).toEqual(['done', 'snooze']);
  });
  it('before the time: countdown', () => {
    const n = buildNotification(rem('main'), task({ kind: 'appointment', title: 'Dentist', location: 'Str. Roma 12' }), 'ro', DEFAULT_PREFERENCES, '2026-09-24', { now: new Date('2026-09-24T06:30:00Z') });
    expect(n.title).toBe('În 30 min: Dentist');
    expect(n.body).toBe('La 9 · Str. Roma 12. Te anunț la timp.');
  });
  it('leave now, with travel time', () => {
    const n = buildNotification(rem('main'), task({ kind: 'appointment', title: 'Consulat', due_time: '10:00', travel_min: 150 }), 'ro', DEFAULT_PREFERENCES, '2026-09-24', { name: 'Ion' });
    expect(n.title).toBe('Ion, e timpul să pleci');
    expect(n.body).toBe('Consulat la 10. Dacă pleci acum, ajungi fără grabă.');
    expect(n.sticky).toBe(true);
  });
  it('evening before', () => {
    const n = buildNotification(rem('prep'), task({ kind: 'appointment', title: 'Consulat', due_time: '10:00', travel_min: 150 }), 'ro', DEFAULT_PREFERENCES, '2026-09-23');
    expect(n.title).toBe('Mâine: Consulat');
    expect(n.body).toBe('La 10. Pleci pe la 7. Ai pregătit tot ce-ți trebuie?');
  });
  it('calls again and asks if it got done', () => {
    expect(buildNotification(rem('nudge'), task(), 'ro', DEFAULT_PREFERENCES, '2026-09-24', { name: 'Ion' }).title).toBe('Ion, încă te aștept');
    const f = buildNotification(rem('followup'), task(), 'ro', DEFAULT_PREFERENCES, '2026-09-24', { name: 'Ion' });
    expect(f.title).toBe('Ion, ai rezolvat?');
    expect(f.chat).toBe('Ai rezolvat: Sună contabilul?');
    expect(f.actions.map((a) => a.action)).toEqual(['done', 'notyet']);
  });
  it('speaks every language', () => {
    expect(buildNotification(rem('main'), task(), 'en', DEFAULT_PREFERENCES, '2026-09-24', { name: 'Ion', now: at }).title).toBe("Ion, it's time: Sună contabilul");
    expect(buildNotification(rem('main'), task(), 'it', DEFAULT_PREFERENCES, '2026-09-24', { now: at }).body).toBe('Adesso, alle 9. Te ne occupi?');
    expect(buildNotification(rem('main'), task(), 'ru', DEFAULT_PREFERENCES, '2026-09-24', { now: at }).title).toBe('Пора: Sună contabilul');
  });
});

describe('nudge plan (call again when there is no reaction)', () => {
  const sent = new Date('2026-09-24T07:00:00Z');
  const mins = (p: 'low' | 'normal' | 'high') => nudgePlan('main', p, DEFAULT_PREFERENCES, sent).map((n) => (Date.parse(n.fire_at) - sent.getTime()) / 60000);
  it('keeps calling until answered: normal for 2 h, high more often, low twice', () => {
    expect(mins('normal')).toEqual([10, 20, 35, 55, 80, 120]);
    expect(mins('high')).toEqual([5, 10, 20, 30, 45, 60, 90, 120]);
    expect(mins('low')).toEqual([30, 90]);
    expect(nudgePlan('main', 'high', DEFAULT_PREFERENCES, sent).every((n) => n.sound === 'important')).toBe(true);
  });
  it('never in silent mode, with notifications off, for prep or follow-ups', () => {
    expect(nudgePlan('main', 'normal', { ...DEFAULT_PREFERENCES, notifications: false }, sent)).toEqual([]);
    expect(nudgePlan('main', 'normal', { ...DEFAULT_PREFERENCES, sound: 'silent' }, sent)).toEqual([]);
    expect(nudgePlan('prep', 'high', DEFAULT_PREFERENCES, sent)).toEqual([]);
    expect(nudgePlan('followup', 'high', DEFAULT_PREFERENCES, sent)).toEqual([]);
  });
});
