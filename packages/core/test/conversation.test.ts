// End-to-end conversation tests (spec §78) with a scripted AI provider.
// The script returns what the model is instructed to return; the test checks
// that NORA's engine validates, saves, schedules and replies correctly – and
// that short follow-up answers never hit the AI at all.

import { beforeEach, describe, expect, it } from 'vitest';
import { Assistant } from '../src/assistant.ts';
import type { AIProvider, ChatMessage } from '../src/ai.ts';
import { MemoryStore } from '../src/memoryStore.ts';
import { acceptTranscript } from '../src/stt.ts';
import { DEFAULT_PREFERENCES, type Profile } from '../src/types.ts';
import { toZoned } from '../src/tz.ts';

const NOW = new Date('2026-09-23T12:00:00Z'); // Wednesday 14:00 in Rome

class ScriptedAI implements AIProvider {
  name = 'scripted';
  calls: ChatMessage[][] = [];
  private queue: unknown[] = [];
  next(plan: unknown) {
    this.queue.push(plan);
    return this;
  }
  async completeJSON(messages: ChatMessage[]) {
    this.calls.push(messages);
    const plan = this.queue.shift();
    if (plan === undefined) throw new Error('AI was called but no plan was scripted');
    if (plan instanceof Error) throw plan;
    return JSON.stringify(plan);
  }
}

let store: MemoryStore;
let ai: ScriptedAI;
let nora: Assistant;
let n = 0;
const profile: Profile = { id: 'u1', display_name: null, ui_lang: 'ro', conv_lang: 'ro', locale: 'ro-RO', timezone: 'Europe/Rome', prefs: { ...DEFAULT_PREFERENCES } };
const say = (text: string, now = NOW) => nora.handle(text, { conversationId: 'c1', requestId: `r${++n}`, now });
const tasks = () => [...store.tasks.values()];
const local = (iso: string) => {
  const z = toZoned(iso, 'Europe/Rome');
  return `${z.date} ${z.time}`;
};

beforeEach(() => {
  store = new MemoryStore('u1', () => NOW);
  ai = new ScriptedAI();
  nora = new Assistant(store, ai, profile);
});

