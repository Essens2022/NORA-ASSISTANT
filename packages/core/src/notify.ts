// Notification content per reminder kind, in the user's language.
// Max two action buttons – that is what most platforms show.

import { departureTime } from './reminders.ts';
import { formatWhen, spokenTime } from './replies.ts';
import type { Lang, Preferences, Reminder, Task } from './types.ts';

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
  lang: Lang;
}

const S: Record<Lang, Record<string, string>> = {
  ro: {
    prep_body: 'Mâine: {what}. Ai pregătit tot ce-ți trebuie?',
    departure_title: 'Plecare: {title}',
    departure_body: 'În aproximativ 15 minute ar trebui să pleci.',
    leave_body: 'Ca să ajungi {at} fără grabă, ar fi bine să pleci acum.',
    now_body: 'Acum',
    main_body: '{when}',
    followup_body: 'Ai rezolvat?',
    followup_chat: 'Ai rezolvat: {title}?',
    a_done: 'Gata',
    a_snooze: 'Peste 15 min',
    a_left: 'Am plecat',
    a_yes: 'Da, gata',
    a_notyet: 'Încă nu',
    a_open: 'Deschide',
  },
  en: {
    prep_body: 'Tomorrow: {what}. Got everything ready?',
    departure_title: 'Leave soon: {title}',
    departure_body: 'You should leave in about 15 minutes.',
    leave_body: 'To get there {at} without rushing, leave now.',
    now_body: 'Now',
    main_body: '{when}',
    followup_body: 'Did you get it done?',
    followup_chat: 'Did you get it done: {title}?',
    a_done: 'Done',
    a_snooze: 'In 15 min',
    a_left: "I've left",
    a_yes: 'Yes, done',
    a_notyet: 'Not yet',
    a_open: 'Open',
  },
  it: {
    prep_body: 'Domani: {what}. Hai preparato tutto?',
    departure_title: 'Partenza: {title}',
    departure_body: 'Tra circa 15 minuti dovresti partire.',
    leave_body: 'Per arrivare {at} senza fretta, parti adesso.',
    now_body: 'Adesso',
    main_body: '{when}',
    followup_body: 'Ci sei riuscito?',
    followup_chat: 'Ci sei riuscito: {title}?',
    a_done: 'Fatto',
    a_snooze: 'Tra 15 min',
    a_left: 'Sono partito',
    a_yes: 'Sì, fatto',
    a_notyet: 'Non ancora',
    a_open: 'Apri',
  },
  ru: {
    prep_body: 'Завтра: {what}. Всё подготовлено?',
    departure_title: 'Выезд: {title}',
    departure_body: 'Примерно через 15 минут пора выходить.',
    leave_body: 'Чтобы успеть {at} без спешки, выходи сейчас.',
    now_body: 'Сейчас',
    main_body: '{when}',
    followup_body: 'Получилось?',
    followup_chat: 'Получилось: {title}?',
    a_done: 'Готово',
    a_snooze: 'Через 15 мин',
    a_left: 'Выехал(а)',
    a_yes: 'Да, готово',
    a_notyet: 'Ещё нет',
    a_open: 'Открыть',
  },
};

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

export function buildNotification(r: Pick<Reminder, 'kind' | 'sound' | 'action_token'>, task: Task, lang: Lang, prefs: Preferences, today: string): NotificationPayload {
  const s = S[lang] ?? S.en;
  const hour12 = prefs.hour12;
  const base = { tag: `task-${task.id}`, task_id: task.id, token: r.action_token, kind: r.kind, sound: r.sound, lang };
  const at = task.due_time ? formatWhen(null, task.due_time, today, lang, hour12) : '';
  const dep = departureTime(task, prefs);

  switch (r.kind) {
    case 'prep': {
      const what = task.due_time ? `${task.title} ${at}` : task.title;
      return { ...base, title: task.title, body: fill(s.prep_body, { what }), actions: [{ action: 'open', title: s.a_open }, { action: 'done', title: s.a_done }] };
    }
    case 'departure':
      return { ...base, title: fill(s.departure_title, { title: task.title }), body: dep ? `${s.departure_body} (${spokenTime(dep, lang, hour12)})` : s.departure_body, actions: [{ action: 'done', title: s.a_left }, { action: 'snooze', title: s.a_snooze }] };
    case 'followup': {
      const chat = fill(s.followup_chat, { title: task.title });
      return { ...base, title: task.title, body: s.followup_body, chat, actions: [{ action: 'done', title: s.a_yes }, { action: 'notyet', title: s.a_notyet }] };
    }
    default: {
      if (r.kind === 'main' && dep && task.travel_min) {
        return { ...base, title: task.title, body: fill(s.leave_body, { at }), actions: [{ action: 'done', title: s.a_left }, { action: 'snooze', title: s.a_snooze }] };
      }
      const when = task.due_date && task.due_date !== today ? formatWhen(task.due_date, task.due_time, today, lang, hour12) : at || s.now_body;
      const body = task.notes ? `${when} · ${task.notes}`.slice(0, 160) : when.charAt(0).toUpperCase() + when.slice(1);
      return { ...base, title: task.title, body, actions: [{ action: 'done', title: s.a_done }, { action: 'snooze', title: s.a_snooze }] };
    }
  }
}
