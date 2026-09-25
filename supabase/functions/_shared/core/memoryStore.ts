// In-memory implementation of AssistantStore – used by tests and local demos.
import type { AssistantReply, AssistantStore, ConversationState } from './assistant.ts';
import { EMPTY_STATE } from './assistant.ts';
import type { ChatMessage } from './ai.ts';
import type { PlannedReminder } from './reminders.ts';
import type { NewTask, TaskQuery } from './service.ts';
import type { MemoryItem, Reminder, ReminderKind, Task, TaskEventType } from './types.ts';

let seq = 0;
const id = (p: string) => `${p}_${(++seq).toString(36)}`;

export class MemoryStore implements AssistantStore {
  tasks = new Map<string, Task>();
  reminders: Reminder[] = [];
  events: Array<{ task_id: string; type: TaskEventType; data?: Record<string, unknown> }> = [];
  messages: Array<{ conversation: string; role: 'user' | 'assistant'; content: string; request_id?: string | null; meta?: Record<string, unknown> }> = [];
  states = new Map<string, ConversationState>();
  mem: MemoryItem[] = [];
  failNextWrite = false;

  constructor(private userId: string, private clock: () => Date = () => new Date()) {}

  private guard() {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('store: write failed');
    }
  }

  async getTask(tid: string) {
    const t = this.tasks.get(tid);
    return t ? structuredClone(t) : null;
  }

  async insertTask(row: NewTask) {
    this.guard();
    if (row.client_request_id) {
      const existing = [...this.tasks.values()].find((t) => t.user_id === row.user_id && t.client_request_id === row.client_request_id);
      if (existing) return { task: structuredClone(existing), existed: true };
    }
    const now = this.clock().toISOString();
    const task: Task = { ...structuredClone(row), id: id('task'), created_at: now, updated_at: now };
    this.tasks.set(task.id, task);
    return { task: structuredClone(task), existed: false };
  }

  async patchTask(tid: string, patch: Partial<Task>) {
    this.guard();
    const t = this.tasks.get(tid);
    if (!t) throw new Error('store: not found');
    Object.assign(t, structuredClone(patch), { updated_at: this.clock().toISOString() });
    return structuredClone(t);
  }

  async logEvent(task_id: string, type: TaskEventType, data?: Record<string, unknown>) {
    this.events.push({ task_id, type, data });
  }

  async replaceReminders(taskId: string, add: PlannedReminder[], cancelKinds?: ReminderKind[]) {
    for (const r of this.reminders) {
      if (r.task_id === taskId && r.status === 'pending' && (!cancelKinds || cancelKinds.includes(r.kind))) r.status = 'cancelled';
    }
    for (const p of add) {
      this.reminders.push({ id: id('rem'), task_id: taskId, user_id: this.userId, kind: p.kind, fire_at: p.fire_at, status: 'pending', sound: p.sound, action_token: id('tok'), attempts: 0, sent_at: null });
    }
  }

  pendingReminders(taskId: string) {
    return this.reminders.filter((r) => r.task_id === taskId && r.status === 'pending').sort((a, b) => a.fire_at.localeCompare(b.fire_at));
  }

  async listTasks(q: TaskQuery) {
    let list = [...this.tasks.values()].filter((t) => t.user_id === this.userId);
    if (q.statuses) list = list.filter((t) => q.statuses!.includes(t.status));
    if (q.from) list = list.filter((t) => t.due_date && t.due_date >= q.from!);
    if (q.to) list = list.filter((t) => !t.due_date || t.due_date <= q.to!);
    if (q.from && q.to) list = list.filter((t) => t.due_date);
    if (q.text) {
      const words = q.text.toLowerCase().split(/\s+/);
      list = list.filter((t) => words.some((w) => t.title.toLowerCase().includes(w)));
    }
    return list.slice(0, q.limit ?? 100).map((t) => structuredClone(t));
  }

  async getState(c: string) {
    return structuredClone(this.states.get(c) ?? EMPTY_STATE);
  }
  async saveState(c: string, s: ConversationState) {
    this.states.set(c, structuredClone(s));
  }
  async history(c: string, limit: number): Promise<ChatMessage[]> {
    return this.messages.filter((m) => m.conversation === c).slice(-limit).map((m) => ({ role: m.role, content: m.content }));
  }
  async appendMessages(c: string, msgs: Parameters<AssistantStore['appendMessages']>[1]) {
    for (const m of msgs) this.messages.push({ conversation: c, ...m });
  }
  async findReply(requestId: string) {
    const m = this.messages.find((x) => x.request_id === requestId && x.role === 'assistant');
    return m ? ((m.meta?.reply as AssistantReply) ?? null) : null;
  }
  async memory() {
    return [...this.mem];
  }
  async remember(key: string, value: string) {
    this.mem = this.mem.filter((m) => m.key !== key);
    this.mem.push({ id: id('mem'), user_id: this.userId, kind: 'preference', key, value, created_at: this.clock().toISOString() });
  }
}
