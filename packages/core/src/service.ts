// Deterministic task operations. Used by the conversational engine AND by
// direct UI / notification actions (complete, snooze…) – no LLM involved.

import type { AITaskFields } from './ai.ts';
import type { PlannedReminder } from './reminders.ts';
import { computeStartAt, followupRetryMinutes, planReminders } from './reminders.ts';
import { firstOccurrence, nextOccurrence } from './recurrence.ts';
import { nextStatus, settledStatus } from './status.ts';
import type { Preferences, Profile, ReminderKind, Task, TaskEventType, TaskField, TaskStatus } from './types.ts';
import { toZoned } from './tz.ts';

export type NewTask = Omit<Task, 'id' | 'created_at' | 'updated_at'>;

export interface TaskQuery {
  from?: string | null;
  to?: string | null;
  text?: string | null;
  statuses?: TaskStatus[];
  limit?: number;
}

/** Persistence port. Implemented with Supabase in the edge functions and in memory in tests. */
export interface TaskStore {
  getTask(id: string): Promise<Task | null>;
  /** Must be idempotent on (user_id, client_request_id): on retry return the existing row with existed=true. */
  insertTask(row: NewTask): Promise<{ task: Task; existed: boolean }>;
  patchTask(id: string, patch: Partial<Task>): Promise<Task>;
  logEvent(taskId: string, type: TaskEventType, data?: Record<string, unknown>): Promise<void>;
  /** Cancel pending reminders of the given kinds (all when omitted) and insert `add`. */
  replaceReminders(taskId: string, add: PlannedReminder[], cancelKinds?: ReminderKind[]): Promise<void>;
  listTasks(q: TaskQuery): Promise<Task[]>;
}

export class TaskService {
  constructor(
    private store: TaskStore,
    private profile: Profile,
    private now: () => Date = () => new Date(),
  ) {}

  get prefs(): Preferences {
    return this.profile.prefs;
  }

  today(): string {
    return toZoned(this.now(), this.profile.timezone).date;
  }

  private derive(t: NewTask | Task, rescheduled = false): Partial<Task> {
    const start_at = computeStartAt(t, this.prefs);
    const keepStatus = ['reminded', 'acknowledged', 'in_progress'].includes(t.status) && !rescheduled;
    const status = t.status === 'completed' || t.status === 'cancelled' || keepStatus ? t.status : settledStatus(t, rescheduled);
    return { start_at, status };
  }

  private async plan(task: Task): Promise<void> {
    const planned = planReminders(task, this.prefs, this.now());
    await this.store.replaceReminders(task.id, planned);
  }

  async create(
    fields: AITaskFields & { title: string },
    opts: { requestId?: string | null; source?: string | null; missing?: TaskField[]; confidence?: number | null } = {},
  ): Promise<Task> {
    const tz = this.profile.timezone;
    let due_date = fields.date ?? null;
    let recurrence = fields.recurrence ?? null;
    const metadata: Record<string, unknown> = {};
    if (recurrence) {
      const first = firstOccurrence(recurrence, due_date ?? this.today());
      if (first) {
        due_date = first;
        metadata.rrule_anchor = first;
      } else recurrence = null;
    }
    const missing = (opts.missing ?? []).filter((f) => {
      if (f === 'date') return !due_date;
      if (f === 'time') return !fields.time;
      return true;
    });
    const row: NewTask = {
      user_id: this.profile.id,
      title: fields.title,
      notes: fields.notes ?? null,
      kind: fields.kind ?? 'generic',
      status: 'captured',
      priority: fields.priority ?? 'normal',
      due_date,
      due_time: fields.time ?? null,
      time_window: fields.time ? null : fields.time_window ?? null,
      timezone: tz,
      time_binding: fields.time_binding ?? 'floating',
      start_at: null,
      duration_min: fields.duration_min ?? null,
      location: fields.location ?? null,
      travel_min: fields.travel_min ?? null,
      buffer_min: fields.buffer_min ?? null,
      recurrence,
      missing_fields: missing,
      followup_count: 0,
      max_followups: this.prefs.max_followups,
      source_message: opts.source ?? null,
      confidence: opts.confidence ?? null,
      client_request_id: opts.requestId ?? null,
      completed_at: null,
      metadata,
    };
    Object.assign(row, this.derive(row));
    const { task, existed } = await this.store.insertTask(row);
    // A retried request returns the already-existing row: do not re-plan or re-log.
    if (!existed) {
      await this.store.logEvent(task.id, 'created', { source: opts.source ? 'conversation' : 'ui' });
      await this.plan(task);
    }
    return task;
  }

