// Notification content per reminder kind, in the user's language.
//
// A NORA notification calls the person – by name when known – and says exactly
// what to do now, in one clean sentence. Max two action buttons (what most
// platforms show). If the user does not react, NORA calls again ("nudge").

import { departureTime } from './reminders.ts';
import type { PlannedReminder } from './reminders.ts';
import { formatWhen, spokenTime } from './replies.ts';
import type { Lang, Preferences, Priority, Reminder, ReminderKind, Task } from './types.ts';

export type NotifyAction = 'done' | 'snooze' | 'notyet' | 'open';

export interface NotificationPayload {
  title: string;
  body: string;
  tag: string;
  task_id: string;
  token: string;
  kind: Reminder['kind'];
  sound: Reminder['sound'];
  actions: Array<{ action: NotifyAction; title: string }>;
  /** Text NORA says in the chat for follow-ups, so the user can answer by voice. */
  chat?: string;
  /** Keep on screen until the user acts. */
  sticky: boolean;
  lang: Lang;
}

type S = Record<string, string>;
const STR: Record<Lang, S> = {
  ro: {
    call_now: '{name}e momentul: {title}',
    call_now_anon: 'E momentul: {title}',
    main_body: 'Acum, {at}. Te ocupi?',
    main_body_date: '{when}. Te ocupi azi?',
    soon_title: '{name}în {min} min: {title}',
    soon_title_anon: 'În {min} min: {title}',
    soon_body: '{at}{where}. Te anunț la timp.',
    leave_title: '{name}e timpul să pleci',
    leave_title_anon: 'E timpul să pleci',
    leave_body: '{title} {at}. Dacă pleci acum, ajungi fără grabă.',
    dep_title: 'Pregătește-te de plecare',
    dep_body: '{title} {at}. Pleci în jur de {dep}.',
    prep_title: 'Mâine: {title}',
    prep_body: '{at_line}Ai pregătit tot ce-ți trebuie?',
    prep_leave: 'Pleci pe la {dep}. ',
    nudge_title: '{name}încă te aștept',
    nudge_title_anon: 'Încă te aștept',
    nudge_body: '{title} – nu am văzut încă un răspuns.',
    followup_title: '{name}ai rezolvat?',
    followup_title_anon: 'Ai rezolvat?',
    followup_body: '{title}',
    followup_chat: 'Ai rezolvat: {title}?',
    a_done: 'Gata',
    a_snooze: 'Peste 15 min',
    a_left: 'Am plecat',
    a_yes: 'Da, gata',
    a_notyet: 'Încă nu',
    a_open: 'Deschide',
    at_nearby: ' · {loc}',
  },
  en: {
    call_now: "{name}it's time: {title}",
    call_now_anon: "It's time: {title}",
    main_body: 'Now, {at}. On it?',
    main_body_date: '{when}. Doing it today?',
    soon_title: '{name}in {min} min: {title}',
    soon_title_anon: 'In {min} min: {title}',
    soon_body: '{at}{where}. I’ll keep you on time.',
    leave_title: '{name}time to leave',
    leave_title_anon: 'Time to leave',
    leave_body: '{title} {at}. Leave now and you’ll get there without rushing.',
    dep_title: 'Get ready to leave',
    dep_body: '{title} {at}. Leave around {dep}.',
    prep_title: 'Tomorrow: {title}',
    prep_body: '{at_line}Got everything ready?',
    prep_leave: 'Leave around {dep}. ',
    nudge_title: "{name}I'm still waiting",
    nudge_title_anon: "I'm still waiting",
    nudge_body: '{title} – no answer yet.',
    followup_title: '{name}did you get it done?',
    followup_title_anon: 'Did you get it done?',
    followup_body: '{title}',
    followup_chat: 'Did you get it done: {title}?',
    a_done: 'Done',
    a_snooze: 'In 15 min',
    a_left: "I've left",
    a_yes: 'Yes, done',
    a_notyet: 'Not yet',
    a_open: 'Open',
    at_nearby: ' · {loc}',
  },
  it: {
    call_now: '{name}è il momento: {title}',
    call_now_anon: 'È il momento: {title}',
    main_body: 'Adesso, {at}. Te ne occupi?',
    main_body_date: '{when}. Lo fai oggi?',
    soon_title: '{name}tra {min} min: {title}',
    soon_title_anon: 'Tra {min} min: {title}',
    soon_body: '{at}{where}. Ti avviso in tempo.',
    leave_title: '{name}è ora di partire',
    leave_title_anon: 'È ora di partire',
    leave_body: '{title} {at}. Se parti adesso arrivi senza fretta.',
    dep_title: 'Preparati a partire',
    dep_body: '{title} {at}. Parti verso le {dep}.',
    prep_title: 'Domani: {title}',
    prep_body: '{at_line}Hai preparato tutto?',
    prep_leave: 'Parti verso le {dep}. ',
    nudge_title: '{name}ti sto ancora aspettando',
    nudge_title_anon: 'Ti sto ancora aspettando',
    nudge_body: '{title} – nessuna risposta per ora.',
    followup_title: '{name}ci sei riuscito?',
    followup_title_anon: 'Ci sei riuscito?',
    followup_body: '{title}',
    followup_chat: 'Ci sei riuscito: {title}?',
    a_done: 'Fatto',
    a_snooze: 'Tra 15 min',
    a_left: 'Sono partito',
    a_yes: 'Sì, fatto',
    a_notyet: 'Non ancora',
    a_open: 'Apri',
    at_nearby: ' · {loc}',
  },
  ru: {
    call_now: '{name}пора: {title}',
    call_now_anon: 'Пора: {title}',
    main_body: 'Сейчас, {at}. Берёшься?',
    main_body_date: '{when}. Сделаешь сегодня?',
    soon_title: '{name}через {min} мин: {title}',
    soon_title_anon: 'Через {min} мин: {title}',
    soon_body: '{at}{where}. Предупрежу вовремя.',
    leave_title: '{name}пора выходить',
    leave_title_anon: 'Пора выходить',
    leave_body: '{title} {at}. Выйдешь сейчас – доберёшься без спешки.',
    dep_title: 'Готовься к выходу',
    dep_body: '{title} {at}. Выходи около {dep}.',
    prep_title: 'Завтра: {title}',
    prep_body: '{at_line}Всё подготовлено?',
    prep_leave: 'Выезд около {dep}. ',
    nudge_title: '{name}я всё ещё жду',
    nudge_title_anon: 'Я всё ещё жду',
    nudge_body: '{title} – ответа пока нет.',
    followup_title: '{name}получилось?',
    followup_title_anon: 'Получилось?',
    followup_body: '{title}',
    followup_chat: 'Получилось: {title}?',
    a_done: 'Готово',
    a_snooze: 'Через 15 мин',
    a_left: 'Выехал(а)',
    a_yes: 'Да, готово',
    a_notyet: 'Ещё нет',
    a_open: 'Открыть',
    at_nearby: ' · {loc}',
  },
};

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Title that calls the person by name when we know it: "Ion, e momentul: …". */
function called(s: S, key: string, name: string | null, v: Record<string, string | number>): string {
  if (name) return cap(fill(s[key], { ...v, name: `${name}, ` }));
  return fill(s[`${key}_anon`] ?? s[key], { ...v, name: '' });
}

