// End-to-end UI test: real Chromium, real production build, real NORA core engine.
// The HTTP API is emulated in-process with the same contract as supabase/functions/api,
// backed by core's Assistant + MemoryStore; only the LLM is replaced by a rule-based stub.
//
// Run: npm run test:e2e   (builds apps/web with test env first)

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Assistant, DEFAULT_PREFERENCES, MemoryStore, TaskService, toZoned, type AIProvider, type ChatMessage, type Profile } from '@nora/core';

const DIST = join(__dirname, '..', 'dist');
const SHOTS = process.env.SHOTS_DIR ?? join(__dirname, '..', 'e2e-shots');
const USER = '11111111-1111-4111-8111-111111111111';

// --- fake LLM: understands just the phrases this test uses -------------------
class RuleAI implements AIProvider {
  name = 'rules';
  async completeJSON(messages: ChatMessage[]) {
    const text = messages[messages.length - 1].content.toLowerCase();
    const ctx = messages[1].content;
    const tomorrow = ctx.match(/(\d{4}-\d{2}-\d{2}) \(tomorrow\)/)![1];
    if (text.includes('întâlnire'))
      return JSON.stringify({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Întâlnire', kind: 'appointment', date: tomorrow } }], ask: { ref: 'new', field: 'time', question: 'La ce oră?' }, reply: '' });
    if (text.includes('lapte')) return JSON.stringify({ language: 'ro', actions: [{ type: 'create_task', task: { title: 'Cumpără lapte', kind: 'shopping' } }], ask: null, reply: '' });
    if (text.includes('ce am mâine')) return JSON.stringify({ language: 'ro', actions: [{ type: 'query_tasks', from: tomorrow, to: tomorrow, status: 'open' }], ask: null, reply: '' });
    return JSON.stringify({ language: 'ro', actions: [], ask: null, reply: 'Bună! Spune-mi ce vrei să țin minte.' });
  }
}

// --- API emulation ------------------------------------------------------------
const store = new MemoryStore(USER);
const profile: Profile = { id: USER, display_name: null, ui_lang: 'ro', conv_lang: 'ro', locale: 'ro-RO', timezone: 'Europe/Rome', prefs: { ...DEFAULT_PREFERENCES } };
let onboardedAt: string | null = null;
const memory = [{ id: '22222222-2222-4222-8222-222222222222', user_id: USER, kind: 'preference', key: 'reminder_style', value: 'Preferă remindere cu 30 de minute înainte', created_at: '', updated_at: '' }];
const CONV = '33333333-3333-4333-8333-333333333333';
const calls: string[] = [];

const svc = () => new TaskService(store, profile);
const open = ['captured', 'needs_clarification', 'scheduled', 'upcoming', 'reminded', 'acknowledged', 'in_progress', 'missed', 'rescheduled'] as const;

async function handleApi(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const path = url.pathname.replace(/^.*\/api/, '');
  const m = req.method();
  calls.push(`${m} ${path}`);
  const body = () => (req.postData() ? JSON.parse(req.postData()!) : {});
  const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  let seg: RegExpMatchArray | null;

  if (path === '/v1/bootstrap') {
    const tasks = await store.listTasks({ statuses: [...open] });
    const messages = store.messages.map((x, i) => ({ id: i + 1, role: x.role, content: x.content, meta: x.meta }));
    return ok({ profile, onboarded_at: onboardedAt, conversation_id: CONV, awaiting: (await store.getState(CONV)).pending?.field ?? null, messages, tasks, features: { ai: true, stt: true, push: true } });
  }
  if (path === '/v1/chat') {
    const b = body();
    const reply = await new Assistant(store, new RuleAI(), profile).handle(b.text, { conversationId: CONV, requestId: b.request_id });
    const tasks = (await Promise.all(reply.task_ids.map((id) => store.getTask(id)))).filter(Boolean);
    return ok({ reply, conversation_id: CONV, tasks });
  }
  if (path === '/v1/tasks' && m === 'GET') {
    const scope = url.searchParams.get('scope');
    return ok({ tasks: await store.listTasks({ statuses: scope === 'completed' ? ['completed'] : [...open] }) });
  }
  if (path === '/v1/tasks' && m === 'POST') {
    const b = body();
    return ok({ task: await svc().create(b, { requestId: b.request_id }) });
  }
  if ((seg = path.match(/^\/v1\/tasks\/([^/]+)\/(complete|cancel|reopen|snooze)$/))) {
    const t = (await store.getTask(seg[1]))!;
    if (seg[2] === 'complete') return ok({ task: (await svc().complete(t)).task });
    if (seg[2] === 'cancel') return ok({ task: await svc().cancel(t) });
    if (seg[2] === 'reopen') return ok({ task: await svc().reopen(t) });
    const until = new Date(Date.now() + 30 * 60000);
    return ok({ task: await svc().snooze(t, until), until: until.toISOString() });
  }
  if ((seg = path.match(/^\/v1\/tasks\/([^/]+)$/))) {
    const t = (await store.getTask(seg[1]))!;
    if (m === 'GET') {
      return ok({
        task: t,
        reminders: store.reminders.filter((r) => r.task_id === t.id && r.status === 'pending').map((r) => ({ id: r.id, kind: r.kind, fire_at: r.fire_at, status: r.status })),
        events: store.events.filter((e) => e.task_id === t.id).map((e) => ({ type: e.type, created_at: new Date().toISOString() })),
      });
    }
    if (m === 'PATCH') {
      const b = body();
      return ok({ task: await svc().update(t, b, Object.keys(b).includes('time') ? ['time'] : []) });
    }
    if (m === 'DELETE') {
      store.tasks.delete(t.id);
      return ok({ ok: true });
    }
  }
  if (path === '/v1/me' && m === 'PATCH') {
    const b = body();
    if (b.onboarded) onboardedAt = new Date().toISOString();
    for (const k of ['display_name', 'ui_lang', 'conv_lang', 'locale', 'timezone'] as const) if (k in b) (profile as Record<string, unknown>)[k] = b[k];
    if (b.prefs) profile.prefs = { ...profile.prefs, ...b.prefs };
    return ok({ profile, onboarded_at: onboardedAt });
  }
  if (path.startsWith('/v1/memory')) {
    if (m === 'DELETE') memory.splice(0);
    return ok({ items: memory });
  }
  if (path === '/v1/push/key') return ok({ publicKey: null });
  return ok({ ok: true });
}

// --- static server for the production build ----------------------------------
let server: Server;
let base = '';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };

let browser: Browser;
let ctx: BrowserContext;
let page: Page;
const errors: string[] = [];

function fakeJwt() {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, email: 'ion@example.com', exp: 4102444800, role: 'authenticated' })}.sig`;
}

beforeAll(async () => {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('build apps/web first (npm run test:e2e does it)');
  server = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = join(DIST, p);
    const target = existsSync(file) && extname(file) ? file : join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream' });
    res.end(readFileSync(target));
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ro-RO', timezoneId: 'Europe/Rome', deviceScaleFactor: 2, hasTouch: true });
  const session = { access_token: fakeJwt(), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: USER, email: 'ion@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } };
  await ctx.addInitScript((s) => localStorage.setItem('nora.auth', s), JSON.stringify(session));
  await ctx.route('**/functions/v1/api/**', handleApi);
  await ctx.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

const shot = async (name: string) => {
  await page.waitForTimeout(350); // let entry animations finish
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

describe('NORA web – end to end', () => {
  it('onboarding: promise first, notification permission explained, can skip', async () => {
    await page.goto(base);
    await page.getByRole('heading', { name: 'Spui o singură dată' }).waitFor();
    await expect(page.getByText('Spune-mi o dată. Eu țin minte.')).toBeTruthy();
    await shot('01-onboarding');
    await page.getByRole('button', { name: 'Începe' }).click();
    // the notification step is shown only where the browser can ask for permission
    const later = page.getByRole('button', { name: 'Mai târziu' });
    const home = page.getByRole('button', { name: 'Vorbește cu NORA' });
    await Promise.race([later.waitFor(), home.waitFor()]);
    if (await later.isVisible()) {
      await page.getByRole('button', { name: 'Permite notificările' }).waitFor();
      await shot('02-onboarding-notifications');
      await later.click();
    }
    await home.waitFor();
    expect(onboardedAt).not.toBeNull();
    await shot('03-home-empty');
  }, 30_000);

  it('spec test A in the UI: "Mâine am o întâlnire." → "La ce oră?" → "9"', async () => {
    const input = page.getByLabel('Scrie-i Norei…');
    await input.fill('Mâine am o întâlnire.');
    await input.press('Enter');
    await page.getByText('La ce oră?').waitFor();
    await input.fill('9');
    await page.getByRole('button', { name: 'Trimite' }).click();
    await page.getByText('Perfect. Îți amintesc mâine la 9.').waitFor();
    const t = [...store.tasks.values()][0];
    expect(t.due_time).toBe('09:00');
    await page.getByText('Următorul').waitFor();
    await shot('04-conversation');
  }, 30_000);

  it('quick capture and database-backed question', async () => {
    const input = page.getByLabel('Scrie-i Norei…');
    await input.fill('Cumpără lapte');
    await input.press('Enter');
    await page.getByText('Notat.').waitFor();
    await input.fill('Ce am mâine?');
    await input.press('Enter');
    await page.getByText('Mâine ai: 9 Întâlnire.').waitFor();
  }, 30_000);

  it('activity shows sections; task persists after reload', async () => {
    await page.getByRole('button', { name: 'Activitate' }).click();
    await page.getByRole('heading', { name: /Urmează/ }).waitFor();
    await page.getByRole('heading', { name: /Fără dată/ }).waitFor();
    await page.getByText('Întâlnire').first().waitFor();
    await shot('05-activity');
    await page.reload();
    await page.getByRole('heading', { name: /Urmează/ }).waitFor();
    await page.getByText('Cumpără lapte').waitFor();
  }, 30_000);

  it('task detail: reminders, reschedule, snooze, complete with undo', async () => {
    await page.getByRole('button', { name: /Întâlnire/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Remindere').waitFor();
    await dialog.getByText('Verificare').waitFor(); // follow-up is always planned; prep depends on the time of day
    await shot('06-task-detail');

    await dialog.getByRole('button', { name: 'Reprogramează' }).click();
    await dialog.getByLabel('Ora').fill('10:30');
    await dialog.getByRole('button', { name: 'Salvează' }).click();
    await dialog.getByText('10:30').waitFor();
    expect([...store.tasks.values()].find((x) => x.title === 'Întâlnire')!.due_time).toBe('10:30');

    await dialog.getByRole('button', { name: 'Amintește-mi mai târziu' }).click();
    await dialog.getByRole('button', { name: 'Peste 30 min' }).click();
    await page.getByText(/Bine, îți amintesc/).waitFor();

    await dialog.getByRole('button', { name: 'Finalizează' }).click();
    await page.getByText('Bifat ✓').waitFor();
    expect([...store.tasks.values()].find((x) => x.title === 'Întâlnire')!.status).toBe('completed');
    await page.getByRole('button', { name: 'Anulează' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Întâlnire'));
    await expect.poll(() => [...store.tasks.values()].find((x) => x.title === 'Întâlnire')!.status).not.toBe('completed');
  }, 40_000);

  it('checkbox completes a task; completed section loads', async () => {
    await page.getByRole('checkbox', { name: 'Marchează „Cumpără lapte” ca făcut' }).click();
    await page.getByRole('button', { name: 'Arată finalizatele' }).click();
    await page.getByRole('heading', { name: 'Finalizate' }).waitFor();
    await expect.poll(() => [...store.tasks.values()].find((x) => x.title === 'Cumpără lapte')!.status).toBe('completed');
  }, 20_000);

  it('manual task creation', async () => {
    await page.getByRole('button', { name: 'Task nou' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Titlu').fill('Plătește asigurarea');
    await dialog.getByLabel('Data').fill(toZoned(new Date(Date.now() + 3 * 86400000), 'Europe/Rome').date);
    await dialog.getByLabel('Tip').selectOption('payment');
    await dialog.getByRole('button', { name: 'Salvează' }).click();
    await page.getByText('Plătește asigurarea').waitFor();
    expect([...store.tasks.values()].some((t) => t.title === 'Plătește asigurarea' && t.kind === 'payment')).toBe(true);
  }, 20_000);

  it('profile: every control persists (language, reminder prefs, memory)', async () => {
    await page.getByRole('button', { name: 'Profil' }).click();
    await page.getByRole('heading', { name: 'Profil' }).waitFor();
    await shot('07-profile');

    await page.getByRole('switch', { name: 'Amintește-mi cu o seară înainte de programări' }).click();
    await expect.poll(() => profile.prefs.day_before).toBe(false);
    await page.getByLabel('Amintește-mi cu', { exact: true }).selectOption('60');
    await expect.poll(() => profile.prefs.reminder_lead_min).toBe(60);
    await page.getByRole('radio', { name: '12 ore' }).click();
    await expect.poll(() => profile.prefs.hour12).toBe(true);
    await page.getByText('Preferă remindere cu 30 de minute înainte').waitFor();

    await page.getByLabel('Limba aplicației').selectOption('it');
    await page.getByRole('heading', { name: 'Profilo' }).waitFor();
    expect(profile.ui_lang).toBe('it');
    await page.reload();
    await page.getByRole('heading', { name: 'Profilo' }).waitFor();
    await page.getByRole('button', { name: 'Attività' }).waitFor();
    expect(await page.getByRole('switch', { name: /sera prima/ }).getAttribute('aria-checked')).toBe('false');
  }, 40_000);

  it('dark mode renders and no runtime errors happened', async () => {
    await page.getByRole('radio', { name: 'Scuro' }).click();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await page.getByRole('button', { name: 'NORA', exact: true }).click();
    await shot('08-home-dark');
    await page.getByRole('button', { name: 'Attività' }).click();
    await shot('09-activity-dark');
    expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
  }, 20_000);
});
