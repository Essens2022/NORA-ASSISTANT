// NORA's conversational engine.
//
//   message ─▶ fast path (deterministic, no LLM) ─▶ done
//          └─▶ AI plan (JSON) ─▶ validate ─▶ execute with TaskService ─▶ save ─▶ reply
//
// The reply is built only after everything was saved successfully, from the
// saved data. Queries are answered from the database, never from the model.

import type { AIAction, AIPlan, AIProvider, AskField, ChatMessage } from './ai.ts';
import { buildMessages, clarifiedFields, validatePlan } from './ai.ts';
import { classifyReply, detectLang, parseDate, parseDuration, parseTime } from './parse.ts';
import { departureTime, snoozeUntil } from './reminders.ts';
import { describeRule, formatWhen, joinList, t, taskLine } from './replies.ts';
import type { TaskQuery, TaskStore } from './service.ts';
import { TaskService } from './service.ts';
import { isOpen } from './status.ts';
import type { Lang, MemoryItem, Profile, Task, TaskField } from './types.ts';
import { addDays, toZoned, zonedToUtc } from './tz.ts';

export interface PendingQuestion {
  task_id: string;
  field: AskField | 'followup' | 'reschedule' | 'retry';
  options?: string[];
  /** For "which task?" questions: the original request, replayed once the user picks. */
  origin_text?: string;
  asked_at: string;
}

export interface ConversationState {
  focus_task_id: string | null;
  focus_at: string | null;
  pending: PendingQuestion | null;
  lang: Lang | null;
}

export const EMPTY_STATE: ConversationState = { focus_task_id: null, focus_at: null, pending: null, lang: null };

export interface AssistantStore extends TaskStore {
  getState(conversationId: string): Promise<ConversationState>;
  saveState(conversationId: string, state: ConversationState): Promise<void>;
  history(conversationId: string, limit: number): Promise<ChatMessage[]>;
  appendMessages(conversationId: string, msgs: Array<{ role: 'user' | 'assistant'; content: string; request_id?: string | null; meta?: Record<string, unknown> }>): Promise<void>;
  /** Idempotency: the reply already produced for this request id, if any. */
  findReply(requestId: string): Promise<AssistantReply | null>;
  memory(): Promise<MemoryItem[]>;
  remember(key: string, value: string): Promise<void>;
}

export interface AssistantReply {
  text: string;
  lang: Lang;
  /** Tasks created/changed by this turn – the UI refreshes them. */
  task_ids: string[];
  /** Tasks returned by a query – rendered as cards under the reply. */
  results?: Array<Pick<Task, 'id' | 'title' | 'due_date' | 'due_time' | 'status'>>;
  /** What NORA is waiting for, so the UI can keep the mic open. */
  awaiting: PendingQuestion['field'] | null;
  path: 'fast' | 'ai' | 'error';
  error?: string;
}

export interface HandleOptions {
  conversationId: string;
  requestId: string;
  now?: Date;
}

const PENDING_TTL_MS = 30 * 60_000;
const FOCUS_TTL_MS = 2 * 60 * 60_000;
const NEEDS_TIME = new Set(['appointment', 'travel']);

export class Assistant {
  constructor(
    private store: AssistantStore,
    private ai: AIProvider | null,
    private profile: Profile,
    private log: (event: string, data?: Record<string, unknown>) => void = () => {},
  ) {}