export function buildNotification(
  r: Pick<Reminder, 'kind' | 'sound' | 'action_token'>,
  task: Task,
  lang: Lang,
  prefs: Preferences,
  today: string,
  opts: { name?: string | null; now?: Date } = {},
): NotificationPayload {
  const s = STR[lang] ?? STR.en;
  const name = opts.name?.trim() || null;
  const hour12 = prefs.hour12;
  const important = r.sound === 'important' || task.priority === 'high';
  const base = { tag: `task-${task.id}`, task_id: task.id, token: r.action_token, kind: r.kind, sound: r.sound, lang };
  const at = task.due_time ? formatWhen(null, task.due_time, today, lang, hour12) : '';
  const dep = departureTime(task, prefs);
  const depSpoken = dep ? spokenTime(dep, lang, hour12) : '';
  const v = { title: task.title, at, dep: depSpoken };

  switch (r.kind) {
    case 'prep': {
      const atLine = `${task.due_time ? `${cap(at)}. ` : ''}${dep ? fill(s.prep_leave, v) : ''}`;
      return { ...base, sticky: false, title: fill(s.prep_title, v), body: fill(s.prep_body, { at_line: atLine }), actions: [{ action: 'open', title: s.a_open }, { action: 'done', title: s.a_done }] };
    }
    case 'departure':
      return { ...base, sticky: true, title: fill(s.dep_title, v), body: fill(s.dep_body, v), actions: [{ action: 'done', title: s.a_left }, { action: 'snooze', title: s.a_snooze }] };
    case 'followup': {
      const chat = fill(s.followup_chat, v);
      return { ...base, sticky: important, title: called(s, 'followup_title', name, v), body: fill(s.followup_body, v), chat, actions: [{ action: 'done', title: s.a_yes }, { action: 'notyet', title: s.a_notyet }] };
    }
    case 'nudge':
      return { ...base, sticky: true, title: called(s, 'nudge_title', name, v), body: fill(s.nudge_body, v), actions: [{ action: 'done', title: s.a_done }, { action: 'snooze', title: s.a_snooze }] };
    default: {
      if (r.kind === 'main' && dep && task.travel_min) {
        return { ...base, sticky: true, title: called(s, 'leave_title', name, v), body: fill(s.leave_body, v), actions: [{ action: 'done', title: s.a_left }, { action: 'snooze', title: s.a_snooze }] };
      }
      // Reminder before the start ("in 30 minutes") vs. at the time itself.
      const startMs = task.start_at ? Date.parse(task.start_at) : NaN;
      const minsLeft = Math.round((startMs - (opts.now ?? new Date()).getTime()) / 60000);
      if (task.due_time && task.due_date === today && minsLeft >= 5) {
        const where = task.location ? fill(s.at_nearby, { loc: task.location }) : '';
        return { ...base, sticky: important, title: called(s, 'soon_title', name, { ...v, min: minsLeft }), body: cap(fill(s.soon_body, { ...v, where })), actions: [{ action: 'open', title: s.a_open }, { action: 'done', title: s.a_done }] };
      }
      const when = task.due_date && task.due_date !== today ? formatWhen(task.due_date, task.due_time, today, lang, hour12) : '';
      const body = task.due_time && !when ? fill(s.main_body, v) : when ? fill(s.main_body_date, { when: cap(when) }) : fill(s.main_body_date, { when: cap(formatWhen(today, null, today, lang)) });
      return {
        ...base,
        sticky: important,
        title: called(s, 'call_now', name, v),
        body: task.notes ? `${body} · ${task.notes}`.slice(0, 180) : body,
        actions: [{ action: 'done', title: s.a_done }, { action: 'snooze', title: s.a_snooze }],
      };
    }
  }
}