  async update(task: Task, changes: AITaskFields, clarified: TaskField[] = []): Promise<Task> {
    const patch: Partial<Task> = {};
    if (changes.title !== undefined) patch.title = changes.title;
    if (changes.notes !== undefined) patch.notes = changes.notes;
    if (changes.kind !== undefined) patch.kind = changes.kind;
    if (changes.priority !== undefined) patch.priority = changes.priority;
    if (changes.date !== undefined) patch.due_date = changes.date;
    if (changes.time !== undefined) {
      patch.due_time = changes.time;
      if (changes.time) patch.time_window = null;
    }
    if (changes.time_window !== undefined && !changes.time) patch.time_window = changes.time_window;
    if (changes.duration_min !== undefined) patch.duration_min = changes.duration_min;
    if (changes.location !== undefined) patch.location = changes.location;
    if (changes.travel_min !== undefined) patch.travel_min = changes.travel_min;
    if (changes.buffer_min !== undefined) patch.buffer_min = changes.buffer_min;
    if (changes.time_binding !== undefined) patch.time_binding = changes.time_binding;
    if (changes.recurrence !== undefined) {
      patch.recurrence = changes.recurrence;
      if (changes.recurrence) {
        const first = firstOccurrence(changes.recurrence, patch.due_date ?? task.due_date ?? this.today());
        if (first) {
          patch.due_date = first;
          patch.metadata = { ...task.metadata, rrule_anchor: first };
        }
      }
    }
    const next = { ...task, ...patch };
    // Filling a field resolves it; clearing the date on a dated task does not create a new question.
    next.missing_fields = task.missing_fields.filter((f) => {
      if (clarified.includes(f)) return false;
      if (f === 'date') return !next.due_date;
      if (f === 'time') return !next.due_time && !next.time_window;
      if (f === 'title') return !patch.title;
      if (f === 'travel') return !next.travel_min;
      if (f === 'location') return !next.location;
      return true;
    });
    patch.missing_fields = next.missing_fields;
    const timeChanged =
      (patch.due_date !== undefined && patch.due_date !== task.due_date) ||
      (patch.due_time !== undefined && patch.due_time !== task.due_time) ||
      (patch.time_window !== undefined && patch.time_window !== task.time_window);
    const wasScheduled = !!task.due_date && task.missing_fields.length === 0;
    const rescheduled = timeChanged && wasScheduled && !['captured', 'needs_clarification'].includes(task.status);
    if (task.status === 'missed' && timeChanged) patch.status = 'rescheduled';
    Object.assign(patch, this.derive({ ...next, status: patch.status ?? task.status }, rescheduled));
    if (timeChanged) patch.followup_count = 0;
    const saved = await this.store.patchTask(task.id, patch);
    const evt: TaskEventType = rescheduled ? 'rescheduled' : task.missing_fields.length && !saved.missing_fields.length ? 'clarified' : 'updated';
    await this.store.logEvent(task.id, evt, { changes });
    await this.plan(saved);
    return saved;
  }

  /** Complete; recurring tasks advance to their next occurrence instead. */
  async complete(task: Task): Promise<{ task: Task; nextDate: string | null }> {
    if (task.recurrence && task.due_date) {
      const anchor = (task.metadata?.rrule_anchor as string) ?? task.due_date;
      const after = task.due_date < this.today() ? this.today() : task.due_date;
      const next = nextOccurrence(task.recurrence, anchor, after);
      if (next) {
        const patch: Partial<Task> = { due_date: next, status: 'scheduled', followup_count: 0 };
        Object.assign(patch, this.derive({ ...task, ...patch }));
        const saved = await this.store.patchTask(task.id, patch);
        await this.store.logEvent(task.id, 'occurrence_completed', { date: task.due_date, next });
        await this.plan(saved);
        return { task: saved, nextDate: next };
      }
    }
    const saved = await this.store.patchTask(task.id, {
      status: nextStatus(task.status, 'complete'),
      completed_at: this.now().toISOString(),
    });
    await this.store.logEvent(task.id, 'completed');
    await this.store.replaceReminders(task.id, []);
    return { task: saved, nextDate: null };
  }

  async cancel(task: Task): Promise<Task> {
    const saved = await this.store.patchTask(task.id, { status: nextStatus(task.status, 'cancel') });
    await this.store.logEvent(task.id, 'cancelled');
    await this.store.replaceReminders(task.id, []);
    return saved;
  }

  async reopen(task: Task): Promise<Task> {
    const base = { ...task, status: nextStatus(task.status, 'reopen'), completed_at: null };
    const patch: Partial<Task> = { status: base.status, completed_at: null, followup_count: 0 };
    Object.assign(patch, this.derive(base));
    const saved = await this.store.patchTask(task.id, patch);
    await this.store.logEvent(task.id, 'reopened');
    await this.plan(saved);
    return saved;
  }

  /** Remind again at `until`. Earlier pending main/departure reminders are dropped; the follow-up moves after it. */
  async snooze(task: Task, until: Date): Promise<Task> {
    const add: PlannedReminder[] = [{ kind: 'snooze', fire_at: until.toISOString(), sound: this.prefs.sound }];
    if (this.prefs.followups) {
      add.push({ kind: 'followup', fire_at: new Date(until.getTime() + 60 * 60000).toISOString(), sound: this.prefs.sound === 'silent' ? 'silent' : 'normal' });
    }
    await this.store.replaceReminders(task.id, add, ['main', 'departure', 'snooze', 'followup']);
    const saved = ['reminded', 'missed'].includes(task.status) ? await this.store.patchTask(task.id, { status: 'acknowledged' }) : task;
    await this.store.logEvent(task.id, 'snoozed', { until: until.toISOString() });
    return saved;
  }

  /** User said "not yet" to a follow-up: retry later, or give up after max_followups. */
  async notYet(task: Task): Promise<{ task: Task; retryAt: Date | null }> {
    const count = task.followup_count + 1;
    if (count > task.max_followups) {
      const saved = await this.store.patchTask(task.id, { status: 'missed', followup_count: count });
      await this.store.logEvent(task.id, 'missed', { reason: 'max_followups' });
      await this.store.replaceReminders(task.id, []);
      return { task: saved, retryAt: null };
    }
    const retryAt = new Date(this.now().getTime() + followupRetryMinutes(count - 1) * 60000);
    const saved = await this.store.patchTask(task.id, { followup_count: count, status: 'acknowledged' });
    await this.store.replaceReminders(task.id, [{ kind: 'followup', fire_at: retryAt.toISOString(), sound: this.prefs.sound }], ['followup', 'snooze']);
    await this.store.logEvent(task.id, 'snoozed', { until: retryAt.toISOString(), reason: 'followup_not_yet' });
    return { task: saved, retryAt };
  }
}