describe('spec §78 conversation tests', () => {
  it('A – "Mâine am o întâlnire." → "La ce oră?" → "9" = 09:00, no repeated question', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Întâlnire', kind: 'appointment', date: '2026-09-24' } }], ask: { ref: 'new', field: 'time', question: 'La ce oră?' }, reply: '' });
    const r1 = await say('Mâine am o întâlnire.');
    expect(r1.text).toBe('La ce oră?');
    expect(r1.awaiting).toBe('time');
    expect(tasks()[0].status).toBe('needs_clarification');

    const r2 = await say('9');
    expect(ai.calls).toHaveLength(1); // answered on the fast path
    expect(tasks()[0]).toMatchObject({ due_date: '2026-09-24', due_time: '09:00', status: 'scheduled', missing_fields: [] });
    expect(r2.text).toBe('Perfect. Îți amintesc mâine la 9.');
    expect(r2.awaiting).toBeNull();
  });

  it.each(['nouă', 'ora nouă', 'la nouă', 'pe la 9', 'cam la nouă', '09:00', '9 dimineața'])('A – answer "%s" means 09:00', async (answer) => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Întâlnire', kind: 'appointment', date: '2026-09-24' } }], ask: { ref: 'new', field: 'time', question: 'La ce oră?' }, reply: '' });
    await say('Mâine am o întâlnire.');
    await say(answer);
    expect(tasks()[0].due_time).toBe('09:00');
    expect(ai.calls).toHaveLength(1);
  });

  it('B – "Marți la 10 am dentist." → created immediately with reminders', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Dentist', kind: 'appointment', date: '2026-09-29', time: '10:00' } }], ask: null, reply: 'Perfect.' });
    const r = await say('Marți la 10 am dentist.');
    const t = tasks()[0];
    expect(t).toMatchObject({ title: 'Dentist', due_date: '2026-09-29', due_time: '10:00', status: 'scheduled' });
    expect(r.text).toBe('Perfect. Îți amintesc marți la 10.');
    expect(store.pendingReminders(t.id).map((x) => [x.kind, local(x.fire_at)])).toEqual([
      ['prep', '2026-09-28 20:00'],
      ['main', '2026-09-29 09:30'],
      ['followup', '2026-09-29 11:15'],
    ]);
    expect(store.events.map((e) => e.type)).toEqual(['created']);
  });

  it('C – "Amintește-mi să sun contabilul." → "Când?" → "Vineri." accepted without insisting on time', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Sună contabilul', kind: 'call' } }], ask: { ref: 'new', field: 'date', question: 'Când?' }, reply: '' });
    expect((await say('Amintește-mi să sun contabilul.')).text).toBe('Când?');
    const r = await say('Vineri.');
    expect(ai.calls).toHaveLength(1);
    expect(tasks()[0]).toMatchObject({ due_date: '2026-09-25', due_time: null, status: 'scheduled' });
    expect(r.text).toBe('Perfect. Îți amintesc vineri.');
    expect(r.awaiting).toBeNull();
  });

  it('D – "Mută-l la 15." moves the task being discussed', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Dentist', kind: 'appointment', date: '2026-09-29', time: '10:00' } }], ask: null, reply: '' });
    await say('Marți la 10 am dentist.');
    ai.next({ language: 'ro', actions: [{ type: 'update_task', ref: 't1', changes: { time: '15:00' } }], ask: null, reply: '' });
    const r = await say('Mută-l la 15.');
    // the focused task is listed first and marked with *
    expect(ai.calls[1][1].content).toContain('t1* | Dentist');
    expect(tasks()[0]).toMatchObject({ due_time: '15:00', status: 'rescheduled' });
    expect(r.text).toBe('Gata, l-am mutat marți la 15.');
    expect(store.pendingReminders(tasks()[0].id).find((x) => x.kind === 'main')!.fire_at).toBe('2026-09-29T12:30:00.000Z');
  });

  it('E – "Nu mai trebuie." cancels the current task (no AI)', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Dentist', kind: 'appointment', date: '2026-09-29', time: '10:00' } }], ask: null, reply: '' });
    await say('Marți la 10 am dentist.');
    const r = await say('Nu mai trebuie.');
    expect(ai.calls).toHaveLength(1);
    expect(tasks()[0].status).toBe('cancelled');
    expect(store.pendingReminders(tasks()[0].id)).toEqual([]);
    expect(r.text).toBe('Am anulat.');
  });

  it('F – "Am făcut." completes the current task (no AI)', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Sună banca', kind: 'call', date: '2026-09-23', time: '15:00' } }], ask: null, reply: '' });
    await say('Azi la 3 sun banca.');
    const r = await say('Am făcut.');
    expect(ai.calls).toHaveLength(1);
    expect(tasks()[0].status).toBe('completed');
    expect(tasks()[0].completed_at).toBeTruthy();
    expect(r.text).toBe('Super, bifat.');
  });

  it('G – silence never becomes a transcript', () => {
    expect(acceptTranscript({ text: '', duration: 1.2 })).toEqual({ ok: false, reason: 'empty' });
    expect(acceptTranscript({ text: 'Mulțumesc pentru vizionare!', duration: 2 })).toEqual({ ok: false, reason: 'hallucination' });
    expect(acceptTranscript({ text: 'Sottotitoli creati dalla comunità Amara.org', duration: 3 })).toEqual({ ok: false, reason: 'hallucination' });
    expect(acceptTranscript({ text: 'Продолжение следует...', duration: 3 })).toEqual({ ok: false, reason: 'hallucination' });
    expect(acceptTranscript({ text: 'Thank you.', duration: 1 })).toEqual({ ok: false, reason: 'hallucination' });
    expect(acceptTranscript({ text: 'Mâine', duration: 0.2 })).toEqual({ ok: false, reason: 'too_short' });
    expect(acceptTranscript({ text: 'la la', duration: 2, segments: [{ text: 'la la', no_speech_prob: 0.9, avg_logprob: -1.2 }] })).toEqual({ ok: false, reason: 'no_speech' });
    expect(acceptTranscript({ text: 'Mâine la 9 sun contabilul', duration: 2.1, segments: [{ text: 'x', no_speech_prob: 0.01, avg_logprob: -0.2 }] })).toEqual({ ok: true, text: 'Mâine la 9 sun contabilul' });
  });

  it('H – consulate with 2h30 travel → departure planning', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Consulat', kind: 'appointment', date: '2026-09-24', time: '10:00', travel_min: 150 } }], ask: null, reply: '' });
    const r = await say('Mâine la 10 am consulat și fac două ore jumătate până acolo.');
    const t = tasks()[0];
    expect(t.travel_min).toBe(150);
    expect(r.text).toBe('Perfect. Ca să ajungi fără grabă, ar fi bine să pleci în jur de 7.');
    expect(store.pendingReminders(t.id).map((x) => [x.kind, local(x.fire_at)])).toEqual([
      ['prep', '2026-09-23 20:00'],
      ['departure', '2026-09-24 06:45'],
      ['main', '2026-09-24 07:00'],
      ['followup', '2026-09-24 11:15'],
    ]);
  });

  it('I – every Monday at 8 → one recurring task that advances', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Trimite raportul', kind: 'generic', time: '08:00', recurrence: 'FREQ=WEEKLY;BYDAY=MO' } }], ask: null, reply: '' });
    const r = await say('Amintește-mi în fiecare luni la 8 să trimit raportul.');
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0]).toMatchObject({ due_date: '2026-09-28', due_time: '08:00', recurrence: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(r.text).toBe('Perfect. Îți amintesc în fiecare luni la 8.');
    const r2 = await say('Gata');
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0]).toMatchObject({ due_date: '2026-10-05', status: 'scheduled' });
    expect(r2.text).toBe('Bifat. Următoarea dată: pe 5 octombrie la 8.');
  });

  it('J – "Ce am mâine?" is answered from the database', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Dentist', kind: 'appointment', date: '2026-09-24', time: '09:00' } }, { type: 'create_task', task: { title: 'Sună contabilul', kind: 'call', date: '2026-09-24', time: '14:30' } }], ask: null, reply: '' });
    await say('Mâine la 9 dentist și la 14:30 sun contabilul.');
    ai.next({ language: 'ro', actions: [{ type: 'query_tasks', from: '2026-09-24', to: '2026-09-24', text: null, status: 'open' }], ask: null, reply: 'Mâine ai o zi liniștită.' /* model text is ignored */ });
    const r = await say('Ce am mâine?');
    expect(r.text).toBe('Mâine ai: 9 Dentist și 14:30 Sună contabilul.');
    expect(r.results).toHaveLength(2);
  });
});

