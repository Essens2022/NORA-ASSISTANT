// Deterministic natural-language normalisation for short answers
// ("9", "nouă", "pe la 9", "mâine", "marțea viitoare", "două ore jumătate", "gata").
//
// Used for the fast path: when NORA has just asked "La ce oră?" the answer is
// resolved here without calling the LLM at all (fast + free + no loops).
// Anything this module cannot resolve confidently goes to the AI.

import type { Lang } from './types.ts';
import { addDays, daysInMonth, isValidDate, pad, weekdayOf } from './tz.ts';

export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}:.'/\-\s]/gu, ' ')
    // sentence dots go, decimal/time dots ("9.30", "15.10") stay
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


// JS `\b` only knows ASCII letters; NORA also speaks Russian. `ub()` rewrites
// a regex so `\b` means a Unicode word boundary.
const WB = '(?:(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}])|(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}]))';
function ub(re: RegExp): RegExp {
  return new RegExp(re.source.split('\\b').join(WB), re.flags.includes('u') ? re.flags : re.flags + 'u');
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {};
function addNums(list: string, start = 1) {
  list.split(',').forEach((group, i) => {
    for (const w of group.split('|')) NUMBER_WORDS[norm(w)] = start + i;
  });
}
// ro
addNums('unu|una|o|un,doi|doua,trei,patru,cinci,sase,sapte,opt,noua,zece,unsprezece|unspe,doisprezece|douasprezece|doisprece|doispe,treisprezece|treispe,paisprezece|paispe,cincisprezece|cinspe,saisprezece|saispe,saptesprezece|saptispe,optsprezece|optispe,nouasprezece|nouaspe,douazeci');
// en
addNums('one|a|an,two,three,four,five,six,seven,eight,nine,ten,eleven,twelve,thirteen,fourteen,fifteen,sixteen,seventeen,eighteen,nineteen,twenty');
// it
addNums("uno|una|un,due,tre,quattro,cinque,sei,sette,otto,nove,dieci,undici,dodici,tredici,quattordici,quindici,sedici,diciassette,diciotto,diciannove,venti");
// ru
addNums('один|одна|одну|час,два|две,три,четыре,пять,шесть,семь,восемь,девять,десять,одиннадцать,двенадцать,тринадцать,четырнадцать,пятнадцать,шестнадцать,семнадцать,восемнадцать,девятнадцать,двадцать');
Object.assign(NUMBER_WORDS, {
  treizeci: 30, patruzeci: 40, cincizeci: 50,
  thirty: 30, forty: 40, fifty: 50,
  trenta: 30, quaranta: 40, cinquanta: 50,
  [norm('тридцать')]: 30, [norm('сорок')]: 40, [norm('пятьдесят')]: 50,
});
// "o"/"a"/"an"/"un" mean 1 only before a unit – handled by callers.
const ARTICLE_ONE = new Set(['o', 'a', 'an', 'un', "un'"]);

function numberAt(tokens: string[], i: number): { value: number; next: number } | null {
  const t = tokens[i];
  if (t === undefined) return null;
  if (/^\d+$/.test(t)) return { value: +t, next: i + 1 };
  let v = NUMBER_WORDS[t];
  if (v === undefined) return null;
  let next = i + 1;
  // compound tens: "douazeci si unu", "twenty one", "ventuno" (single word handled below)
  if (v >= 20 && v % 10 === 0) {
    const joiner = tokens[next] === 'si' || tokens[next] === 'and' ? next + 1 : next;
    const u = NUMBER_WORDS[tokens[joiner] ?? ''];
    if (u !== undefined && u < 10 && !ARTICLE_ONE.has(tokens[joiner])) {
      v += u;
      next = joiner + 1;
    }
  }
  return { value: v, next };
}

// Italian compounds written as one word (ventuno, ventitre, trentacinque…).
for (const [tens, tv] of [['venti', 20], ['trenta', 30], ['quaranta', 40], ['cinquanta', 50]] as const) {
  const units = ['uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove'];
  units.forEach((u, i) => {
    const w = /^[uo]/.test(u) ? tens.slice(0, -1) + u : tens + u;
    NUMBER_WORDS[w] = tv + i + 1;
  });
}

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

// Note: bare "am" is NOT an AM marker - in Romanian it means "I have".
const AM_WORDS = ['dimineata', 'dimineta', 'morning', 'mattina', 'mattino', 'утра', 'утром'].map(norm);
const PM_WORDS = ['seara', 'dupa-amiaza', 'dupa amiaza', 'dupa-masa', 'dupa masa', 'afternoon', 'evening', 'tonight', 'pomeriggio', 'sera', 'stasera', 'дня', 'вечера', 'вечером'].map(norm);
const NIGHT_WORDS = ['noaptea', 'night', 'notte', 'ночи'].map(norm);
const NOON = ub(/(?<!dupa[- ])\b(amiaza|pranz|noon|midday|mezzogiorno|mezzodi|полдень|полдня)\b/);
const MIDNIGHT = ub(/\b(miezul noptii|midnight|mezzanotte|полночь)\b/);
const HALF_AFTER = new Set(['jumatate', 'jumate', 'half', 'mezza', 'mezzo', 'половиной']);
const QUARTER = new Set(['sfert', 'quarter', 'quarto', 'четверть']);

export interface ParsedTime {
  time: string; // HH:MM
  /** true when AM/PM was inferred rather than stated. */
  inferred: boolean;
}

/**
 * Parse a time of day. "9", "nouă", "ora nouă", "pe la 9", "cam la nouă",
 * "09:00", "9 dimineața", "9 și jumătate", "half past 9", "alle 21", "в 9 утра".
 *
 * Bare hours 1–6 are read as afternoon (13–18); 7–11 as morning; this matches
 * how people speak about appointments. Explicit qualifiers always win.
 */
export function parseTime(text: string): ParsedTime | null {
  const n = norm(text);
  if (!n) return null;
  if (NOON.test(n)) return { time: '12:00', inferred: false };
  if (MIDNIGHT.test(n)) return { time: '00:00', inferred: false };

  const toks = n.split(' ');
  const has = (list: string[]) => toks.some((t) => list.includes(t)) || list.some((w) => w.includes(' ') && n.includes(w));
  const am = has(AM_WORDS) || /\d(am|a\.m\.)(?=\s|$)|\d\s(am|a\.m\.)$/.test(n);
  const pm = has(PM_WORDS) || /\d\s?(pm|p\.m\.)(?=\s|$)/.test(n);
  const night = has(NIGHT_WORDS);

  let hour: number | null = null;
  let minute = 0;

  // 1) digits: 9, 9:30, 9.30, 9h30, 21:00, 9am
  const m = n.match(/(?:^|\s|la|alle|at|в)(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(?:am|pm|a\.m\.|p\.m\.)?(?=\s|$)/);
  if (m) {
    hour = +m[1];
    if (m[2]) minute = +m[2];
    else {
      const after = n.slice((m.index ?? 0) + m[0].length).split(' ').filter(Boolean).slice(0, 3);
      if (after.some((t) => HALF_AFTER.has(t))) minute = 30;
      else if (after.some((t) => QUARTER.has(t))) minute = after.some((t) => t === 'fara' || t === 'meno' || t === 'to' || t === 'без') ? -15 : 15;
    }
  }

  // 2) words: "noua", "ora noua si jumatate", "half past nine", "quarter to ten"
  if (hour === null) {
    for (let i = 0; i < toks.length; i++) {
      if (ARTICLE_ONE.has(toks[i])) continue;
      const num = numberAt(toks, i);
      if (num && num.value >= 0 && num.value <= 24) {
        hour = num.value;
        const rest = toks.slice(num.next);
        // "si jumatate" / "e mezza" / "and a half" / "с половиной"
        if (rest.slice(0, 3).some((t) => HALF_AFTER.has(t))) minute = 30;
        else if (rest.slice(0, 3).some((t) => QUARTER.has(t))) {
          minute = rest.slice(0, 3).some((t) => t === 'fara' || t === 'meno' || t === 'to' || t === 'без') ? -15 : 15;
        } else {
          // "noua si douazeci" -> 9:20 / "nine thirty"
          const joiner = rest[0] === 'si' || rest[0] === 'e' ? 1 : 0;
          const mm = numberAt(rest, joiner);
          if (mm && mm.value > 0 && mm.value < 60 && (joiner === 1 || mm.value >= 10)) minute = mm.value;
        }
        // "half past nine" / "quarter past nine" / "quarter to ten"
        const before = toks.slice(Math.max(0, i - 3), i);
        if (before.includes('half') && before.includes('past')) minute = 30;
        if (before.includes('quarter') && before.includes('past')) minute = 15;
        if (before.includes('quarter') && before.includes('to')) minute = -15;
        break;
      }
    }
  }
  if (hour === null || hour > 24) return null;
  if (minute < 0) {
    hour = hour - 1;
    minute = 60 + minute;
  }
  if (hour === 24) hour = 0;

  let inferred = false;
  if (hour <= 12) {
    if (pm && hour < 12) hour += 12;
    else if (am && hour === 12) hour = 0;
    else if (night) {
      if (hour >= 8 && hour < 12) hour += 12;
      else if (hour === 12) hour = 0;
    } else if (!am && !pm && hour >= 1 && hour <= 6) {
      hour += 12;
      inferred = true;
    } else if (!am && !pm && hour !== 0) inferred = hour < 12;
  }
  if (hour > 23 || minute > 59) return null;
  return { time: `${pad(hour)}:${pad(minute)}`, inferred };
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

const HOUR_UNITS = new Set(['h', 'ora', 'ore', 'orei', 'hour', 'hours', 'hr', 'hrs', "ora'", 'час', 'часа', 'часов'].map(norm));
const MIN_UNITS = new Set(['m', 'min', 'mins', 'minut', 'minute', 'minutes', 'minuti', 'minuto', 'минут', 'минуты', 'минуту'].map(norm));

/**
 * Parse a duration into minutes. "jumătate de oră", "30 de minute",
 * "două ore jumătate", "cam o oră", "1h20", "an hour and a half",
 * "un'ora e mezza", "полтора часа", "два с половиной часа".
 */
export function parseDuration(text: string): number | null {
  const n = norm(text).replace(/un'ora/g, 'un ora').replace(/mezz'ora|mezzora/g, 'mezza ora');
  if (!n) return null;

  const compact = n.match(ub(/(\d+)\s*h\s*(\d{1,2})?\b/));
  if (compact) return +compact[1] * 60 + (compact[2] ? +compact[2] : 0);
  const clock = n.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) return +clock[1] * 60 + +clock[2];

  if (ub(/\b(полтора|полторы)\b/).test(n)) return 90;
  if (ub(/\b(jumatate de ora|half an hour|half hour|mezza ora|полчаса)\b/).test(n) && !ub(/\d|\bore\b|\bhours\b/).test(n.replace(/jumatate de ora|half an hour|mezza ora/g, ''))) return 30;
  if (ub(/\b(sfert de ora|quarter of an hour|quarter hour|un quarto d'ora|quarto d ora|четверть часа)\b/).test(n)) return 15;

  const toks = n.split(' ');
  let total = 0;
  let found = false;
  for (let i = 0; i < toks.length; i++) {
    let num: { value: number; next: number } | null = null;
    if (ARTICLE_ONE.has(toks[i]) && (HOUR_UNITS.has(toks[i + 1]) || (toks[i + 1] === 'de' && HOUR_UNITS.has(toks[i + 2])))) {
      num = { value: 1, next: i + 1 };
    } else {
      num = numberAt(toks, i);
      const d = toks[i]?.match(/^(\d+)[.,](\d+)$/);
      if (!num && d) num = { value: parseFloat(`${d[1]}.${d[2]}`), next: i + 1 };
    }
    if (num) {
      let j = num.next;
      if (toks[j] === 'de') j++;
      if (HOUR_UNITS.has(toks[j])) {
        total += num.value * 60;
        found = true;
        i = j;
        const after = toks.slice(j + 1, j + 4);
        if (after.some((t) => HALF_AFTER.has(t) || t === 'jumatate')) total += 30;
        continue;
      }
      if (MIN_UNITS.has(toks[j])) {
        total += num.value;
        found = true;
        i = j;
        continue;
      }
      // "doua ore jumatate" handled above; "два с половиной часа"
      if (toks[j] === 'с' && toks[j + 1] === norm('половиной') && HOUR_UNITS.has(toks[j + 2])) {
        total += num.value * 60 + 30;
        found = true;
        i = j + 2;
        continue;
      }
    }
    if (toks[i] === 'half' && toks[i + 1] === 'an' && toks[i + 2] === 'hour') {
      total += 30;
      found = true;
      i += 2;
    }
  }
  // "an hour and a half" / "o ora si jumatate"
  if (found && ub(/\b(and a half|e mezza|e mezzo)\b/).test(n) && total % 60 === 0) total += 30;
  // bare "cam o ora" handled via ARTICLE_ONE; bare "ora"/"час"
  if (!found && /^(o ora|ora|час|an hour|one hour|un ora|una ora)$/.test(n)) return 60;
  return found ? Math.round(total) : null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const WEEKDAYS: Array<[number, string[]]> = [
  [1, ['luni', 'lunea', 'monday', 'mon', 'lunedi', 'понедельник']],
  [2, ['marti', 'martea', 'tuesday', 'tue', 'martedi', 'вторник']],
  [3, ['miercuri', 'miercurea', 'wednesday', 'wed', 'mercoledi', 'среда', 'среду']],
  [4, ['joi', 'joia', 'thursday', 'thu', 'giovedi', 'четверг']],
  [5, ['vineri', 'vinerea', 'friday', 'fri', 'venerdi', 'пятница', 'пятницу']],
  [6, ['sambata', 'saturday', 'sat', 'sabato', 'суббота', 'субботу']],
  [0, ['duminica', 'sunday', 'sun', 'domenica', 'воскресенье']],
];
const WEEKDAY_MAP = new Map<string, number>();
for (const [d, list] of WEEKDAYS) for (const w of list) WEEKDAY_MAP.set(norm(w), d);

const MONTHS: string[][] = [
  ['ianuarie', 'january', 'jan', 'gennaio', 'января', 'январь'],
  ['februarie', 'february', 'feb', 'febbraio', 'февраля', 'февраль'],
  ['martie', 'march', 'mar', 'marzo', 'марта', 'март'],
  ['aprilie', 'april', 'apr', 'aprile', 'апреля', 'апрель'],
  ['mai', 'may', 'maggio', 'мая', 'май'],
  ['iunie', 'june', 'jun', 'giugno', 'июня', 'июнь'],
  ['iulie', 'july', 'jul', 'luglio', 'июля', 'июль'],
  ['august', 'aug', 'agosto', 'августа', 'август'],
  ['septembrie', 'september', 'sep', 'sept', 'settembre', 'сентября', 'сентябрь'],
  ['octombrie', 'october', 'oct', 'ottobre', 'октября', 'октябрь'],
  ['noiembrie', 'november', 'nov', 'novembre', 'ноября', 'ноябрь'],
  ['decembrie', 'december', 'dec', 'dicembre', 'декабря', 'декабрь'],
];
const MONTH_MAP = new Map<string, number>();
MONTHS.forEach((list, i) => list.forEach((w) => MONTH_MAP.set(norm(w), i + 1)));

const NEXT_WORDS = new Set(['viitoare', 'viitor', 'next', 'prossimo', 'prossima', 'следующий', 'следующую', 'следующее', 'следующей'].map(norm));
const THIS_WORDS = new Set(['asta', 'aceasta', 'this', 'questo', 'questa', 'эту', 'этот', 'это'].map(norm));

export type VagueWhen = 'next_week' | 'this_week' | 'weekend' | 'next_month';

export interface ParsedDate {
  date: string;
  /** Set when the user gave a vague period, not a concrete day. `date` is then its first day. */
  vague?: VagueWhen;
}

/**
 * Resolve a date relative to `today` (YYYY-MM-DD in the user's timezone).
 * Bare weekday = next occurrence strictly after today; "next <weekday>" =
 * that weekday in next calendar week (Monday-based).
 */
export function parseDate(text: string, today: string): ParsedDate | null {
  const n = norm(text);
  if (!n) return null;
  const toks = n.split(' ');

  if (ub(/\b(poimaine|poimine|day after tomorrow|dopodomani|послезавтра)\b/).test(n)) return { date: addDays(today, 2) };
  if (ub(/\b(maine|miine|tomorrow|tmrw|domani|завтра)\b/).test(n)) return { date: addDays(today, 1) };
  if (ub(/\b(azi|astazi|today|tonight|oggi|stasera|stamattina|сегодня|diseara|in seara asta)\b/).test(n)) return { date: today };

  // in N days
  const inDays = n.match(ub(/\b(?:peste|in|tra|fra|через)\s+(\S+)\s+(?:zile|zi|days|day|giorni|giorno|дня|дней|день)\b/));
  if (inDays) {
    const num = numberAt([inDays[1]], 0);
    if (num) return { date: addDays(today, num.value) };
  }

  const wdToday = weekdayOf(today);
  const mondayThisWeek = addDays(today, -((wdToday + 6) % 7));

  if (ub(/\b(saptamana viitoare|saptamina viitoare|next week|settimana prossima|prossima settimana|на следующей неделе|следующей неделе)\b/).test(n)) {
    // unless a weekday is also given ("marți săptămâna viitoare")
    const wd = toks.map((t) => WEEKDAY_MAP.get(t)).find((d) => d !== undefined);
    if (wd === undefined) return { date: addDays(mondayThisWeek, 7), vague: 'next_week' };
    return { date: addDays(mondayThisWeek, 7 + ((wd + 6) % 7)) };
  }
  if (ub(/\b(weekend|week-end|fine settimana|на выходных|выходные)\b/).test(n)) {
    const sat = addDays(today, (6 - wdToday + 7) % 7 || (wdToday === 6 ? 0 : 7));
    return { date: wdToday === 0 ? today : sat, vague: 'weekend' };
  }
  if (ub(/\b(luna viitoare|next month|il mese prossimo|mese prossimo|в следующем месяце)\b/).test(n)) {
    const [y, m] = today.split('-').map(Number);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return { date: `${ny}-${pad(nm)}-01`, vague: 'next_month' };
  }

  // ISO / numeric dates: 2026-10-15, 15/10, 15.10.2026
  const iso = n.match(ub(/\b(\d{4})-(\d{2})-(\d{2})\b/));
  if (iso && isValidDate(iso[0])) return { date: iso[0] };
  const dm = n.match(ub(/(?<!(?:la|at|alle|ora|в)\s)\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/));
  if (dm) {
    const d = +dm[1];
    const mo = +dm[2];
    let y = dm[3] ? +dm[3] : +today.slice(0, 4);
    if (y < 100) y += 2000;
    const cand = `${y}-${pad(mo)}-${pad(d)}`;
    if (isValidDate(cand)) {
      if (!dm[3] && cand < today) return { date: `${y + 1}-${pad(mo)}-${pad(d)}` };
      return { date: cand };
    }
  }

  // weekday names
  for (let i = 0; i < toks.length; i++) {
    const wd = WEEKDAY_MAP.get(toks[i]);
    if (wd === undefined) continue;
    const around = [toks[i - 1], toks[i + 1], toks[i + 2]];
    const isNext = around.some((t) => t && NEXT_WORDS.has(t));
    const isThis = around.some((t) => t && THIS_WORDS.has(t));
    if (isNext) return { date: addDays(mondayThisWeek, 7 + ((wd + 6) % 7)) };
    const ahead = (wd - wdToday + 7) % 7;
    if (isThis) return { date: addDays(today, ahead) };
    return { date: addDays(today, ahead === 0 ? 7 : ahead) };
  }

  // "15 octombrie", "October 15", "il 15 ottobre", "15 октября"
  for (let i = 0; i < toks.length; i++) {
    const mo = MONTH_MAP.get(toks[i]);
    if (!mo) continue;
    // "mai" is also Romanian for "more" - require an adjacent number
    const dBefore = toks[i - 1]?.match(/^(\d{1,2})(?:st|nd|rd|th|-?го)?$/);
    const dAfter = toks[i + 1]?.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
    const d = dBefore ? +dBefore[1] : dAfter ? +dAfter[1] : null;
    if (d === null) continue;
    const yTok = toks[i + 1]?.match(/^\d{4}$/) ? +toks[i + 1] : toks[i + 2]?.match(/^\d{4}$/) ? +toks[i + 2] : null;
    let y = yTok ?? +today.slice(0, 4);
    let cand = `${y}-${pad(mo)}-${pad(d)}`;
    if (!isValidDate(cand)) return null;
    if (!yTok && cand < today) {
      y += 1;
      cand = `${y}-${pad(mo)}-${pad(d)}`;
    }
    return { date: cand };
  }

  // "pe 15", "on the 15th", "il 15", "15-го"
  const dom = n.match(ub(/(?:^|\b(?:pe|on|the|il|lo|on the)\s+)(\d{1,2})(?:st|nd|rd|th|-?го)?(?:\s|$)/)) ?? n.match(/^(\d{1,2})-?го$/);
  if (dom) {
    const d = +dom[1];
    let [y, m] = today.split('-').map(Number);
    if (d < 1 || d > 31) return null;
    if (d < +today.slice(8, 10)) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    while (d > daysInMonth(y, m)) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return { date: `${y}-${pad(m)}-${pad(d)}` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Short replies
// ---------------------------------------------------------------------------

export type ReplyClass = 'yes' | 'no' | 'not_yet' | 'done' | 'cancel' | 'later';

const REPLY_PATTERNS: Array<[ReplyClass, RegExp]> = [
  ['cancel', ub(/^(nu mai (e nevoie|trebuie|vreau)|nu e nevoie|anuleaza( ?l| ?o)?|sterge( ?l| ?o)?|lasa( ?l| ?o)?( balta)?|renunt|not needed|no longer needed|cancel( it)?|forget (it|about it)|never ?mind|delete it|annulla(lo|la)?|non serve( piu)?|lascia (stare|perdere)|cancella(lo|la)?|отмени(ть)?|не надо|не нужно|удали)\b/)],
  ['done', ub(/^(am facut( ?o| ?l)?|gata|rezolvat|am terminat|am rezolvat|facut|done|did it|i did( it)?|finished|completed|all done|fatto|finito|ho fatto|risolto|сделал[аи]?|сделано|готово|выполнено)\b/)],
  ['not_yet', ub(/^(nu inca|inca nu|nu stiu inca|not yet|don'?t know yet|non ancora|ancora no|non lo so ancora|ещ[её] нет|пока нет|пока не знаю)\b/)],
  ['later', ub(/^(mai tarziu|later|piu tardi|dopo|позже|потом)\b/)],
  ['no', ub(/^(nu|no|nope|nah|non|нет)\b/)],
  ['yes', ub(/^(da|mhm|aha|ok|okay|okey|sigur|bine|fa( ?o| ?l)?|perfect|desigur|yes|yep|yeah|sure|fine|of course|si|certo|va bene|perfetto|d'accordo|да|ок|конечно|хорошо|ладно|давай)\b/)],
];

/** Classify a short reply. Returns null for anything longer than a few words. */
export function classifyReply(text: string): ReplyClass | null {
  const n = norm(text);
  if (!n || n.split(' ').length > 5) return null;
  for (const [cls, re] of REPLY_PATTERNS) if (re.test(n)) return cls;
  return null;
}

// ---------------------------------------------------------------------------
// Language detection (cheap heuristic; the AI result wins when available)
// ---------------------------------------------------------------------------

const LANG_HINTS: Array<[Lang, RegExp]> = [
  ['ro', ub(/\b(maine|trebuie|sa|si|pe|la ora|aminteste|imi|mi|am|nu|da|gata|poimaine|saptamana|ora|dupa|cu|sunt|vreau|asta)\b/)],
  ['it', ub(/\b(domani|devo|ricordami|alle|il|della|sono|oggi|voglio|chiamare|non|si|grazie|dopodomani|settimana|ho|fatto)\b/)],
  ['en', ub(/\b(tomorrow|remind|need|the|at|call|today|want|have|to|my|i|yes|no|done|please|next|week)\b/)],
];

export function detectLang(text: string, fallback: Lang): Lang {
  if (/[Ѐ-ӿ]/.test(text)) return 'ru';
  if (/[ăâîșşțţ]/i.test(text)) return 'ro';
  const n = norm(text);
  let best: Lang = fallback;
  let bestScore = 0;
  for (const [lang, re] of LANG_HINTS) {
    const score = (n.match(new RegExp(re.source, re.flags + 'g')) ?? []).length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  // a single ambiguous hit ("nu", "no", "si") is not enough to switch language
  return bestScore >= (n.split(' ').length <= 2 ? 1 : 2) ? best : fallback;
}
