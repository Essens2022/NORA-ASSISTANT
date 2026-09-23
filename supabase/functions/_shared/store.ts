// Supabase implementation of NORA's persistence port.
// The API uses a client carrying the user's JWT, so Row Level Security applies
// to every query – one user can never touch another user's rows.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type {
  AssistantReply,
  AssistantStore,
  ChatMessage,
  ConversationState,
  MemoryItem,
  NewTask,
  PlannedReminder,
  Preferences,
  Profile,
  ReminderKind,
  Task,
  TaskEventType,
  TaskQuery,
} from './core/index.ts';
import { DEFAULT_PREFERENCES, EMPTY_STATE, LANGS } from './core/index.ts';

const fail = (what: string, error: { message?: string } | null) => new Error(`store: ${what}: ${error?.message ?? 'unknown'}`);

export function rowToTask(r: Record<string, unknown>): Task {
  return {
    ...(r as unknown as Task),
    due_time: typeof r.due_time === 'string' ? (r.due_time as string).slice(0, 5) : null,
    missing_fields: (r.missing_fields as Task['missing_fields']) ?? [],
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}

export function rowToProfile(r: Record<string, unknown>): Profile {
  const lang = (v: unknown) => (LANGS as readonly string[]).includes(v as string) ? (v as Profile['ui_lang']) : null;
  return {
    id: r.id as string,
    display_name: (r.display_name as string) ?? null,
    ui_lang: lang(r.ui_lang) ?? 'en',
    conv_lang: lang(r.conv_lang),
    locale: (r.locale as string) ?? 'en-US',
    timezone: (r.timezone as string) ?? 'UTC',
    prefs: { ...DEFAULT_PREFERENCES, ...((r.prefs as Partial<Preferences>) ?? {}) },
  };
}

export class SupabaseStore implements AssistantStore {
  constructor(
    private db: SupabaseClient,
    private userId: string,
  ) {}

  async getTask(id: string) {
    const { data, error } = await this.db.from('tasks').select('*').eq('id', id).maybeSingle();
    if (error) throw fail('get_task', error);
    return data ? rowToTask(data) : null;
  }

  async insertTask(row: NewTask) {
    const { data, error } = await this.db.from('tasks').insert(row).select('*').single();
    if (!error) return { task: rowToTask(data), existed: false };
    if (error.code === '23505' && row.client_request_id) {
      const { data: existing, error: e2 } = await this.db.from('tasks').select('*').eq('client_request_id', row.client_request_id).maybeSingle();
      if (existing) return { task: rowToTask(existing), existed: true };
      throw fail('insert_task_dupe', e2);
    }
    throw fail('insert_task', error);
  }

  async patchTask(id: string, patch: Partial<Task>) {
    const { id: _i, user_id: _u, created_at: _c, updated_at: _up, ...clean } = patch as Record<string, unknown>;
    const { data, error } = await this.db.from('tasks').update(clean).eq('id', id).select('*').single();
    if (error) throw fail('patch_task', error);
    return rowToTask(data);
  }

  async logEvent(taskId: string, type: TaskEventType, data: Record<string, unknown> = {}) {
    const { error } = await this.db.from('task_events').insert({ task_id: taskId, user_id: this.userId, type, data });
    if (error) console.warn(JSON.stringify({ event: 'log_event_failed', type, error: error.message }));
  }

  async replaceReminders(taskId: string, add: PlannedReminder[], cancelKinds?: ReminderKind[]) {
    let q = this.db.from('reminders').update({ status: 'cancelled' }).eq('task_id', taskId).eq('status', 'pending');
    if (cancelKinds) q = q.in('kind', cancelKinds);
    const { error } = await q;
    if (error) throw fail('cancel_reminders', error);
    if (!add.length) return;
    const { error: e2 } = await this.db.from('reminders').insert(add.map((r) => ({ ...r, task_id: taskId, user_id: this.userId })));
    if (e2) throw fail('insert_reminders', e2);
  }

  async listTasks(q: TaskQuery) {
    let query = this.db.from('tasks').select('*');
    if (q.statuses?.length) query = query.in('status', q.statuses);
    if (q.from) query = query.gte('due_date', q.from);
    if (q.to) query = q.from ? query.lte('due_date', q.to) : query.or(`due_date.is.null,due_date.lte.${q.to}`);
    if (q.text) {
      const words = q.text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 4);
      if (words.length) query = query.or(words.map((w) => `title.ilike.%${w}%`).join(','));
    }
    const { data, error } = await query.order('due_date', { ascending: true, nullsFirst: false }).order('due_time', { ascending: true, nullsFirst: false }).limit(q.limit ?? 100);
    if (error) throw fail('list_tasks', error);
    return (data ?? []).map(rowToTask);
  }

  async getState(conversationId: string): Promise<ConversationState> {
    const { data } = await this.db.from('conversations').select('state').eq('id', conversationId).maybeSingle();
    return { ...EMPTY_STATE, ...((data?.state as Partial<ConversationState>) ?? {}) };
  }

  async saveState(conversationId: string, state: ConversationState) {
    const { error } = await this.db.from('conversations').update({ state }).eq('id', conversationId);
    if (error) throw fail('save_state', error);
  }

  async history(conversationId: string, limit: number): Promise<ChatMessage[]> {
    const { data } = await this.db.from('messages').select('role, content').eq('conversation_id', conversationId).order('id', { ascending: false }).limit(limit);
    return ((data ?? []) as ChatMessage[]).reverse();
  }

  async appendMessages(conversationId: string, msgs: Array<{ role: 'user' | 'assistant'; content: string; request_id?: string | null; meta?: Record<string, unknown> }>) {
    const rows = msgs.map((m) => ({ conversation_id: conversationId, user_id: this.userId, role: m.role, content: m.content.slice(0, 4000), request_id: m.request_id ?? null, meta: m.meta ?? {} }));
    const { error } = await this.db.from('messages').insert(rows);
    if (error && error.code !== '23505') console.warn(JSON.stringify({ event: 'append_messages_failed', error: error.message }));
  }

  async findReply(requestId: string): Promise<AssistantReply | null> {
    const { data } = await this.db.from('messages').select('meta').eq('request_id', requestId).eq('role', 'assistant').maybeSingle();
    return (data?.meta as { reply?: AssistantReply } | undefined)?.reply ?? null;
  }

  async memory(): Promise<MemoryItem[]> {
    const { data } = await this.db.from('memory_items').select('*').order('updated_at', { ascending: false }).limit(30);
    return (data ?? []) as MemoryItem[];
  }

  async remember(key: string, value: string) {
    const { error } = await this.db.from('memory_items').upsert({ user_id: this.userId, key, value, kind: 'preference' }, { onConflict: 'user_id,key' });
    if (error) throw fail('remember', error);
  }
}