/**
 * "Call again" plan: after a reminder the user did not react to, NORA calls
 * again. Normal tasks: once after 10 min. High priority: after 10 and 25 min.
 * Low priority and silent mode: never. Nudges are dropped as soon as the user
 * opens, snoozes, completes or answers.
 */
/** Minutes after the reminder at which NORA calls again while there is no answer. */
export const NUDGE_MIN = { high: [5, 10, 20, 30, 45, 60, 90, 120], normal: [10, 20, 35, 55, 80, 120], low: [30, 90] } as const;

export function nudgePlan(kind: ReminderKind, priority: Priority, prefs: Preferences, sentAt: Date): PlannedReminder[] {
  if (!['main', 'departure', 'snooze'].includes(kind)) return [];
  if (prefs.sound === 'silent' || !prefs.notifications) return [];
  // NORA keeps calling until the user answers (Done / snooze / opens the task);
  // the dispatcher drops every nudge once the task is no longer 'reminded'.
  const delays = priority === 'high' || prefs.sound === 'important' ? NUDGE_MIN.high : priority === 'low' ? NUDGE_MIN.low : NUDGE_MIN.normal;
  return delays.map((m) => ({ kind: 'nudge' as const, fire_at: new Date(sentAt.getTime() + m * 60000).toISOString(), sound: priority === 'high' ? ('important' as const) : prefs.sound }));
}
