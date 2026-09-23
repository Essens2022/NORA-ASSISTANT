// AI → structured data. The model never touches the database: it returns a
// JSON plan, which is validated here and then executed deterministically.

import type { DayWindow, Lang, Priority, Task, TaskField, TaskKind, TimeBinding } from './types.ts';
import { DAY_WINDOWS, LANGS, PRIORITIES, TASK_FIELDS, TASK_KINDS } from './types.ts';
import { isValidDate, isValidTime, addDays, weekdayOf } from './tz.ts';
import { isValidRule } from './recurrence.ts';

// ---------------------------------------------------------------------------
// Provider port – Groq today, anything OpenAI-compatible / Anthropic / local tomorrow.
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIProvider {
  readonly name: string;
  /** Return the model's raw JSON text. Must honour `signal` and throw on failure. */
  completeJSON(messages: ChatMessage[], opts?: { signal?: AbortSignal; maxTokens?: number }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Plan schema
// ---------------------------------------------------------------------------

export interface AITaskFields {
  title?: string;
  notes?: string | null;
  kind?: TaskKind;
  priority?: Priority;
  date?: string | null;
  time?: string | null;
  time_window?: DayWindow | null;
  duration_min?: number | null;
  location?: string | null;
  travel_min?: number | null;
  buffer_min?: number | null;
  recurrence?: string | null;
  time_binding?: TimeBinding;
}

export type AIAction =
  | { type: 'create_task'; task: AITaskFields; confidence: number }
  | { type: 'update_task'; ref: string; changes: AITaskFields; confidence: number }
  | { type: 'complete_task'; ref: string }
  | { type: 'cancel_task'; ref: string }
  | { type: 'reopen_task'; ref: string }
  | { type: 'snooze_task'; ref: string; minutes: number | null; date: string | null; time: string | null }
  | { type: 'query_tasks'; from: string | null; to: string | null; text: string | null; status: 'open' | 'completed' | 'all' }
  | { type: 'remember'; key: string; value: string };

export type AskField = TaskField | 'day_in_week' | 'which';

export interface AIAsk {
  /** "new" = the task created in this plan; otherwise a context ref like "t2". */
  ref: string;
  field: AskField;
  question: string;
  options: string[];
}

export interface AIPlan {
  language: Lang;
  actions: AIAction[];
  ask: AIAsk | null;
  reply: string;
}

// ---------------------------------------------------------------------------
// Validation – never execute the model's JSON blindly.
// ---------------------------------------------------------------------------

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const optStr = (v: unknown, max: number): string | null | undefined => (v === null ? null : str(v, max));
const int = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === null) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;

function normTime(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const m = v.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return undefined;
  const s = `${m[1].padStart(2, '0')}:${m[2]}`;
  return isValidTime(s) ? s : undefined;
}

/** Which open questions a set of changes answers. */
export function clarifiedFields(changes: AITaskFields): TaskField[] {
  const out: TaskField[] = [];
  if (changes.title) out.push('title');
  if (changes.date) out.push('date');
  if (changes.time || changes.time_window) out.push('time');
  if (changes.travel_min) out.push('travel');
  if (changes.location) out.push('location');
  return out;
}

export function validateTaskFields(raw: unknown, errors: string[]): AITaskFields {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const f: AITaskFields = {};
  const title = str(o.title, 120);
  if (title) f.title = title;
  if ('notes' in o) f.notes = optStr(o.notes, 1000) ?? null;
  const kind = oneOf(o.kind, TASK_KINDS);
  if (kind) f.kind = kind;
  const pr = oneOf(o.priority, PRIORITIES);
  if (pr) f.priority = pr;
  if ('date' in o) {
    if (o.date === null) f.date = null;
    else if (isValidDate(o.date)) f.date = o.date;
    else errors.push(`bad_date:${String(o.date)}`);
  }
  if ('time' in o) {
    const tm = normTime(o.time);
    if (tm !== undefined) f.time = tm;
    else errors.push(`bad_time:${String(o.time)}`);
  }
  if ('time_window' in o) f.time_window = o.time_window === null ? null : oneOf(o.time_window, DAY_WINDOWS) ?? null;
  for (const k of ['duration_min', 'travel_min', 'buffer_min'] as const) {
    if (k in o) {
      const n = int(o[k], 0, 24 * 60);
      if (n !== undefined) f[k] = n === 0 && k !== 'buffer_min' ? null : n;
    }
  }
  if ('location' in o) f.location = optStr(o.location, 200) ?? null;
  if ('recurrence' in o) {
    if (o.recurrence === null) f.recurrence = null;
    else if (isValidRule(o.recurrence)) f.recurrence = (o.recurrence as string).toUpperCase().replace(/^RRULE:/, '');
    else errors.push(`bad_rrule:${String(o.recurrence)}`);
  }
  const tb = oneOf(o.time_binding, ['floating', 'absolute'] as const);
  if (tb) f.time_binding = tb;
  return f;
}

export function validatePlan(raw: unknown, fallbackLang: Lang): { plan: AIPlan; errors: string[] } {
  const errors: string[] = [];
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      errors.push('invalid_json');
    }
  } else if (raw && typeof raw === 'object') obj = raw as Record<string, unknown>;

  const language = oneOf(obj.language, LANGS) ?? fallbackLang;
  const actions: AIAction[] = [];
  const rawActions = Array.isArray(obj.actions) ? obj.actions.slice(0, 6) : [];
  for (const a of rawActions) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    const ref = str(r.ref, 40) ?? '';
    const confidence = typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.9;
    switch (r.type) {
      case 'create_task': {
        const task = validateTaskFields(r.task, errors);
        if (!task.title) {
          errors.push('create_without_title');
          continue;
        }
        actions.push({ type: 'create_task', task, confidence });
        break;
      }
      case 'update_task': {
        const changes = validateTaskFields(r.changes, errors);
        if (!Object.keys(changes).length) {
          errors.push('empty_update');
          continue;
        }
        actions.push({ type: 'update_task', ref, changes, confidence });
        break;
      }
      case 'complete_task':
      case 'cancel_task':
      case 'reopen_task':
        actions.push({ type: r.type, ref });
        break;
      case 'snooze_task': {
        const minutes = int(r.minutes, 1, 60 * 24 * 14) ?? null;
        const date = isValidDate(r.date) ? r.date : null;
        const time = normTime(r.time) ?? null;
        if (!minutes && !date && !time) {
          errors.push('empty_snooze');
          continue;
        }
        actions.push({ type: 'snooze_task', ref, minutes, date, time });
        break;
      }
      case 'query_tasks':
        actions.push({
          type: 'query_tasks',
          from: isValidDate(r.from) ? r.from : null,
          to: isValidDate(r.to) ? r.to : null,
          text: str(r.text, 80) ?? null,
          status: oneOf(r.status, ['open', 'completed', 'all'] as const) ?? 'open',
        });
        break;
      case 'remember': {
        const key = str(r.key, 60);
        const value = str(r.value, 300);
        if (key && value) actions.push({ type: 'remember', key, value });
        break;
      }
      default:
        errors.push(`unknown_action:${String(r.type)}`);
    }
  }

  let ask: AIAsk | null = null;
  if (obj.ask && typeof obj.ask === 'object') {
    const a = obj.ask as Record<string, unknown>;
    const field = oneOf(a.field, [...TASK_FIELDS, 'day_in_week', 'which'] as const);
    const question = str(a.question, 300);
    if (field && question) {
      ask = {
        ref: str(a.ref, 40) ?? 'new',
        field,
        question,
        options: Array.isArray(a.options) ? a.options.filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
      };
    }
  }
  const reply = str(obj.reply, 600) ?? '';
  return { plan: { language, actions, ask, reply }, errors };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export interface PromptContext {
  now: { date: string; time: string; weekday: number; timezone: string };
  lang: Lang;
  tasks: Array<{ ref: string; task: Task; focus: boolean }>;
  pending: { ref: string; field: string } | null;
  memory: string[];
  history: ChatMessage[];
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const SYSTEM_PROMPT = `You are NORA's language understanding engine. NORA is a proactive personal assistant whose promise is "Tell me once. I'll remember." You turn what the user says into a JSON plan; the app validates it and does the actual work.

Output ONLY a JSON object:
{"language":"ro|en|it|ru","actions":[...],"ask":null|{"ref":"new|tN","field":"date|time|title|location|travel|day_in_week|which","question":"...","options":["tN",...]},"reply":"..."}

Actions:
- {"type":"create_task","task":{TASK},"confidence":0-1}
- {"type":"update_task","ref":"tN","changes":{TASK fields that change},"confidence":0-1}
- {"type":"complete_task","ref":"tN"} | {"type":"cancel_task","ref":"tN"} | {"type":"reopen_task","ref":"tN"}
- {"type":"snooze_task","ref":"tN","minutes":int|null,"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null}
- {"type":"query_tasks","from":"YYYY-MM-DD"|null,"to":"YYYY-MM-DD"|null,"text":"keyword"|null,"status":"open|completed|all"}
- {"type":"remember","key":"short_key","value":"stable user preference or fact"}
TASK = {"title":"short noun phrase in the user's language, e.g. 'Dentist', 'Sună contabilul'","kind":"appointment|call|payment|shopping|travel|document|generic","priority":"low|normal|high","date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"time_window":"morning|afternoon|evening|anytime"|null,"duration_min":int|null,"location":str|null,"travel_min":int|null,"buffer_min":int|null,"recurrence":"RRULE like FREQ=WEEKLY;BYDAY=MO"|null,"notes":str|null}

Rules:
1. Act when you have enough; ask only for what is essential. Never ask again for something already given or deducible.
2. Appointments/meetings/visits need a date and a time. Calls, payments, errands need only a date (time optional). Shopping/quick notes ("cumpără lapte") need nothing: create immediately with date null.
3. If something essential is missing, still create the task with what you know AND set "ask" with ref "new" and a very short question in the user's language ("La ce oră?", "Când?"). One question at a time.
4. "next week" without a day → create with date null and ask field "day_in_week" ("Știi deja în ce zi?").
5. Resolve references ("it", "l", "-o", "lo", "его", "the dentist") against the TASKS list; the task marked * is the one currently being discussed. If exactly one task fits, use its ref. If several fit, do not act: set ask field "which" with their refs in options.
6. Corrections ("nu, am zis 10", "greșit, marți") update the task currently being discussed.
7. Times: bare hours 1–6 usually mean afternoon (13–18) unless context says morning; 7–11 mean morning. "9"→09:00, "la 3"→15:00, "noon"→12:00.
8. Use the CALENDAR below for weekday → date. Bare weekday = its next occurrence after today. "next <weekday>" = that day in next calendar week.
9. Travel: "fac două ore jumătate până acolo" → travel_min 150 on that appointment.
10. Recurring: "în fiecare luni la 8" → recurrence "FREQ=WEEKLY;BYDAY=MO", time "08:00", date = first occurrence.
11. Questions about the user's plans ("ce am mâine?", "când era dentistul?") → query_tasks with a date range and/or text. Never answer them from memory; the app answers from the database.
12. "remember" only for durable preferences the user states ("prefer să-mi amintești cu o oră înainte").
13. "reply": for small talk or when no action/ask applies, a short, warm, natural answer in the user's language. Otherwise a very short confirmation (the app may replace it). No robotic phrasing, no repeating the user's words back.
14. "language" = the language the user is writing in now (may differ from earlier messages).`;

function taskLineForPrompt(ref: string, t: Task, focus: boolean): string {
  const when = t.due_date ? `${WD[weekdayOf(t.due_date)]} ${t.due_date}${t.due_time ? ` ${t.due_time}` : t.time_window ? ` ${t.time_window}` : ''}` : 'no date';
  const extra = [t.recurrence && `rrule=${t.recurrence}`, t.travel_min && `travel=${t.travel_min}m`, t.location && `at ${t.location}`]
    .filter(Boolean)
    .join(' ');
  return `${ref}${focus ? '*' : ''} | ${t.title} | ${t.kind} | ${when} | ${t.status}${extra ? ` | ${extra}` : ''}`;
}

export function buildMessages(ctx: PromptContext, userText: string): ChatMessage[] {
  const cal: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(ctx.now.date, i);
    cal.push(`${WD[weekdayOf(d)]} ${d}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`);
  }
  const lines = [
    `NOW: ${WD[ctx.now.weekday]} ${ctx.now.date} ${ctx.now.time} (${ctx.now.timezone}). Last language: ${ctx.lang}.`,
    `CALENDAR: ${cal.join(', ')}`,
    `TASKS:\n${ctx.tasks.length ? ctx.tasks.map((x) => taskLineForPrompt(x.ref, x.task, x.focus)).join('\n') : '(none)'}`,
  ];
  if (ctx.pending) lines.push(`NORA JUST ASKED about ${ctx.pending.ref}: field "${ctx.pending.field}". The user's message is probably the answer.`);
  if (ctx.memory.length) lines.push(`USER PREFERENCES:\n- ${ctx.memory.join('\n- ')}`);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: lines.join('\n\n') },
    ...ctx.history.slice(-6),
    { role: 'user', content: userText.slice(0, 2000) },
  ];
}
