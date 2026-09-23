// Task state machine. Statuses are internal; the UI shows friendlier labels.
import type { Task, TaskStatus } from './types.ts';

export type TaskAction =
  | 'schedule'
  | 'need_clarification'
  | 'remind'
  | 'acknowledge'
  | 'start'
  | 'complete'
  | 'reopen'
  | 'miss'
  | 'reschedule'
  | 'cancel';

const OPEN: TaskStatus[] = ['captured', 'needs_clarification', 'scheduled', 'upcoming', 'reminded', 'acknowledged', 'in_progress', 'missed', 'rescheduled'];

const ALLOWED: Record<TaskAction, TaskStatus[]> = {
  schedule: OPEN,
  need_clarification: ['captured', 'needs_clarification', 'scheduled', 'rescheduled'],
  remind: ['scheduled', 'upcoming', 'rescheduled', 'reminded', 'acknowledged', 'captured'],
  acknowledge: ['reminded', 'upcoming', 'scheduled', 'rescheduled'],
  start: ['scheduled', 'upcoming', 'reminded', 'acknowledged', 'rescheduled', 'captured'],
  complete: OPEN,
  reopen: ['completed', 'cancelled', 'missed'],
  miss: ['scheduled', 'upcoming', 'reminded', 'acknowledged', 'rescheduled', 'in_progress'],
  reschedule: OPEN,
  cancel: OPEN,
};

const TARGET: Record<TaskAction, TaskStatus> = {
  schedule: 'scheduled',
  need_clarification: 'needs_clarification',
  remind: 'reminded',
  acknowledge: 'acknowledged',
  start: 'in_progress',
  complete: 'completed',
  reopen: 'scheduled',
  miss: 'missed',
  reschedule: 'rescheduled',
  cancel: 'cancelled',
};

export function canTransition(from: TaskStatus, action: TaskAction): boolean {
  return ALLOWED[action].includes(from);
}

export function nextStatus(from: TaskStatus, action: TaskAction): TaskStatus {
  if (!canTransition(from, action)) throw new Error(`invalid_transition:${from}->${action}`);
  return TARGET[action];
}

export function isOpen(status: TaskStatus): boolean {
  return OPEN.includes(status);
}

/** Status a task should have after its fields change (captured vs scheduled vs needs clarification). */
export function settledStatus(t: Pick<Task, 'status' | 'due_date' | 'missing_fields'>, rescheduled = false): TaskStatus {
  if (t.missing_fields.length > 0) return 'needs_clarification';
  if (!t.due_date) return 'captured';
  return rescheduled ? 'rescheduled' : 'scheduled';
}

/** UI bucket for the Activity screen. */
export type ActivityBucket = 'today' | 'upcoming' | 'inbox' | 'attention' | 'completed' | 'hidden';

export function activityBucket(t: Pick<Task, 'status' | 'due_date'>, today: string): ActivityBucket {
  if (t.status === 'completed') return 'completed';
  if (t.status === 'cancelled') return 'hidden';
  if (t.status === 'needs_clarification' || t.status === 'missed') return 'attention';
  if (!t.due_date) return 'inbox';
  if (t.due_date < today) return 'attention';
  if (t.due_date === today) return 'today';
  return 'upcoming';
}
