import { describe, expect, it } from 'vitest';
import { classifyReply, detectLang, parseDate, parseDuration, parseTime } from '../src/parse.ts';

const time = (s: string) => parseTime(s)?.time ?? null;

describe('parseTime', () => {
  it.each([
    ['9', '09:00'],
    ['nouă', '09:00'],
    ['ora nouă', '09:00'],
    ['la nouă', '09:00'],
    ['pe la 9', '09:00'],
    ['cam la nouă', '09:00'],
    ['09:00', '09:00'],
    ['9 dimineața', '09:00'],
    ['10', '10:00'],
    ['la 15', '15:00'],
    ['la 3', '15:00'],
    ['3 dimineața', '03:00'],
    ['9 seara', '21:00'],
    ['9 și jumătate', '09:30'],
    ['nouă și un sfert', '09:15'],
    ['zece fără un sfert', '09:45'],
    ['9.30', '09:30'],
    ['9:30', '09:30'],
    ['la prânz', '12:00'],
    ['la 3 după-amiaza', '15:00'],
    ['mâine la 3 am dentist', '15:00'],
    ['9am', '09:00'],
    ['at 9 pm', '21:00'],
    ['half past nine', '09:30'],
    ['quarter to ten', '09:45'],
    ['noon', '12:00'],
    ['alle 21', '21:00'],
    ['alle nove', '09:00'],
    ['в 9 утра', '09:00'],
    ['в 7 вечера', '19:00'],
    ['девять', '09:00'],
    ['douăsprezece', '12:00'],
  ])('%s → %s', (input, expected) => {
    expect(time(input)).toBe(expected);
  });

  it('returns null for non-times', () => {
    expect(time('nu știu')).toBeNull();
    expect(time('')).toBeNull();
  });
});

describe('parseDuration', () => {
  it.each([
    ['jumătate de oră', 30],
    ['30 de minute', 30],
    ['două ore jumătate', 150],
    ['două ore și jumătate', 150],
    ['cam o oră', 60],
    ['1h20', 80],
    ['o oră și jumătate', 90],
    ['an hour and a half', 90],
    ['half an hour', 30],
    ["un'ora e mezza", 90],
    ['mezz’ora', 30],
    ['полтора часа', 90],
    ['два с половиной часа', 150],
    ['2 hours', 120],
    ['45 min', 45],
    ['fac două ore jumătate până acolo', 150],
  ])('%s → %i', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });
});

describe('parseDate', () => {
  const today = '2026-09-23'; // Wednesday
  it.each([
    ['mâine', '2026-09-24'],
    ['poimâine', '2026-09-25'],
    ['azi', '2026-09-23'],
    ['marți', '2026-09-29'],
    ['vineri', '2026-09-25'],
    ['miercuri', '2026-09-30'],
    ['marțea viitoare', '2026-09-29'],
    ['vinerea viitoare', '2026-10-02'],
    ['vinerea asta', '2026-09-25'],
    ['pe 15', '2026-10-15'],
    ['pe 25', '2026-09-25'],
    ['15 octombrie', '2026-10-15'],
    ['15 august', '2027-08-15'],
    ['October 15', '2026-10-15'],
    ['il 15 ottobre', '2026-10-15'],
    ['15 октября', '2026-10-15'],
    ['next friday', '2026-10-02'],
    ['tomorrow', '2026-09-24'],
    ['domani', '2026-09-24'],
    ['завтра', '2026-09-24'],
    ['во вторник', '2026-09-29'],
    ['15/10', '2026-10-15'],
    ['peste 3 zile', '2026-09-26'],
  ])('%s → %s', (input, expected) => {
    expect(parseDate(input, today)?.date).toBe(expected);
  });

  it('vague periods', () => {
    expect(parseDate('săptămâna viitoare', today)).toEqual({ date: '2026-09-28', vague: 'next_week' });
    expect(parseDate('în weekend', today)).toEqual({ date: '2026-09-26', vague: 'weekend' });
    expect(parseDate('marți săptămâna viitoare', today)).toEqual({ date: '2026-09-29' });
  });

  it('does not read times or "mai" (more) as dates', () => {
    expect(parseDate('la 9.30', today)).toBeNull();
    expect(parseDate('mai târziu', today)).toBeNull();
  });
});

describe('classifyReply', () => {
  it.each([
    ['da', 'yes'], ['mhm', 'yes'], ['ok', 'yes'], ['sigur', 'yes'], ['bine', 'yes'], ['fă', 'yes'], ['perfect', 'yes'],
    ['nu', 'no'], ['lasă', 'cancel'], ['nu mai trebuie', 'cancel'], ['anulează', 'cancel'], ['nu e nevoie', 'cancel'],
    ['am făcut', 'done'], ['gata', 'done'], ['rezolvat', 'done'], ['am terminat', 'done'],
    ['nu încă', 'not_yet'], ['not yet', 'not_yet'], ['mai târziu', 'later'],
    ['done', 'done'], ['fatto', 'done'], ['готово', 'done'], ['да', 'yes'], ['нет', 'no'],
  ])('%s → %s', (input, expected) => {
    expect(classifyReply(input)).toBe(expected);
  });
  it('ignores long sentences', () => {
    expect(classifyReply('nu, am zis 10 nu 9 pentru dentist mâine')).toBeNull();
  });
});

describe('detectLang', () => {
  it('detects', () => {
    expect(detectLang('Mâine trebuie să sun contabilul', 'en')).toBe('ro');
    expect(detectLang('Domani devo chiamare il commercialista', 'ro')).toBe('it');
    expect(detectLang('Remind me to call the bank tomorrow', 'ro')).toBe('en');
    expect(detectLang('Завтра позвонить бухгалтеру', 'ro')).toBe('ru');
    expect(detectLang('9', 'it')).toBe('it');
  });
});