describe('more behaviour from the spec', () => {
  it('§6 "săptămâna viitoare" → "Știi deja în ce zi?" → "Nu încă" saves the task', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Dentist', kind: 'appointment' } }], ask: { ref: 'new', field: 'date', question: 'Când?' }, reply: '' });
    await say('Trebuie să merg la dentist.');
    expect((await say('Săptămâna viitoare.')).text).toBe('Știi deja în ce zi?');
    const r = await say('Nu încă.');
    expect(r.text).toBe('Bine, l-am notat. Revin să te întreb.');
    expect(tasks()[0].status).toBe('needs_clarification');
    expect(ai.calls).toHaveLength(1);
  });

  it('§10 consulate flow: day → time → travel', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Consulat – pașaport copil', kind: 'appointment' } }], ask: { ref: 'new', field: 'day_in_week', question: 'În ce zi ai programarea?' }, reply: '' });
    expect((await say('Săptămâna viitoare trebuie să merg la consulatul românesc să reînnoiesc pașaportul copilului.')).text).toBe('În ce zi ai programarea?');
    expect((await say('Marți.')).text).toBe('La ce oră?');
    expect((await say('10.')).text).toBe('Perfect. Îți amintesc marți la 10.');
    ai.next({ language: 'ro', actions: [{ type: 'update_task', ref: 't1', changes: { travel_min: 150 } }], ask: null, reply: '' });
    const r = await say('Fac cam două ore jumătate până acolo.');
    expect(r.text).toBe('Perfect. Ca să ajungi fără grabă, ar fi bine să pleci în jur de 7.');
    expect(ai.calls).toHaveLength(2);
  });

  it('§64 correction "Nu, am zis 10, nu 9." updates the current task', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Dentist', kind: 'appointment', date: '2026-09-24', time: '09:00' } }], ask: null, reply: '' });
    await say('Mâine la 9 dentist.');
    ai.next({ language: 'ro', actions: [{ type: 'update_task', ref: 't1', changes: { time: '10:00' } }], ask: null, reply: '' });
    expect((await say('Nu, am zis 10, nu 9.')).text).toBe('Gata, l-am mutat mâine la 10.');
    expect(tasks()).toHaveLength(1);
  });

  it('§31 ambiguous reference asks which task, then replays the request', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Dentist', kind: 'appointment', date: '2026-09-24', time: '09:00' } }, { type: 'create_task', task: { title: 'Contabil', kind: 'call', date: '2026-09-24', time: '11:00' } }], ask: null, reply: '' });
    await say('Mâine la 9 dentist și la 11 contabilul.');
    ai.next({ language: 'ro', actions: [], ask: { ref: 't1', field: 'which', question: '?', options: ['t1', 't2'] }, reply: '' });
    const r = await say('Mută-l la 12.');
    // the most recently discussed task (Contabil) is t1
    expect(r.text).toBe('Te referi la Contabil sau la Dentist?');
    ai.next({ language: 'ro', actions: [{ type: 'update_task', ref: 't1', changes: { time: '12:00' } }], ask: null, reply: '' });
    const r2 = await say('la dentist');
    expect(ai.calls[2].at(-1)!.content).toBe('Mută-l la 12. (Dentist)');
    expect(r2.text).toBe('Gata, l-am mutat mâine la 12.');
  });

  it('§32 quick capture without date', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Cumpără lapte', kind: 'shopping' } }], ask: null, reply: '' });
    const r = await say('Cumpără lapte.');
    expect(r.text).toBe('Notat.');
    expect(tasks()[0]).toMatchObject({ status: 'captured', due_date: null });
    expect(store.pendingReminders(tasks()[0].id)).toEqual([]);
  });

  it('§63 snooze by voice', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Sună banca', kind: 'call', date: '2026-09-23', time: '15:00' } }], ask: null, reply: '' });
    await say('Azi la 3 sun banca.');
    ai.next({ language: 'ro', actions: [{ type: 'snooze_task', ref: 't1', minutes: 20 }], ask: null, reply: '' });
    const r = await say('Mai amintește-mi peste 20 de minute.');
    expect(r.text).toBe('Bine, îți amintesc din nou azi la 14:20.');
    expect(store.pendingReminders(tasks()[0].id).map((x) => x.kind)).toEqual(['snooze', 'followup']);
  });

  it('§11 follow-up "Nu" → offers to remind again → "Da"', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Sună contabilul', kind: 'call', date: '2026-09-23', time: '15:00' } }], ask: null, reply: '' });
    await say('Azi la 3 sun contabilul.');
    // the dispatcher sent the follow-up and set the pending question
    const t = tasks()[0];
    await store.saveState('c1', { focus_task_id: t.id, focus_at: NOW.toISOString(), pending: { task_id: t.id, field: 'followup', asked_at: NOW.toISOString() }, lang: 'ro' });
    expect((await say('Nu.')).text).toBe('Îți amintesc din nou azi la 16?');
    expect((await say('Da')).text).toBe('Bine, îți amintesc din nou azi la 16.');
    expect(tasks()[0].followup_count).toBe(1);
    expect(ai.calls).toHaveLength(1);
  });

  it('§2 language switch mid-conversation', async () => {
    ai.next({ language: 'it', actions: [{ type: 'create_task', task: { title: 'Chiamare il commercialista', kind: 'call', date: '2026-09-24', time: '09:00' } }], ask: null, reply: '' });
    expect((await say('Domani alle 9 devo chiamare il commercialista.')).text).toBe('Perfetto. Te lo ricordo domani alle 9.');
    ai.next({ language: 'en', actions: [{ type: 'create_task', task: { title: 'Pay insurance', kind: 'payment', date: '2026-09-25' } }], ask: null, reply: '' });
    expect((await say('Also remind me to pay the insurance on Friday.')).text).toBe("Done. I'll remind you on Friday.");
  });

  it('§41 the same request twice creates one task', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Dentist', kind: 'appointment', date: '2026-09-24', time: '09:00' } }], ask: null, reply: '' });
    const a = await nora.handle('Mâine la 9 dentist.', { conversationId: 'c1', requestId: 'same', now: NOW });
    const b = await nora.handle('Mâine la 9 dentist.', { conversationId: 'c1', requestId: 'same', now: NOW });
    expect(tasks()).toHaveLength(1);
    expect(b).toEqual(a);
  });

  it('§42 save failure is reported, never "saved"', async () => {
    ai.next({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Dentist', kind: 'appointment', date: '2026-09-24', time: '09:00' } }], ask: null, reply: 'Perfect, am salvat!' });
    store.failNextWrite = true;
    const r = await say('Mâine la 9 dentist.');
    expect(r.text).toBe('Nu am reușit să salvez. Mai încerc?');
    expect(r.path).toBe('error');
    expect(tasks()).toHaveLength(0);
  });

  it('§38 AI down → friendly message, nothing invented', async () => {
    ai.next(new Error('503'));
    const r = await say('Mâine la 9 dentist.');
    expect(r.text).toBe('Nu pot gândi acum, dar pot nota. Încearcă din nou peste puțin.');
    expect(tasks()).toHaveLength(0);
  });

  it('a clearly Romanian message wins even if the model, biased by a short prior turn in another language, self-reports the wrong one', async () => {
    // Reproduces a live bug: after "Норм." (ru), the model kept answering in
    // Russian even though the very next message has Romanian diacritics.
    ai.next({ language: 'ru', actions: [], ask: null, reply: 'Хорошо!' });
    const r1 = await say('Норм.');
    expect(r1.lang).toBe('ru');
    ai.next({ language: 'ru', actions: [{ type: 'create_task', task: { title: 'Cafea', kind: 'generic' } }], ask: null, reply: 'Хорошо, напомню.' });
    const r2 = await say('Amintește-mi, te rog, să iau cafeaua de pe foc peste 30 de secunde.');
    expect(r2.lang).toBe('ro');
  });
});