  async handle(text: string, opts: HandleOptions): Promise<AssistantReply> {
    const now = opts.now ?? new Date();
    const prior = await this.store.findReply(opts.requestId);
    if (prior) return prior;

    const tz = this.profile.timezone;
    const today = toZoned(now, tz).date;
    const svc = new TaskService(this.store, this.profile, () => now);
    const state = await this.store.getState(opts.conversationId);
    if (state.pending && now.getTime() - Date.parse(state.pending.asked_at) > PENDING_TTL_MS) state.pending = null;
    if (state.focus_at && now.getTime() - Date.parse(state.focus_at) > FOCUS_TTL_MS) state.focus_task_id = null;

    const lang = detectLang(text, state.lang ?? this.profile.conv_lang ?? this.profile.ui_lang);
    const ctx: TurnCtx = { svc, state, lang, now, today, requestId: opts.requestId, text, touched: [] };

    let reply: AssistantReply;
    try {
      reply = (await this.fastPath(ctx)) ?? (await this.aiPath(ctx, opts.conversationId));
    } catch (err) {
      this.log('assistant_error', { error: String(err), requestId: opts.requestId });
      const saveFailed = String(err).includes('store:');
      reply = { text: t(ctx.lang, saveFailed ? 'save_failed' : 'error'), lang: ctx.lang, task_ids: [], awaiting: null, path: 'error', error: String(err) };
    }
    state.lang = reply.lang;
    if (reply.path !== 'error') await this.store.saveState(opts.conversationId, state);
    await this.store.appendMessages(opts.conversationId, [
      { role: 'user', content: text },
      { role: 'assistant', content: reply.text, request_id: opts.requestId, meta: { reply } },
    ]);
    return reply;
  }

  // -------------------------------------------------------------------------
  // Fast path – short answers to NORA's own question, "gata", "nu mai trebuie"
  // -------------------------------------------------------------------------

