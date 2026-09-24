// Google sign-in from the installed iOS app: the provider returns into an in-app browser
// that parks the session under a one-time nonce; the installed app claims it.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Route } from 'playwright';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DEFAULT_PREFERENCES, type Profile } from '@nora/core';

const DIST = join(__dirname, '..', 'dist');
const USER = '11111111-1111-4111-8111-111111111111';
const NONCE = 'n'.repeat(43);
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const profile: Profile = { id: USER, display_name: 'Ion', ui_lang: 'ro', conv_lang: 'ro', locale: 'ro-RO', timezone: 'Europe/Rome', prefs: { ...DEFAULT_PREFERENCES } };
const user = { id: USER, email: 'ion@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: {}, created_at: '' };

let server: Server;
let base = '';
let browser: Browser;

const jwt = () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, email: user.email, exp: 4102444800, role: 'authenticated' })}.sig`;
};
const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: data === undefined ? '' : JSON.stringify(data) });

async function context(): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: 'ro-RO', timezoneId: 'Europe/Rome', viewport: { width: 390, height: 844 } });
  await ctx.route('**/auth/v1/**', (r) => json(r, {}));
  await ctx.route('**/functions/v1/api/**', (r) => {
    const path = new URL(r.request().url()).pathname.replace(/^.*\/api/, '');
    if (path === '/v1/bootstrap') return json(r, { profile, onboarded_at: '2026-01-01', conversation_id: 'c', awaiting: null, messages: [], tasks: [], features: { ai: true, stt: true, push: true } });
    return json(r, { ok: true });
  });
  return ctx;
}

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

it('in-app browser: parks the session for the app and does not keep it', async () => {
  const ctx = await context();
  await ctx.route('**/auth/v1/user', (r) => json(r, user));
  let parked: Record<string, string> | null = null;
  let bearer = '';
  await ctx.route('**/rest/v1/rpc/nora_handoff_put', (r) => {
    parked = JSON.parse(r.request().postData() ?? '{}');
    bearer = r.request().headers()['authorization'] ?? '';
    return json(r, undefined, 204);
  });
  const page = await ctx.newPage();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  await page.goto(`${base}/?handoff=${NONCE}#access_token=${jwt()}&refresh_token=R1&expires_in=3600&expires_at=${exp}&token_type=bearer&provider_token=g`);
  await page.getByText('Te-ai conectat').waitFor({ timeout: 10_000 });
  expect(parked).toEqual({ p_nonce: NONCE, p_refresh_token: 'R1' });
  expect(bearer).toBe(`Bearer ${jwt()}`);
  expect(await page.evaluate(() => localStorage.getItem('nora.auth'))).toBeNull();
  expect(page.url()).not.toContain('handoff=');
  await ctx.close();
}, 30_000);

it('installed app: claims the parked session when it comes back', async () => {
  const ctx = await context();
  await ctx.addInitScript((n) => {
    localStorage.setItem('nora.mic_explained', '1');
    localStorage.setItem('nora.handoff', JSON.stringify({ n, t: Date.now() }));
  }, NONCE);
  let claimed = '';
  await ctx.route('**/rest/v1/rpc/nora_handoff_take', (r) => {
    claimed = JSON.parse(r.request().postData() ?? '{}').p_nonce;
    return json(r, 'R1');
  });
  let refreshedWith = '';
  await ctx.route('**/auth/v1/token?grant_type=refresh_token', (r) => {
    refreshedWith = JSON.parse(r.request().postData() ?? '{}').refresh_token;
    return json(r, { access_token: jwt(), refresh_token: 'R2', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user });
  });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.getByRole('button', { name: 'Vorbește cu NORA' }).waitFor({ timeout: 10_000 });
  expect(claimed).toBe(NONCE);
  expect(refreshedWith).toBe('R1');
  expect(await page.evaluate(() => localStorage.getItem('nora.handoff'))).toBeNull();
  await ctx.close();
}, 30_000);
