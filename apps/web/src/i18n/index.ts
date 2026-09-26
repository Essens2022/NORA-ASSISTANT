// i18n: UI strings, locale-aware dates/times. UI language and conversation
// language are independent (UI can be Italian while you talk to NORA in Romanian).

import type { Lang } from '@nora/core';
import { en, type MessageKey } from './en.ts';
import { it } from './it.ts';
import { ro } from './ro.ts';
import { ru } from './ru.ts';

type Dict = Record<MessageKey, string>;
// bundled, not lazy: switching screens or languages never waits on the network
const dicts: Record<Lang, Dict> = { en, ro, it, ru };

export const LANG_NAMES: Record<Lang, string> = { en: 'English', ro: 'Română', it: 'Italiano', ru: 'Русский' };
export const DEFAULT_LOCALE: Record<Lang, string> = { en: 'en-US', ro: 'ro-RO', it: 'it-IT', ru: 'ru-RU' };

let dict: Dict = en;
let current: Lang = 'en';
let locale = 'en-US';
let hour12: boolean | undefined;
const listeners = new Set<() => void>();

export function detectDeviceLang(): Lang {
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l.slice(0, 2).toLowerCase();
    if (code === 'ro' || code === 'it' || code === 'ru' || code === 'en') return code;
    if (code === 'mo') return 'ro';
  }
  return 'en';
}

export async function setLang(lang: Lang): Promise<void> {
  dict = dicts[lang];
  current = lang;
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export function setFormat(opts: { locale?: string; hour12?: boolean | null }) {
  if (opts.locale) locale = opts.locale;
  hour12 = opts.hour12 ?? undefined;
  listeners.forEach((l) => l());
}

export const getLang = () => current;
export const getLocale = () => locale;
export const onI18nChange = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function tr(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const s = dict[key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Like tr(), but in a specific language instead of the current UI language — for
 * text that must speak/read as a given language regardless of what's on screen
 * (e.g. a voice preview: hearing it in Italian only makes sense if it's Italian). */
export function trIn(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const s = dicts[lang]?.[key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Plural-aware message: looks up `${base}.one|few|many|other` with Intl.PluralRules. */
export function tp(base: string, n: number, vars: Record<string, string | number> = {}): string {
  const cat = new Intl.PluralRules(current).select(n);
  const key = (`${base}.${cat}` in dict ? `${base}.${cat}` : `${base}.other`) as MessageKey;
  return tr(key, { n, ...vars });
}

/** "in 2 hours" / "peste 2 ore" / "tra 2 ore" / "через 2 часа". */
export function relativeFromNow(iso: string): string {
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(current, { numeric: 'auto' });
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

const dateFmt = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${hour12}|${JSON.stringify(opts)}`;
  let f = dateFmt.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, ...(opts.hour ? { hour12 } : {}) });
    dateFmt.set(key, f);
  }
  return f;
}

const asUTC = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

/** "09:00" → "09:00" or "9:00 AM" by locale / preference. */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return fmt({ hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
}

/** Locale date: 23/09/2026 (it), 09/23/2026 (en-US). */
export function formatDate(date: string, style: 'short' | 'long' = 'short'): string {
  return style === 'short'
    ? fmt({ day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(asUTC(date))
    : fmt({ weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(asUTC(date));
}

/** "Today", "Tomorrow", "Friday", "15 Oct". */
export function relativeDay(date: string, today: string): string {
  const diff = Math.round((asUTC(date).getTime() - asUTC(today).getTime()) / 86400000);
  if (diff >= -1 && diff <= 1) {
    const s = new Intl.RelativeTimeFormat(current, { numeric: 'auto' }).format(diff, 'day');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (diff > 1 && diff < 7) {
    const s = fmt({ weekday: 'long', timeZone: 'UTC' }).format(asUTC(date));
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return fmt({ day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' }).format(asUTC(date));
}

export function formatInstant(iso: string, tz: string): string {
  return fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
}

export type { MessageKey };