  private async fastPath(c: TurnCtx): Promise<AssistantReply | null> {
    const { state, text, svc } = c;
    const words = text.trim().split(/\s+/).length;
    const reply = classifyReply(text);

    if (state.pending) {
      const task = await this.store.getTask(state.pending.task_id);
      if (!task || !isOpen(task.status)) {
        state.pending = null;
        return null;
      }
      const p = state.pending;
      if (p.field === 'time' && words <= 6) {
        const tm = parseTime(text);
        if (tm) {
          // "10" / "la 10" is only a time; a date needs words ("mâine la 10", "vineri la 10")
          const date = /\p{L}{3,}/u.test(text.replace(/\b(la|pe|at|alle|ora|ore|cam|в)\b/gi, '')) ? parseDate(text, c.today) : null;
          const saved = await svc.update(task, { time: tm.time, ...(date && !date.vague ? { date: date.date } : {}) }, ['time']);
          return this.afterSchedule(c, saved);
        }
      }
      if ((p.field === 'date' || p.field === 'day_in_week') && words <= 7) {
        if (reply === 'not_yet' || reply === 'no' || reply === 'later') {
          await this.store.patchTask(task.id, { status: 'needs_clarification' });
          state.pending = null;
          this.focus(c, task);
          return this.done(c, t(c.lang, 'saved_unscheduled'), [task.id]);
        }
        const d = parseDate(text, c.today);
        if (d) {
          const tm = parseTime(text.replace(/\bpe \d{1,2}\b/, ''));
          const hasTime = tm && /\d|la |at |alle |в /.test(text) && !/^\s*(pe|on|il)?\s*\d{1,2}\s*$/.test(text);
          if (d.vague === 'next_week' || d.vague === 'next_month') {
            const saved = await svc.update(task, {}, []);
            await this.store.patchTask(saved.id, { metadata: { ...saved.metadata, vague_when: d.vague, vague_from: d.date } });
            return this.ask(c, saved, 'day_in_week');
          }
          const saved = await svc.update(task, { date: d.date, ...(hasTime ? { time: tm!.time } : {}) }, ['date']);
          return this.afterSchedule(c, saved);
        }
      }
      if (p.field === 'travel' && words <= 8) {
        const mins = parseDuration(text);
        if (mins) return this.afterSchedule(c, await svc.update(task, { travel_min: mins }, ['travel']));
      }
      if (p.field === 'which' && p.options?.length) {
        const chosen = await this.pickOption(p.options, text);
        if (chosen) {
          state.pending = null;
          this.focus(c, chosen);
          // replay the original request, now with an unambiguous focus
          if (p.origin_text) c.text = `${p.origin_text} (${chosen.title})`;
          return null;
        }
      }
      if (p.field === 'followup' && reply) {
        if (reply === 'done' || reply === 'yes') return this.complete(c, task);
        if (reply === 'cancel') return this.cancel(c, task);
        if (reply === 'no' || reply === 'not_yet' || reply === 'later') {
          const timedAppointment = NEEDS_TIME.has(task.kind) && task.due_time;
          state.pending = { task_id: task.id, field: timedAppointment ? 'reschedule' : 'retry', asked_at: c.now.toISOString() };
          if (timedAppointment) return this.done(c, t(c.lang, 'reschedule_offer'), [task.id], 'reschedule');
          return this.done(c, t(c.lang, 'retry_offer', { when: this.relative(c, 120) }), [task.id], 'retry');
        }
      }
      if (p.field === 'retry' && reply) {
        if (reply === 'yes') {
          const { retryAt } = await svc.notYet(task);
          state.pending = null;
          return this.done(c, retryAt ? t(c.lang, 'snoozed', { when: this.whenInstant(c, retryAt) }) : t(c.lang, 'ok_leave'), [task.id]);
        }
        if (reply === 'no') {
          state.pending = null;
          return this.done(c, t(c.lang, 'ok_leave'), [task.id]);
        }
      }
      if (p.field === 'reschedule' && reply) {
        if (reply === 'yes') return this.ask(c, task, 'date');
        if (reply === 'no' || reply === 'cancel') {
          if (reply === 'cancel') return this.cancel(c, task);
          state.pending = null;
          return this.done(c, t(c.lang, 'ok_leave'), [task.id]);
        }
      }
    }

    // "gata" / "am făcut" / "nu mai trebuie" about the task we are talking about
    if (state.focus_task_id && (reply === 'done' || reply === 'cancel')) {
      const task = await this.store.getTask(state.focus_task_id);
      if (task && isOpen(task.status)) return reply === 'done' ? this.complete(c, task) : this.cancel(c, task);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // AI path
  // -------------------------------------------------------------------------

  private async aiPath(c: TurnCtx, conversationId: string): Promise<AssistantReply> {
    if (!this.ai) return this.done(c, t(c.lang, 'ai_unavailable'), [], null, 'error');

    const [tasks, memory, history] = await Promise.all([
      this.contextTasks(c),
      this.profile.prefs.personalization ? this.store.memory() : Promise.resolve([]),
      this.store.history(conversationId, 6),
    ]);
    const refs = new Map<string, Task>();
    const listed = tasks.map((task, i) => {
      const ref = `t${i + 1}`;
      refs.set(ref, task);
      return { ref, task, focus: task.id === c.state.focus_task_id };
    });
    const refOf = (id: string | null | undefined) => listed.find((x) => x.task.id === id)?.ref ?? null;
    const pending = c.state.pending ? { ref: refOf(c.state.pending.task_id) ?? '?', field: c.state.pending.field } : null;
    const tzNow = toZoned(c.now, this.profile.timezone);
    const messages = buildMessages(
      {
        now: { date: tzNow.date, time: tzNow.time, weekday: tzNow.weekday, timezone: this.profile.timezone },
        lang: c.lang,
        tasks: listed,
        pending,
        memory: memory.map((m) => `${m.key}: ${m.value}`).slice(0, 12),
        history,
      },
      c.text,
    );

    const started = Date.now();
    let raw: string;
    try {
      raw = await this.ai.completeJSON(messages, { maxTokens: 700 });
    } catch (err) {
      this.log('ai_error', { error: String(err), provider: this.ai.name });
      return this.done(c, t(c.lang, 'ai_unavailable'), [], null, 'error');
    }
    const { plan, errors } = validatePlan(raw, c.lang);
    this.log('ai_plan', { ms: Date.now() - started, actions: plan.actions.map((a) => a.type), ask: plan.ask?.field ?? null, errors });
    c.lang = plan.language;
    if (errors.includes('invalid_json') && !plan.actions.length) return this.done(c, t(c.lang, 'didnt_understand'), [], null, 'ai');
    return this.execute(c, plan, refs);
  }

  private async execute(c: TurnCtx, plan: AIPlan, refs: Map<string, Task>): Promise<AssistantReply> {
    const lines: string[] = [];
    let created: Task | null = null;
    let results: AssistantReply['results'];
    let createIndex = 0;

    const resolve = async (ref: string): Promise<Task | null | 'ambiguous'> => {
      const direct = refs.get(ref);
      if (direct) return (await this.store.getTask(direct.id)) ?? null;
      if (ref === 'new' && created) return created;
      if (c.state.focus_task_id) return this.store.getTask(c.state.focus_task_id);
      return null;
    };

    for (const action of plan.actions) {
      switch (action.type) {
        case 'create_task': {
          const missing: TaskField[] = plan.ask && plan.ask.ref === 'new' && isTaskField(plan.ask.field) ? [plan.ask.field] : [];
          if (plan.ask?.ref === 'new' && plan.ask.field === 'day_in_week') missing.push('date');
          const task = await c.svc.create(
            { ...action.task, title: action.task.title! },
            { requestId: `${c.requestId}:${createIndex++}`, source: c.text, missing, confidence: action.confidence },
          );
          created = task;
          c.touched.push(task.id);
          this.focus(c, task);
          if (!missing.length && !(plan.ask?.ref === 'new')) lines.push(this.confirmCreate(c, task));
          break;
        }
        case 'update_task': {
          const task = await resolve(action.ref);
          if (task === 'ambiguous' || !task) return this.done(c, t(c.lang, 'not_found'), c.touched);
          const clarified = clarifiedFields(action.changes);
          const before = task;
          const saved = await c.svc.update(task, action.changes, clarified);
          c.touched.push(saved.id);
          this.focus(c, saved);
          if (c.state.pending?.task_id === saved.id) c.state.pending = null;
          const moved = before.due_date !== saved.due_date || before.due_time !== saved.due_time;
          if (moved && saved.due_date) lines.push(t(c.lang, 'updated', { when: this.when(c, saved) }));
          else if (action.changes.travel_min && saved.due_time) lines.push(this.confirmCreate(c, saved));
          else lines.push(saved.missing_fields.length ? '' : t(c.lang, 'updated_generic'));
          break;
        }
        case 'complete_task':
        case 'cancel_task':
        case 'reopen_task': {
          const task = await resolve(action.ref);
          if (task === 'ambiguous' || !task) return this.done(c, t(c.lang, 'not_found'), c.touched);
          if (action.type === 'complete_task') lines.push((await this.complete(c, task)).text);
          else if (action.type === 'cancel_task') lines.push((await this.cancel(c, task)).text);
          else {
            const saved = await c.svc.reopen(task);
            c.touched.push(saved.id);
            lines.push(t(c.lang, 'reopened'));
          }
          break;
        }
        case 'snooze_task': {
          const task = await resolve(action.ref);
          if (task === 'ambiguous' || !task) return this.done(c, t(c.lang, 'not_found'), c.touched);
          const until = action.minutes
            ? snoozeUntil(action.minutes, c.now, this.profile.timezone, this.profile.prefs, c.today)
            : snoozeAt(action.date ?? c.today, action.time ?? this.profile.prefs.default_time, this.profile.timezone);
          if (until.getTime() <= c.now.getTime()) return this.done(c, t(c.lang, 'didnt_understand'), c.touched);
          const saved = await c.svc.snooze(task, until);
          c.touched.push(saved.id);
          this.focus(c, saved);
          lines.push(t(c.lang, 'snoozed', { when: this.whenInstant(c, until) }));
          break;
        }
        case 'query_tasks': {
          const out = await this.query(c, action);
          results = out.results;
          lines.push(out.text);
          break;
        }
        case 'remember':
          if (this.profile.prefs.personalization) await this.store.remember(action.key, action.value);
          if (!plan.reply) lines.push(t(c.lang, 'remembered'));
          break;
      }
    }

    // Clarification question
    if (plan.ask) {
      const a = plan.ask;
      if (a.field === 'which') {
        const ids = a.options.map((r) => refs.get(r)?.id).filter((x): x is string => !!x);
        const titles = a.options.map((r) => refs.get(r)?.title).filter((x): x is string => !!x);
        if (ids.length >= 2) {
          c.state.pending = { task_id: ids[0], field: 'which', options: ids, origin_text: c.text, asked_at: c.now.toISOString() };
          const options = titles.join(` ${t(c.lang, 'or')} `);
          return this.done(c, t(c.lang, 'which_task', { options }), c.touched, 'which');
        }
      } else {
        const target = a.ref === 'new' ? created : refs.get(a.ref) ?? null;
        if (target) {
          c.state.pending = { task_id: target.id, field: a.field, asked_at: c.now.toISOString() };
          if (a.field !== 'day_in_week' && isTaskField(a.field) && !target.missing_fields.includes(a.field)) {
            await this.store.patchTask(target.id, { missing_fields: [...target.missing_fields, a.field], status: 'needs_clarification' });
          }
          this.focus(c, target);
          const q = a.question || t(c.lang, `ask_${a.field}`);
          return this.done(c, [...lines.filter(Boolean), q].join(' '), c.touched, a.field);
        }
      }
    }

    const text = lines.filter(Boolean).join(' ') || plan.reply || t(c.lang, 'didnt_understand');
    const reply = this.done(c, text, c.touched, null, 'ai');
    if (results) reply.results = results;
    return reply;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async contextTasks(c: TurnCtx): Promise<Task[]> {
    const open = await this.store.listTasks({
      statuses: ['captured', 'needs_clarification', 'scheduled', 'upcoming', 'reminded', 'acknowledged', 'in_progress', 'missed', 'rescheduled'],
      to: addDays(c.today, 30),
      limit: 25,
    });
    const focusId = c.state.focus_task_id;
    const sorted = open.sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : (a.start_at ?? '9').localeCompare(b.start_at ?? '9')));
    if (focusId && !sorted.some((x) => x.id === focusId)) {
      const f = await this.store.getTask(focusId);
      if (f) sorted.unshift(f);
    }
    return sorted.slice(0, 20);
  }

  private async query(c: TurnCtx, q: Extract<AIAction, { type: 'query_tasks' }>): Promise<{ text: string; results: NonNullable<AssistantReply['results']> }> {
    const statuses: TaskQuery['statuses'] =
      q.status === 'completed' ? ['completed'] : q.status === 'all' ? undefined : ['captured', 'needs_clarification', 'scheduled', 'upcoming', 'reminded', 'acknowledged', 'in_progress', 'missed', 'rescheduled'];
    const tasks = await this.store.listTasks({ from: q.from, to: q.to ?? q.from, text: q.text, statuses, limit: 12 });
    tasks.sort((a, b) => `${a.due_date ?? '9'}${a.due_time ?? '99'}`.localeCompare(`${b.due_date ?? '9'}${b.due_time ?? '99'}`));
    const results = tasks.map(({ id, title, due_date, due_time, status }) => ({ id, title, due_date, due_time, status }));
    const hour12 = this.profile.prefs.hour12;
    const singleDay = q.from && (!q.to || q.to === q.from) ? q.from : null;
    if (singleDay) {
      const range = formatWhen(singleDay, null, c.today, c.lang, hour12);
      if (!tasks.length) return { text: t(c.lang, 'query_none', { range }), results };
      return { text: t(c.lang, 'query_list', { range, items: joinList(tasks.map((x) => taskLine(x, c.lang, hour12)), c.lang) }), results };
    }
    if (!tasks.length) return { text: t(c.lang, 'query_none_any'), results };
    const items = tasks.slice(0, 6).map((x) => {
      const when = x.due_date ? formatWhen(x.due_date, x.due_time, c.today, c.lang, hour12) : '';
      return when ? `${x.title} – ${when}` : x.title;
    });
    if (tasks.length === 1 && tasks[0].id) this.focus(c, tasks[0]);
    return { text: t(c.lang, 'query_found', { items: joinList(items, c.lang) }), results };
  }

  private confirmCreate(c: TurnCtx, task: Task): string {
    const hour12 = this.profile.prefs.hour12;
    if (task.recurrence) return t(c.lang, 'created_recurring', { rule: describeRule(task.recurrence, task.due_time, c.lang, task.due_date, hour12) });
    if (!task.due_date) return t(c.lang, 'created_inbox');
    const dep = departureTime(task, this.profile.prefs);
    if (dep) return t(c.lang, 'created_departure', { dep: formatWhen(null, dep, c.today, c.lang, hour12).replace(/^(la|at|alle|в)\s+/, '') });
    return t(c.lang, 'created', { when: this.when(c, task) });
  }

  private afterSchedule(c: TurnCtx, task: Task): AssistantReply {
    c.touched.push(task.id);
    this.focus(c, task);
    c.state.pending = null;
    if (task.due_date && !task.due_time && !task.time_window && NEEDS_TIME.has(task.kind)) return this.ask(c, task, 'time');
    return this.done(c, this.confirmCreate(c, task), c.touched);
  }

  private ask(c: TurnCtx, task: Task, field: AskField): AssistantReply {
    c.state.pending = { task_id: task.id, field, asked_at: c.now.toISOString() };
    this.focus(c, task);
    if (!c.touched.includes(task.id)) c.touched.push(task.id);
    return this.done(c, t(c.lang, `ask_${field}`), c.touched, field);
  }

  private async complete(c: TurnCtx, task: Task): Promise<AssistantReply> {
    const { task: saved, nextDate } = await c.svc.complete(task);
    c.touched.push(saved.id);
    c.state.pending = null;
    if (nextDate) return this.done(c, t(c.lang, 'completed_next', { when: formatWhen(nextDate, saved.due_time, c.today, c.lang, this.profile.prefs.hour12) }), c.touched);
    c.state.focus_task_id = saved.id;
    return this.done(c, t(c.lang, 'completed'), c.touched);
  }

  private async cancel(c: TurnCtx, task: Task): Promise<AssistantReply> {
    const saved = await c.svc.cancel(task);
    c.touched.push(saved.id);
    c.state.pending = null;
    c.state.focus_task_id = null;
    return this.done(c, t(c.lang, 'cancelled'), c.touched);
  }

  private async pickOption(ids: string[], text: string): Promise<Task | null> {
    const tasks = (await Promise.all(ids.map((id) => this.store.getTask(id)))).filter((x): x is Task => !!x);
    const n = text.toLowerCase();
    const ordinal = /\b(primul|prima|first|primo|prima|первый|первое|первая)\b/.test(n) ? 0 : /\b(al doilea|a doua|second|secondo|seconda|второй|второе|вторая)\b/.test(n) ? 1 : -1;
    if (ordinal >= 0) return tasks[ordinal] ?? null;
    const hits = tasks.filter((x) => x.title.toLowerCase().split(/\s+/).some((w) => w.length > 2 && n.includes(w)));
    return hits.length === 1 ? hits[0] : null;
  }

  private focus(c: TurnCtx, task: Task) {
    c.state.focus_task_id = task.id;
    c.state.focus_at = c.now.toISOString();
  }

  private when(c: TurnCtx, task: Task): string {
    return formatWhen(task.due_date, task.due_time, c.today, c.lang, this.profile.prefs.hour12);
  }

  private whenInstant(c: TurnCtx, d: Date): string {
    const z = toZoned(d, this.profile.timezone);
    return formatWhen(z.date, z.time, c.today, c.lang, this.profile.prefs.hour12);
  }

  private relative(c: TurnCtx, minutes: number): string {
    return this.whenInstant(c, new Date(c.now.getTime() + minutes * 60000));
  }

  private done(c: TurnCtx, text: string, ids: string[], awaiting: AssistantReply['awaiting'] = null, path: AssistantReply['path'] = 'fast'): AssistantReply {
    return { text, lang: c.lang, task_ids: [...new Set(ids)], awaiting, path };
  }
}

interface TurnCtx {
  svc: TaskService;
  state: ConversationState;
  lang: Lang;
  now: Date;
  today: string;
  requestId: string;
  text: string;
  touched: string[];
}

function isTaskField(f: string): f is TaskField {
  return ['title', 'date', 'time', 'location', 'travel'].includes(f);
}

function snoozeAt(date: string, time: string, tz: string): Date {
  return zonedToUtc(date, time, tz);
}
