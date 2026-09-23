// Domain types shared by the web app, the edge functions and (later) native clients.
// Imports inside core always use explicit `.ts` extensions so the same files
// run unchanged under Vite, Vitest and Deno (Supabase Edge Functions).

export const LANGS = ['en', 'ro', 'it', 'ru'] as const;
export type Lang = (typeof LANGS)[number];

export const TASK_STATUSES = [
  'captured',
  'needs_clarification',
  'scheduled',
  'upcoming',
  'reminded',
  'acknowledged',
  'in_progress',
  'completed',
  'missed',
  'rescheduled',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_KINDS = ['appointment', 'call', 'payment', 'shopping', 'travel', 'document', 'generic'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const PRIORITIES = ['low', 'normal', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DAY_WINDOWS = ['morning', 'afternoon', 'evening', 'anytime'] as const;
export type DayWindow = (typeof DAY_WINDOWS)[number];

/** Fields NORA may still need from the user. */
export const TASK_FIELDS = ['title', 'date', 'time', 'location', 'travel'] as const;
export type TaskField = (typeof TASK_FIELDS)[number];

/**
 * `floating`: the task happens at the given wall-clock time wherever the user is
 * (e.g. "take pills at 8"). `absolute`: pinned to `timezone` (e.g. a meeting in Rome).
 */
export type TimeBinding = 'floating' | 'absolute';

export interface Task {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  kind: TaskKind;
  status: TaskStatus;
  priority: Priority;
  /** Local calendar date, YYYY-MM-DD, in `timezone`. */
  due_date: string | null;
  /** Local wall-clock time, HH:MM (24h). */
  due_time: string | null;
  time_window: DayWindow | null;
  timezone: string;
  time_binding: TimeBinding;
  /** UTC instant derived from due_date + due_time (+ window) in timezone. */
  start_at: string | null;
  duration_min: number | null;
  location: string | null;
  travel_min: number | null;
  buffer_min: number | null;
  /** RRULE subset, e.g. "FREQ=WEEKLY;BYDAY=MO". */
  recurrence: string | null;
  missing_fields: TaskField[];
  followup_count: number;
  max_followups: number;
  source_message: string | null;
  confidence: number | null;
  client_request_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export type ReminderKind = 'prep' | 'departure' | 'main' | 'followup' | 'snooze';
export type ReminderStatus = 'pending' | 'sent' | 'cancelled' | 'failed';

export interface Reminder {
  id: string;
  task_id: string;
  user_id: string;
  kind: ReminderKind;
  fire_at: string;
  status: ReminderStatus;
  sound: SoundLevel;
  action_token: string;
  attempts: number;
  sent_at: string | null;
}

export type SoundLevel = 'silent' | 'normal' | 'important';

export interface Preferences {
  /** Minutes before a timed task for the main reminder. */
  reminder_lead_min: number;
  /** Default buffer added to travel time before departure. */
  travel_buffer_min: number;
  /** Remind the evening before appointments. */
  day_before: boolean;
  /** Local time for date-only / "anytime" tasks. */
  default_time: string;
  /** Local time for the evening-before reminder. */
  evening_time: string;
  followups: boolean;
  max_followups: number;
  sound: SoundLevel;
  notifications: boolean;
  hour12: boolean | null;
  personalization: boolean;
  voice_replies: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  reminder_lead_min: 30,
  travel_buffer_min: 30,
  day_before: true,
  default_time: '09:00',
  evening_time: '20:00',
  followups: true,
  max_followups: 3,
  sound: 'normal',
  notifications: true,
  hour12: null,
  personalization: true,
  voice_replies: true,
};

export interface Profile {
  id: string;
  display_name: string | null;
  ui_lang: Lang;
  conv_lang: Lang | null;
  locale: string;
  timezone: string;
  prefs: Preferences;
}

export type TaskEventType =
  | 'created'
  | 'updated'
  | 'rescheduled'
  | 'clarified'
  | 'reminder_sent'
  | 'opened'
  | 'acknowledged'
  | 'snoozed'
  | 'completed'
  | 'reopened'
  | 'cancelled'
  | 'missed'
  | 'occurrence_completed'
  | 'followup_sent';

export interface MemoryItem {
  id: string;
  user_id: string;
  kind: 'preference' | 'fact';
  key: string;
  value: string;
  created_at: string;
}
