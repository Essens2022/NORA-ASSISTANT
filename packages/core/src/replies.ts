// NORA's spoken/written replies. Short by default, natural, never robotic.
// Confirmations are generated from templates using the SAVED data (not from
// the LLM's text), so what NORA says always matches what was stored.

import type { Lang, Task } from './types.ts';
import { diffDays, weekdayOf } from './tz.ts';
import { parseRule } from './recurrence.ts';

type Dict = Record<string, string>;

const T: Record<Lang, Dict> = {
  ro: {
    created: 'Perfect. Îți amintesc {when}.',
    confirmed_speech: 'Perfect, îți amintesc.',
    created_ok: 'Perfect. Te anunț din timp.',
    created_inbox: 'Notat.',
    created_departure: 'Perfect. Ca să ajungi fără grabă, ar fi bine să pleci în jur de {dep}.',
    created_recurring: 'Perfect. Îți amintesc {rule}.',
    updated: 'Gata, l-am mutat {when}.',
    updated_generic: 'Gata, am actualizat.',
    completed: 'Super, bifat.',
    completed_next: 'Bifat. Următoarea dată: {when}.',
    cancelled: 'Am anulat.',
    snoozed: 'Bine, îți amintesc din nou {when}.',
    snoozed_speech: 'Bine, îți amintesc din nou.',
    reopened: 'L-am redeschis.',
    ask_time: 'La ce oră?',
    ask_date: 'Când?',
    ask_day_in_week: 'Știi deja în ce zi?',
    ask_title: 'Ce anume să țin minte?',
    saved_unscheduled: 'Bine, l-am notat. Revin să te întreb.',
    which_task: 'Te referi la {options}?',
    or: 'sau la',
    not_found: 'Nu găsesc despre ce e vorba. Poți să-mi spui din nou?',
    query_none: 'Nu ai nimic {range}.',
    query_list: '{Range} ai: {items}.',
    query_none_any: 'Nu găsesc nimic legat de asta.',
    query_found: 'Am găsit: {items}.',
    save_failed: 'Nu am reușit să salvez. Mai încerc?',
    error: 'Ceva nu a mers. Încearcă din nou.',
    ai_unavailable: 'Nu pot gândi acum, dar pot nota. Încearcă din nou peste puțin.',
    followup_q: 'Ai rezolvat: {title}?',
    reschedule_offer: 'Vrei să îl reprogramăm?',
    retry_offer: 'Îți amintesc din nou {when}?',
    ok_leave: 'Bine, rămâne pe listă.',
    remembered: 'Am reținut.',
    nothing_heard: 'Nu am auzit nimic.',
    didnt_understand: 'N-am prins. Mai spune o dată?',
    today: 'azi',
    tomorrow: 'mâine',
    at: 'la {t}',
    on_date: 'pe {d}',
    for_range_today: 'azi',
    for_range_tomorrow: 'mâine',
    every: 'în fiecare',
    every_day: 'în fiecare zi',
    every_month_day: 'lunar, pe {d}',
    every_year: 'în fiecare an, pe {d}',
    every_n_weeks: 'o dată la {n} săptămâni, {day}',
    weekdays: 'în zilele lucrătoare',
  },
  en: {
    created: "Done. I'll remind you {when}.",
    confirmed_speech: "Done, I'll remind you.",
    created_ok: "Done. I'll give you a heads-up in time.",
    created_inbox: 'Got it.',
    created_departure: 'Done. To get there without rushing, leave around {dep}.',
    created_recurring: "Done. I'll remind you {rule}.",
    updated: 'Done, moved it to {when}.',
    updated_generic: 'Done, updated.',
    completed: 'Nice, marked done.',
    completed_next: 'Done. Next time: {when}.',
    cancelled: 'Cancelled.',
    snoozed: "OK, I'll remind you again {when}.",
    snoozed_speech: "OK, I'll remind you again.",
    reopened: 'Reopened.',
    ask_time: 'What time?',
    ask_date: 'When?',
    ask_day_in_week: 'Do you know which day yet?',
    ask_title: 'What should I remember?',
    saved_unscheduled: "OK, noted. I'll check back with you.",
    which_task: 'Do you mean {options}?',
    or: 'or',
    not_found: "I can't tell which one you mean. Could you say it again?",
    query_none: 'Nothing {range}.',
    query_list: '{Range} you have: {items}.',
    query_none_any: "I can't find anything about that.",
    query_found: 'I found: {items}.',
    save_failed: "I couldn't save that. Shall I try again?",
    error: 'Something went wrong. Please try again.',
    ai_unavailable: "I can't think right now, but I can take notes. Try again in a moment.",
    followup_q: 'Did you get it done: {title}?',
    reschedule_offer: 'Shall we reschedule it?',
    retry_offer: 'Remind you again {when}?',
    ok_leave: "OK, it stays on your list.",
    remembered: 'Noted.',
    nothing_heard: "I didn't hear anything.",
    didnt_understand: "I didn't catch that. Say it again?",
    today: 'today',
    tomorrow: 'tomorrow',
    at: 'at {t}',
    on_date: 'on {d}',
    for_range_today: 'today',
    for_range_tomorrow: 'tomorrow',
    every: 'every',
    every_day: 'every day',
    every_month_day: 'every month on the {d}',
    every_year: 'every year on {d}',
    every_n_weeks: 'every {n} weeks on {day}',
    weekdays: 'every weekday',
  },
  it: {
    created: 'Perfetto. Te lo ricordo {when}.',
    confirmed_speech: 'Perfetto, te lo ricordo.',
    created_ok: 'Perfetto. Ti avviso in tempo.',
    created_inbox: 'Segnato.',
    created_departure: 'Perfetto. Per arrivare senza fretta, parti verso le {dep}.',
    created_recurring: 'Perfetto. Te lo ricordo {rule}.',
    updated: 'Fatto, spostato a {when}.',
    updated_generic: 'Fatto, aggiornato.',
    completed: 'Ottimo, fatto.',
    completed_next: 'Fatto. La prossima volta: {when}.',
    cancelled: 'Annullato.',
    snoozed: 'Va bene, te lo ricordo di nuovo {when}.',
    snoozed_speech: 'Va bene, te lo ricordo di nuovo.',
    reopened: 'Riaperto.',
    ask_time: 'A che ora?',
    ask_date: 'Quando?',
    ask_day_in_week: 'Sai già che giorno?',
    ask_title: 'Cosa devo ricordare?',
    saved_unscheduled: 'Va bene, l’ho segnato. Ti richiedo più avanti.',
    which_task: 'Intendi {options}?',
    or: 'o',
    not_found: 'Non capisco a quale ti riferisci. Puoi ripetere?',
    query_none: 'Niente {range}.',
    query_list: '{Range} hai: {items}.',
    query_none_any: 'Non trovo niente su questo.',
    query_found: 'Ho trovato: {items}.',
    save_failed: 'Non sono riuscita a salvare. Riprovo?',
    error: 'Qualcosa è andato storto. Riprova.',
    ai_unavailable: 'Adesso non riesco a ragionare, ma posso prendere nota. Riprova tra poco.',
    followup_q: 'Sei riuscito: {title}?',
    reschedule_offer: 'Vuoi spostarlo?',
    retry_offer: 'Te lo ricordo di nuovo {when}?',
    ok_leave: 'Va bene, resta nella lista.',
    remembered: 'Me lo ricordo.',
    nothing_heard: 'Non ho sentito niente.',
    didnt_understand: 'Non ho capito. Puoi ripetere?',
    today: 'oggi',
    tomorrow: 'domani',
    at: 'alle {t}',
    on_date: 'il {d}',
    for_range_today: 'oggi',
    for_range_tomorrow: 'domani',
    every: 'ogni',
    every_day: 'ogni giorno',
    every_month_day: 'ogni mese il {d}',
    every_year: 'ogni anno il {d}',
    every_n_weeks: 'ogni {n} settimane, {day}',
    weekdays: 'nei giorni feriali',
  },
  ru: {
    created: 'Готово. Напомню {when}.',
    confirmed_speech: 'Готово, напомню.',
    created_ok: 'Готово. Предупрежу заранее.',
    created_inbox: 'Записала.',
    created_departure: 'Готово. Чтобы доехать без спешки, лучше выехать около {dep}.',
    created_recurring: 'Готово. Буду напоминать {rule}.',
    updated: 'Готово, перенесла на {when}.',
    updated_generic: 'Готово, обновила.',
    completed: 'Отлично, отмечено.',
    completed_next: 'Отмечено. В следующий раз: {when}.',
    cancelled: 'Отменила.',
    snoozed: 'Хорошо, напомню снова {when}.',
    snoozed_speech: 'Хорошо, напомню снова.',
    reopened: 'Вернула в список.',
    ask_time: 'Во сколько?',
    ask_date: 'Когда?',
    ask_day_in_week: 'Уже знаешь, в какой день?',
    ask_title: 'Что именно запомнить?',
    saved_unscheduled: 'Хорошо, записала. Спрошу позже.',
    which_task: 'Ты про {options}?',
    or: 'или',
    not_found: 'Не понимаю, о чём речь. Повторишь?',
    query_none: 'Ничего {range}.',
    query_list: '{Range} у тебя: {items}.',
    query_none_any: 'Ничего не нахожу об этом.',
    query_found: 'Нашла: {items}.',
    save_failed: 'Не получилось сохранить. Попробовать ещё раз?',
    error: 'Что-то пошло не так. Попробуй ещё раз.',
    ai_unavailable: 'Сейчас не могу подумать, но могу записать. Попробуй чуть позже.',
    followup_q: 'Получилось: {title}?',
    reschedule_offer: 'Перенесём?',
    retry_offer: 'Напомнить снова {when}?',
    ok_leave: 'Хорошо, оставлю в списке.',
    remembered: 'Запомнила.',
    nothing_heard: 'Я ничего не услышала.',
    didnt_understand: 'Не расслышала. Повторишь?',
    today: 'сегодня',
    tomorrow: 'завтра',
    at: 'в {t}',
    on_date: '{d}',
    for_range_today: 'на сегодня',
    for_range_tomorrow: 'на завтра',
    every: 'каждый',
    every_day: 'каждый день',
    every_month_day: 'каждый месяц {d}-го',
    every_year: 'каждый год {d}',
    every_n_weeks: 'раз в {n} недели, {day}',
    weekdays: 'по будням',
  },
};

