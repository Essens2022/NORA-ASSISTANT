// Visual showcase: renders the production build with a realistic day and saves screenshots
// (light + dark). Not an assertion-heavy test – it guards against rendering errors.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { addDays, DEFAULT_PREFERENCES, MemoryStore, TaskService, toZoned, type Profile } from '@nora/core';

const DIST = join(__dirname, '..', 'dist');
const SHOTS = process.env.SHOTS_DIR ?? join(__dirname, '..', 'e2e-shots');
const USER = '11111111-1111-4111-8111-111111111111';
const TZ = 'Europe/Rome';
const store = new MemoryStore(USER);
const profile: Profile = { id: USER, display_name: 'Ion', ui_lang: 'ro', conv_lang: 'ro', locale: 'ro-RO', timezone: TZ, prefs: { ...DEFAULT_PREFERENCES } };

let server: Server;
let browser: Browser;
let page: Page;
const errors: string[] = [];

async function seed() {
  const svc = new TaskService(store, profile);
  const now = toZoned(new Date(), TZ);
  const today = now.date;
  const at = (h: number) => `${String(Math.min(23, Math.max(0, h))).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
  // spread today's tasks around "now" so the timeline shows past, next and later
  await svc.create({ title: 'Sună contabilul', kind: 'call', date: today, time: at(Math.max(7, now.hour - 3)) });
  await svc.create({ title: 'Dentist', kind: 'appointment', date: today, time: at(Math.min(22, now.hour + 2)), location: 'Str. Roma 12' });
  await svc.create({ title: 'Trimite raportul', kind: 'generic', date: today, time: at(Math.min(23, now.hour + 4)) });
  await svc.create({ title: 'Consulat – pașaport copil', kind: 'appointment', date: addDays(today, 6), travel_min: 150 }, { missing: ['time'] });
  await svc.create({ title: 'Plătește asigurarea', kind: 'payment', date: addDays(today, 2) });
  await svc.create({ title: 'Cumpără lapte', kind: 'shopping' });
  store.messages.push(
    { conversation: 'c', role: 'user', content: 'Mâine la 10 am consulat și fac două ore jumătate până acolo.' },
    { conversation: 'c', role: 'assistant', content: 'Perfect. Ca să ajungi fără grabă, ar fi bine să pleci în jur de 7.' },
  );
}

beforeAll(async () => {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('build apps/web first');
  await seed();
  server = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = join(DIST, p);
    const target = existsSync(file) && extname(file) ? file : join(DIST, 'index.html');
    const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'text/html' });
    res.end(readFileSync(target));
  });
  await new Promise<void>((r) => server.listen(0, r));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

async function open(theme: 'light' | 'dark', b: Browser = browser, video = false) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: video ? 1 : 2, locale: 'ro-RO', timezoneId: TZ, colorScheme: theme, permissions: ['microphone'], ...(video ? { recordVideo: { dir: SHOTS, size: { width: 390, height: 844 } } } : {}) });
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: USER, exp: 4102444800 })}.x`;
  const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: USER, email: 'ion@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } };
  await ctx.addInitScript((s) => {
    localStorage.setItem('nora.auth', s);
    localStorage.setItem('nora.mic_explained', '1');
  }, JSON.stringify(session));
  await ctx.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/functions/v1/api/**', async (r) => {
    const path = new URL(r.request().url()).pathname.replace(/^.*\/api/, '');
    let body: unknown = { ok: true };
    if (path === '/v1/voice') {
      await new Promise((res) => setTimeout(res, 1800)); // let the "thinking" state show
      body = { heard: false, reason: 'no_speech', reply_text: '' };
    } else if (path === '/v1/bootstrap') {
      body = {
        profile,
        onboarded_at: '2026-01-01',
        conversation_id: 'c',
        awaiting: null,
        messages: store.messages.map((m, i) => ({ id: i + 1, role: m.role, content: m.content })),
        tasks: await store.listTasks({}),
        features: { ai: true, stt: true, push: true },
      };
    } else if (path.startsWith('/v1/tasks/')) {
      const t = await store.getTask(path.split('/')[3]);
      body = { task: t, reminders: store.pendingReminders(t!.id).map((x) => ({ id: x.id, kind: x.kind, fire_at: x.fire_at, status: x.status })), events: [] };
    }
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  await page.getByRole('button', { name: 'Vorbește cu NORA' }).waitFor();
  await page.waitForTimeout(1600);
  return ctx;
}

it('renders the showcase in light and dark', async () => {
  for (const theme of ['light', 'dark'] as const) {
    const ctx = await open(theme);
    await page.screenshot({ path: join(SHOTS, `showcase-home-${theme}.png`) });
    expect(await page.evaluate(() => !!document.querySelector('.organism-canvas') && !document.querySelector('.organism.fallback'))).toBe(true);
    await page.getByRole('button', { name: 'Activitate' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, `showcase-activity-${theme}.png`) });
    await ctx.close();
  }
  expect(errors).toEqual([]);
}, 60_000);


it('records the living orb: idle → listening (fake microphone) → thinking', async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await open('dark', b, true);
  await page.waitForTimeout(2500); // idle breathing
  await page.getByRole('button', { name: 'Vorbește cu NORA' }).click();
  await page.waitForTimeout(3500); // listening to the fake microphone tone
  await page.getByRole('button', { name: 'Oprește ascultarea' }).click().catch(() => {});
  await page.waitForTimeout(2200); // thinking
  const video = page.video();
  await ctx.close();
  await b.close();
  expect(await video?.path()).toBeTruthy();
  console.log('VIDEO', await video?.path());
}, 90_000);
