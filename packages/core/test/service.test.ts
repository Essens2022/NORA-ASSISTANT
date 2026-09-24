// TaskService: a replan must never wipe out a snooze or nudge NORA already promised.
import { describe, expect, it } from 'vitest';
import { TaskService } from '../src/service.ts';
import { MemoryStore } from '../src/memoryStore.ts';
import { DEFAULT_PREFERENCES, type Profile } from '../src/types.ts';

const USER = 'u1';
const profile: Profile = { id: USER, display_name: null, ui_lang: 'ro', conv_lang: 'ro', locale: 'ro-RO', timezone: 'Europe/Rome', prefs: { ...DEFAULT_PREFERENCES } };

describe('TaskService.plan() preserves pending snooze/nudge', () => {
  it('a timezone-only replan (no field change) keeps a pending snooze', async () => {
    const store = new MemoryStore(USER);
    const svc = new TaskService(store, profile);
    const task = await svc.create({ title: 'Dentist', kind: 'appointment', date: '2026-09-24', time: '10:00' });
    const snoozeUntil = new Date('2026-09-24T20:00:00Z');
    const snoozed = await svc.snooze(task, snoozeUntil);
    expect(store.reminders.some((r) => r.task_id === task.id && r.kind === 'snooze' && r.status === 'pending')).toBe(true);

    // simulate the x-timezone sync / an unrelated notes edit → replan() runs again
    await svc.replan(snoozed);

    const pending = store.reminders.filter((r) => r.task_id === task.id && r.status === 'pending');
    expect(pending.some((r) => r.kind === 'snooze')).toBe(true);
  });

  it('editing an unrelated field keeps a pending nudge', async () => {
    const store = new MemoryStore(USER);
    const svc = new TaskService(store, profile);
    const task = await svc.create({ title: 'Dentist', kind: 'appointment', date: '2026-09-24', time: '10:00' });
    store.reminders.push({ id: 'r_nudge', task_id: task.id, user_id: USER, kind: 'nudge', fire_at: '2026-09-24T08:10:00.000Z', status: 'pending', sound: 'normal', attempts: 0, last_error: null, action_token: 'tok', created_at: '', sent_at: null });

    await svc.update(task, { notes: 'bring the x-ray' });

    expect(store.reminders.some((r) => r.task_id === task.id && r.kind === 'nudge' && r.status === 'pending')).toBe(true);
  });

  it('snoozing itself still cancels the earlier snooze/nudge', async () => {
    const store = new MemoryStore(USER);
    const svc = new TaskService(store, profile);
    const task = await svc.create({ title: 'Dentist', kind: 'appointment', date: '2026-09-24', time: '10:00' });
    await svc.snooze(task, new Date('2026-09-24T20:00:00Z'));
    const again = (await store.getTask(task.id))!;
    await svc.snooze(again, new Date('2026-09-25T09:00:00Z'));

    const pendingSnoozes = store.reminders.filter((r) => r.task_id === task.id && r.kind === 'snooze' && r.status === 'pending');
    expect(pendingSnoozes).toHaveLength(1);
    expect(pendingSnoozes[0].fire_at).toBe('2026-09-25T09:00:00.000Z');
  });
});
