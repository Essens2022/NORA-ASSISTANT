// Tapping a reminder notification opens NORA's full-screen reminder moment.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Route } from 'playwright';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DEFAULT_PREFERENCES, type Profile } from '@nora/core';

const DIST = join(__dirname, '..', 'dist');
const SHOTS = process.env.SHOTS_DIR ?? join(__dirname, '..', 'e2e-shots');
const USER = '11111111-1111-4111-8111-111111111111';
const TASK = '44444444-4444-4444-8444-444444444444';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const profile: Profile = { id: USER, display_name: 'Ion', ui_lang: 'ro', conv_lang: 'ro', locale: 'ro-RO', timezone: 'Europe/Rome', prefs: { ...DEFAULT_PREFERENCES, voice_replies: false } };
const task = { id: TASK, user_id: USER, title: 'Dentist', kind: 'appointment', status: 'reminded', priority: 'normal', due_date: '2026-09-24', due_time: '10:00', time_window: null, location: 'Str. Roma 12', missing_fields: [], notes: null, rrule: null, created_at: '', updated_at: '' };

let server: Server;
let base = '';
let browser: Browser;
const json = (r: Route, d: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });

beforeAll(async () => {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('build apps/web first (npm run test:e2e does it)');
  server = createServer((req, res) => {
    const file = join(DIST, decodeURIComponent((req.url ?? '/').split('?')[0]));
    const target = existsSync(file) && extname(file) ? file : join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream' });
    res.end(readFileSync(target));
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

it('notification tap → full-screen reminder with big actions; "Am făcut" completes the task', async () => {
  const ctx = await browser.newContext({ locale: 'ro-RO', timezoneId: 'Europe/Rome', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: USER, exp: 4102444800 })}.x`;
  const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: USER, email: 'ion@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } };
  await ctx.addInitScript((s) => {
    localStorage.setItem('nora.auth', s);
    localStorage.setItem('nora.mic_explained', '1');
  }, JSON.stringify(session));
  await ctx.route('**/auth/v1/**', (r) => json(r, {}));
  const calls: string[] = [];
  await ctx.route('**/functions/v1/api/**', (r) => {
    const path = new URL(r.request().url()).pathname.replace(/^.*\/api/, '');
    calls.push(`${r.request().method()} ${path}`);
    if (path === '/v1/bootstrap') return json(r, { profile, onboarded_at: '2026-01-01', conversation_id: 'c', awaiting: null, messages: [], tasks: [task], features: { ai: true, stt: true, push: true } });
    if (path.endsWith('/complete')) return json(r, { task: { ...task, status: 'completed', completed_at: new Date().toISOString() } });
    if (path === '/v1/tasks') return json(r, { tasks: [task] });
    return json(r, { ok: true });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/?task=${TASK}&alert=1`);
  const dialog = page.getByRole('alertdialog');
  await dialog.getByText('Ion, e momentul').waitFor({ timeout: 10_000 });
  await expect(dialog.getByRole('heading', { name: 'Dentist' }).isVisible()).resolves.toBe(true);
  expect(page.url()).not.toContain('alert=1');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'reminder-alert.png') });
  await dialog.getByRole('button', { name: /Am făcut/ }).click();
  await dialog.waitFor({ state: 'detached' });
  expect(calls).toContain(`POST /v1/tasks/${TASK}/complete`);
  expect(errors).toEqual([]);
  await ctx.close();
}, 30_000);