const LOCALE: Record<Lang, string> = { ro: 'ro-RO', en: 'en-US', it: 'it-IT', ru: 'ru-RU' };

// Russian: "во вторник", "в среду"; also "каждый понедельник / каждую среду / каждое воскресенье".
const RU_ON = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];
const RU_EVERY = ['каждое воскресенье', 'каждый понедельник', 'каждый вторник', 'каждую среду', 'каждый четверг', 'каждую пятницу', 'каждую субботу'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function t(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const s = T[lang]?.[key] ?? T.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (k in vars) return String(vars[k]);
    const lower = k[0].toLowerCase() + k.slice(1);
    if (lower in vars) {
      const v = String(vars[lower]);
      return v.charAt(0).toUpperCase() + v.slice(1);
    }
    return '';
  });
}

function weekdayName(date: string, lang: Lang): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

function dayMonth(date: string, lang: Lang): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALE[lang], { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Spoken time: "9", "9:30", "15" (24h) or "9 AM" (12h). */
export function spokenTime(time: string, lang: Lang, hour12?: boolean | null): string {
  const [h, m] = time.split(':').map(Number);
  const use12 = hour12 ?? lang === 'en';
  if (use12) {
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
  }
  return m ? `${h}:${String(m).padStart(2, '0')}` : String(h);
}

function atTime(time: string, lang: Lang, hour12?: boolean | null): string {
  const s = spokenTime(time, lang, hour12);
  if (lang === 'it') {
    if (time === '01:00') return "all'una";
    if (time === '00:00') return 'a mezzanotte';
  }
  return t(lang, 'at', { t: s });
}

/** "mâine la 9", "marți la 10:30", "pe 15 octombrie", "tomorrow at 9 AM", "во вторник в 10". */
export function formatWhen(date: string | null, time: string | null, today: string, lang: Lang, hour12?: boolean | null): string {
  const parts: string[] = [];
  if (date) {
    const dd = diffDays(today, date);
    if (dd === 0) parts.push(t(lang, 'today'));
    else if (dd === 1) parts.push(t(lang, 'tomorrow'));
    else if (dd > 1 && dd < 7) {
      const wd = weekdayOf(date);
      if (lang === 'ru') parts.push(RU_ON[wd]);
      else if (lang === 'en') parts.push(`on ${EN_DAYS[wd]}`);
      else parts.push(weekdayName(date, lang));
    } else parts.push(t(lang, 'on_date', { d: dayMonth(date, lang) }));
  }
  if (time) parts.push(atTime(time, lang, hour12));
  return parts.join(' ');
}

/** Human description of a recurrence rule. */
export function describeRule(rrule: string, time: string | null, lang: Lang, anchorDate: string | null, hour12?: boolean | null): string {
  const r = parseRule(rrule);
  const at = time ? ` ${atTime(time, lang, hour12)}` : '';
  if (!r) return at.trim();
  if (r.freq === 'DAILY') return t(lang, 'every_day') + at;
  if (r.freq === 'WEEKLY') {
    const days = r.byDay.map((b) => b.day);
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return t(lang, 'weekdays') + at;
    const d0 = days[0] ?? (anchorDate ? weekdayOf(anchorDate) : 1);
    const name = (d: number) => {
      const ref = `2026-01-${String(4 + d).padStart(2, '0')}`; // 2026-01-04 is a Sunday
      return lang === 'en' ? EN_DAYS[d] : weekdayName(ref, lang);
    };
    if (r.interval > 1) return t(lang, 'every_n_weeks', { n: r.interval, day: days.map(name).join(', ') || name(d0) }) + at;
    if (lang === 'ru') return (days.length ? days : [d0]).map((d) => RU_EVERY[d]).join(', ') + at;
    if (lang === 'it') {
      const list = (days.length ? days : [d0]).map(name);
      return `ogni ${list.join(', ')}` + at;
    }
    return `${t(lang, 'every')} ${(days.length ? days : [d0]).map(name).join(', ')}` + at;
  }
  if (r.freq === 'MONTHLY') {
    const d = r.byMonthDay ?? (anchorDate ? Number(anchorDate.slice(8, 10)) : 1);
    return t(lang, 'every_month_day', { d: lang === 'en' ? ordinal(d) : d }) + at;
  }
  return t(lang, 'every_year', { d: anchorDate ? dayMonth(anchorDate, lang) : '' }) + at;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function taskLine(task: Pick<Task, 'title' | 'due_time'>, lang: Lang, hour12?: boolean | null): string {
  return task.due_time ? `${spokenTime(task.due_time, lang, hour12)} ${task.title}` : task.title;
}

export function joinList(items: string[], lang: Lang): string {
  if (items.length <= 1) return items.join('');
  const and = { ro: 'și', en: 'and', it: 'e', ru: 'и' }[lang];
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}
