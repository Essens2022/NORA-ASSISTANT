// i18n: UI strings, locale-aware dates/times. UI language and conversation
// language are independent (UI can be Italian while you talk to NORA in Romanian).

import type { Lang } from '@nora/core';
import { en, type MessageKey } from './en.ts';

type Dict = Record<MessageKey, string>;
const loaders: Record<Lang, () => Promise<Dict>> = {
  en: async () => en,
  ro: async () => (await import('./ro.ts')).ro,
  it: async () => (await import('./it.ts')).it,
  ru: async () => (await import('./ru.ts')).ru,
};

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
  dict = await loaders[lang]();
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
