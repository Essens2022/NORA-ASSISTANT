// NORA API v1 – one function, small router (fewer cold starts than many functions).
//
//   POST   /v1/chat                       text → NORA reply (+ touched tasks)
//   POST   /v1/voice                      audio → STT (silence guard) → chat
//   GET    /v1/bootstrap                  profile + tasks + conversation for first paint
//   GET    /v1/tasks  POST /v1/tasks      list / create manually
//   GET    /v1/tasks/:id                  task + reminders + history
//   PATCH  /v1/tasks/:id                  edit
//   POST   /v1/tasks/:id/{complete|cancel|reopen|snooze}
//   DELETE /v1/tasks/:id
//   GET|PATCH /v1/me                      profile & preferences
//   GET|PATCH|DELETE /v1/memory[/:id]     what NORA remembers
//   POST|DELETE /v1/devices               push subscriptions
//   GET    /v1/push/key   POST /v1/push/test
//   POST   /v1/notify-action              notification buttons (token auth)
//   GET    /v1/export   DELETE /v1/account
//   POST   /v1/metrics

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  acceptTranscript,
  Assistant,
  clarifiedFields,
  isOpen,
  isValidTimeZone,
  LANGS,
  snoozeUntil,
  t,
  TaskService,
  toZoned,
  validateTaskFields,
  type Lang,
  type Preferences,
  type Profile,
  type SnoozePreset,
  type Task,
} from '../_shared/core/index.ts';
import { cors, HttpError, json, log, readJson } from '../_shared/http.ts';
import { aiFromEnv, sttFromEnv } from '../_shared/providers.ts';
import { pushToUser, vapidFromEnv } from '../_shared/push.ts';
import { rowToProfile, rowToTask, SupabaseStore } from '../_shared/store.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const ai = aiFromEnv();
const stt = sttFromEnv();

const OPEN_STATUSES = ['captured', 'needs_clarification', 'scheduled', 'upcoming', 'reminded', 'acknowledged', 'in_progress', 'missed', 'rescheduled'] as const;

interface Ctx {
  req: Request;
  url: URL;
  rid: string;
  userId: string;
  db: SupabaseClient;
  store: SupabaseStore;
  profile: Profile;
}

// ---------------------------------------------------------------------------
// Auth & context
// ---------------------------------------------------------------------------

async function authed(req: Request, url: URL, rid: string): Promise<Ctx> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token === ANON_KEY) throw new HttpError(401, 'unauthorized');
  const db = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data, error } = await db.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) throw new HttpError(401, 'unauthorized');

  let { data: row } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (!row) {
    // profile trigger missed (e.g. user created before migration) – create it
    const { data: created } = await admin.from('profiles').upsert({ id: userId }).select('*').single();
    row = created;
  }
  const profile = rowToProfile(row!);
  const ctx: Ctx = { req, url, rid, userId, db, store: new SupabaseStore(db, userId), profile };
  await syncTimezone(ctx);
  return ctx;
}

/** The user travelled: floating tasks follow the device's timezone (spec §28). */
async function syncTimezone(ctx: Ctx) {
  const tz = ctx.req.headers.get('x-timezone');
  if (!tz || tz === ctx.profile.timezone || !isValidTimeZone(tz)) return;
  await ctx.db.from('profiles').update({ timezone: tz }).eq('id', ctx.userId);
  ctx.profile = { ...ctx.profile, timezone: tz };
  const open = await ctx.store.listTasks({ statuses: [...OPEN_STATUSES], limit: 200 });
  const svc = new TaskService(ctx.store, ctx.profile);
  for (const task of open) {
    if (task.time_binding === 'floating' && task.due_date && task.timezone !== tz) {
      const moved = await ctx.store.patchTask(task.id, { timezone: tz });
      await svc.replan(moved);
    }
  }
  log('timezone_changed', { rid: ctx.rid, tz });
}

async function conversationId(ctx: Ctx, requested?: string | null): Promise<string> {
  if (requested) {
    const { data } = await ctx.db.from('conversations').select('id').eq('id', requested).maybeSingle();
    if (data) return data.id;
  }
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data: recent } = await ctx.db.from('conversations').select('id').gte('updated_at', since).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (recent) return recent.id;
  const { data: created, error } = await ctx.db.from('conversations').insert({ user_id: ctx.userId, state: {} }).select('id').single();
  if (error) throw new HttpError(500, 'conversation_failed');
  return created.id;
}

const svcOf = (ctx: Ctx) => new TaskService(ctx.store, ctx.profile);
const requestId = (ctx: Ctx, body?: { request_id?: unknown }) => (typeof body?.request_id === 'string' && body.request_id.length <= 80 ? body.request_id : ctx.rid);

async function loadTask(ctx: Ctx, id: string): Promise<Task> {
  const task = await ctx.store.getTask(id);
  if (!task) throw new HttpError(404, 'task_not_found');
  return task;
}

async function tasksByIds(ctx: Ctx, ids: string[]): Promise<Task[]> {
  if (!ids.length) return [];
  const { data } = await ctx.db.from('tasks').select('*').in('id', ids);
  return (data ?? []).map(rowToTask);
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

async function chat(ctx: Ctx, text: string, convRequested: string | null, reqId: string) {
  const conv = await conversationId(ctx, convRequested);
  const nora = new Assistant(ctx.store, ai, ctx.profile, (event, data) => log(event, { rid: ctx.rid, ...data }));
  const started = Date.now();
  const reply = await nora.handle(text, { conversationId: conv, requestId: reqId });
  const ms = Date.now() - started;
  log('chat', { rid: ctx.rid, path: reply.path, ms, awaiting: reply.awaiting, lang: reply.lang });
  void admin.from('metrics').insert({ user_id: ctx.userId, name: 'chat_latency_ms', value: ms, props: { path: reply.path } });
  if (reply.lang !== ctx.profile.conv_lang) void ctx.db.from('profiles').update({ conv_lang: reply.lang }).eq('id', ctx.userId);
  return { reply, conversation_id: conv, tasks: await tasksByIds(ctx, reply.task_ids) };
}

async function voice(ctx: Ctx) {
  if (!stt) throw new HttpError(503, 'stt_unavailable');
  const form = await ctx.req.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof File) || audio.size < 1200) return { heard: false, reason: 'too_short', reply_text: t(ctx.profile.conv_lang ?? ctx.profile.ui_lang, 'nothing_heard') };
  if (audio.size > 8 * 1024 * 1024) throw new HttpError(413, 'audio_too_large');
  const clientDuration = Number(form!.get('duration') ?? 0);
  const conv = (form!.get('conversation_id') as string) || null;
  const reqId = ((form!.get('request_id') as string) || ctx.rid).slice(0, 80);
  const lang = (ctx.profile.conv_lang ?? ctx.profile.ui_lang) as Lang;

  const started = Date.now();
  let result;
  try {
    result = await stt.transcribe(audio, { prompt: 'NORA' });
  } catch (err) {
    log('stt_error', { rid: ctx.rid, error: String(err).slice(0, 200) });
    void admin.from('metrics').insert({ user_id: ctx.userId, name: 'stt_error', value: 1 });
    throw new HttpError(502, 'stt_failed');
  }
  const sttMs = Date.now() - started;
  if (result.duration == null && clientDuration) result.duration = clientDuration;
  const verdict = acceptTranscript(result);
  void admin.from('metrics').insert({ user_id: ctx.userId, name: 'stt_latency_ms', value: sttMs, props: { ok: verdict.ok } });
  log('stt', { rid: ctx.rid, ms: sttMs, ok: verdict.ok, reason: verdict.ok ? null : verdict.reason, detected: result.language });
  if (!verdict.ok) return { heard: false, reason: verdict.reason, reply_text: t(lang, 'nothing_heard') };
  return { heard: true, transcript: verdict.text, ...(await chat(ctx, verdict.text, conv, reqId)) };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

async function listTasks(ctx: Ctx) {
  const scope = ctx.url.searchParams.get('scope') ?? 'active';
  let q = ctx.db.from('tasks').select('*');
  if (scope === 'active') q = q.in('status', [...OPEN_STATUSES]);
  else if (scope === 'completed') q = q.eq('status', 'completed').order('completed_at', { ascending: false }).limit(50);
  const { data, error } = await q.order('due_date', { ascending: true, nullsFirst: false }).order('due_time', { ascending: true, nullsFirst: false }).limit(300);
  if (error) throw new HttpError(500, 'list_failed');
  return { tasks: (data ?? []).map(rowToTask) };
}

async function createTask(ctx: Ctx) {
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const errors: string[] = [];
  const fields = validateTaskFields(body, errors);
  if (!fields.title) throw new HttpError(400, 'title_required');
  if (errors.length) throw new HttpError(400, 'invalid_fields');
  const task = await svcOf(ctx).create({ ...fields, title: fields.title }, { requestId: requestId(ctx, body) });
  return { task };
}

async function updateTask(ctx: Ctx, id: string) {
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const errors: string[] = [];
  const changes = validateTaskFields(body, errors);
  if (errors.length) throw new HttpError(400, 'invalid_fields');
  const task = await loadTask(ctx, id);
  const clarified = clarifiedFields(changes);
  return { task: await svcOf(ctx).update(task, changes, clarified) };
}

async function taskAction(ctx: Ctx, id: string, action: string) {
  const task = await loadTask(ctx, id);
  const svc = svcOf(ctx);
  switch (action) {
    case 'complete':
      if (!isOpen(task.status)) return { task };
      return { task: (await svc.complete(task)).task };
    case 'cancel':
      if (!isOpen(task.status)) return { task };
      return { task: await svc.cancel(task) };
    case 'reopen':
      if (isOpen(task.status)) return { task };
      return { task: await svc.reopen(task) };
    case 'snooze': {
      const body = await readJson<{ preset?: SnoozePreset; minutes?: number; until?: string }>(ctx.req);
      const now = new Date();
      const today = toZoned(now, ctx.profile.timezone).date;
      let until: Date;
      if (body.until && !Number.isNaN(Date.parse(body.until))) until = new Date(body.until);
      else if (typeof body.minutes === 'number' && body.minutes > 0 && body.minutes <= 20160) until = new Date(now.getTime() + body.minutes * 60000);
      else if (body.preset && ['10m', '30m', '1h', '2h', 'tonight', 'tomorrow'].includes(body.preset)) until = snoozeUntil(body.preset, now, ctx.profile.timezone, ctx.profile.prefs, today);
      else throw new HttpError(400, 'invalid_snooze');
      if (until.getTime() <= now.getTime()) throw new HttpError(400, 'invalid_snooze');
      return { task: await svc.snooze(task, until), until: until.toISOString() };
    }
  }
  throw new HttpError(404, 'not_found');
}

async function taskDetail(ctx: Ctx, id: string) {
  let task = await loadTask(ctx, id);
  if (task.status === 'reminded') {
    // the user looked at it: stop calling again
    task = await ctx.store.patchTask(id, { status: 'acknowledged' });
    await ctx.store.replaceReminders(id, [], ['nudge']);
    await ctx.store.logEvent(id, 'acknowledged');
  }
  const [{ data: reminders }, { data: events }] = await Promise.all([
    ctx.db.from('reminders').select('id, kind, fire_at, status, sent_at').eq('task_id', id).in('status', ['pending', 'sent']).order('fire_at'),
    ctx.db.from('task_events').select('type, data, created_at').eq('task_id', id).order('created_at', { ascending: false }).limit(30),
  ]);
  return { task, reminders: reminders ?? [], events: events ?? [] };
}

// ---------------------------------------------------------------------------
// Profile, memory, devices
// ---------------------------------------------------------------------------

const PREF_SPEC: Record<keyof Preferences, (v: unknown) => boolean> = {
  reminder_lead_min: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1440,
  travel_buffer_min: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 240,
  day_before: (v) => typeof v === 'boolean',
  default_time: (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  evening_time: (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  followups: (v) => typeof v === 'boolean',
  max_followups: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 5,
  sound: (v) => v === 'silent' || v === 'normal' || v === 'important',
  notifications: (v) => typeof v === 'boolean',
  hour12: (v) => v === null || typeof v === 'boolean',
  personalization: (v) => typeof v === 'boolean',
  voice_replies: (v) => typeof v === 'boolean',
};
const REPLAN_KEYS: Array<keyof Preferences> = ['reminder_lead_min', 'travel_buffer_min', 'day_before', 'default_time', 'evening_time', 'followups', 'sound', 'notifications'];

async function updateMe(ctx: Ctx) {
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const patch: Record<string, unknown> = {};
  if (typeof body.display_name === 'string' || body.display_name === null) patch.display_name = (body.display_name as string | null)?.slice(0, 60) || null;
  if ((LANGS as readonly string[]).includes(body.ui_lang as string)) patch.ui_lang = body.ui_lang;
  if (body.conv_lang === null || (LANGS as readonly string[]).includes(body.conv_lang as string)) patch.conv_lang = body.conv_lang;
  if (typeof body.locale === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(body.locale)) patch.locale = body.locale;
  if (typeof body.timezone === 'string' && isValidTimeZone(body.timezone)) patch.timezone = body.timezone;
  if (body.onboarded === true) patch.onboarded_at = new Date().toISOString();
  let replan = false;
  if (body.prefs && typeof body.prefs === 'object') {
    const next: Partial<Preferences> = {};
    for (const [k, v] of Object.entries(body.prefs as Record<string, unknown>)) {
      const key = k as keyof Preferences;
      if (!(key in PREF_SPEC)) continue;
      if (!PREF_SPEC[key](v)) throw new HttpError(400, `invalid_pref_${key}`);
      (next as Record<string, unknown>)[key] = v;
      if (REPLAN_KEYS.includes(key) && ctx.profile.prefs[key] !== v) replan = true;
    }
    patch.prefs = { ...ctx.profile.prefs, ...next };
  }
  const { data, error } = await ctx.db.from('profiles').update(patch).eq('id', ctx.userId).select('*').single();
  if (error) throw new HttpError(500, 'profile_update_failed');
  ctx.profile = rowToProfile(data);
  if (replan || patch.timezone) {
    // preferences change future reminders (spec §79)
    const svc = svcOf(ctx);
    const today = toZoned(new Date(), ctx.profile.timezone).date;
    const open = await ctx.store.listTasks({ statuses: [...OPEN_STATUSES], from: today, limit: 300 });
    for (const task of open) await svc.replan(patch.timezone && task.time_binding === 'floating' ? await ctx.store.patchTask(task.id, { timezone: ctx.profile.timezone }) : task);
  }
  return { profile: ctx.profile, onboarded_at: data.onboarded_at };
}

async function memoryRoute(ctx: Ctx, id: string | null) {
  const m = ctx.req.method;
  if (m === 'GET') {
    const { data } = await ctx.db.from('memory_items').select('*').order('updated_at', { ascending: false });
    return { items: data ?? [] };
  }
  if (m === 'DELETE' && !id) {
    await ctx.db.from('memory_items').delete().eq('user_id', ctx.userId);
    return { ok: true };
  }
  if (m === 'DELETE' && id) {
    await ctx.db.from('memory_items').delete().eq('id', id);
    return { ok: true };
  }
  if (m === 'PATCH' && id) {
    const body = await readJson<{ value?: string }>(ctx.req);
    if (typeof body.value !== 'string' || !body.value.trim()) throw new HttpError(400, 'invalid_value');
    const { data, error } = await ctx.db.from('memory_items').update({ value: body.value.trim().slice(0, 300) }).eq('id', id).select('*').single();
    if (error) throw new HttpError(404, 'not_found');
    return { item: data };
  }
  if (m === 'POST') {
    const body = await readJson<{ key?: string; value?: string }>(ctx.req);
    if (!body.key?.trim() || !body.value?.trim()) throw new HttpError(400, 'invalid_value');
    await ctx.store.remember(body.key.trim().slice(0, 60), body.value.trim().slice(0, 300));
    return { ok: true };
  }
  throw new HttpError(405, 'method_not_allowed');
}

async function devicesRoute(ctx: Ctx) {
  const body = await readJson<{ endpoint?: string; keys?: { p256dh?: string; auth?: string }; lang?: string }>(ctx.req);
  if (typeof body.endpoint !== 'string' || !/^https:\/\//.test(body.endpoint)) throw new HttpError(400, 'invalid_endpoint');
  if (ctx.req.method === 'DELETE') {
    await ctx.db.from('devices').delete().eq('endpoint', body.endpoint);
    return { ok: true };
  }
  if (!body.keys?.p256dh || !body.keys?.auth) throw new HttpError(400, 'invalid_keys');
  // endpoint is globally unique; a browser re-subscribing under another account moves to it
  await admin.from('devices').delete().eq('endpoint', body.endpoint).neq('user_id', ctx.userId);
  const { error } = await ctx.db.from('devices').upsert(
    { user_id: ctx.userId, kind: 'webpush', endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth }, user_agent: ctx.req.headers.get('user-agent')?.slice(0, 200), lang: body.lang ?? null, last_seen_at: new Date().toISOString(), disabled_at: null },
    { onConflict: 'endpoint' },
  );
  if (error) throw new HttpError(500, 'device_failed');
  return { ok: true };
}

async function pushTest(ctx: Ctx) {
  const vapid = vapidFromEnv();
  if (!vapid) throw new HttpError(503, 'push_unavailable');
  const lang = ctx.profile.ui_lang;
  const title = { ro: 'NORA funcționează', en: 'NORA is working', it: 'NORA funziona', ru: 'NORA работает' }[lang];
  const body = { ro: 'Așa vei primi reminderele.', en: "This is how your reminders will look.", it: 'Così riceverai i promemoria.', ru: 'Так будут выглядеть напоминания.' }[lang];
  const res = await pushToUser(admin, ctx.userId, { title, body, tag: 'nora-test', kind: 'test', sound: ctx.profile.prefs.sound, actions: [], lang }, vapid);
  return res;
}

// ---------------------------------------------------------------------------
// Notification buttons – authenticated by the reminder's unguessable token
// ---------------------------------------------------------------------------

async function notifyAction(req: Request, rid: string) {
  const body = await readJson<{ token?: string; action?: string; minutes?: number }>(req);
  if (!body.token || !/^[0-9a-f-]{36}$/i.test(body.token)) throw new HttpError(400, 'invalid_token');
  const { data: rem } = await admin.from('reminders').select('id, task_id, user_id, sent_at').eq('action_token', body.token).maybeSingle();
  if (!rem) throw new HttpError(404, 'not_found');
  const [{ data: prow }] = await Promise.all([admin.from('profiles').select('*').eq('id', rem.user_id).single()]);
  const profile = rowToProfile(prow!);
  const store = new SupabaseStore(admin, rem.user_id);
  const task = await store.getTask(rem.task_id);
  if (!task || task.user_id !== rem.user_id) throw new HttpError(404, 'not_found');
  const svc = new TaskService(store, profile);
  const lang = (profile.conv_lang ?? profile.ui_lang) as Lang;
  let text = '';
  switch (body.action) {
    case 'done':
      if (isOpen(task.status)) await svc.complete(task);
      text = t(lang, 'completed');
      break;
    case 'snooze': {
      const until = new Date(Date.now() + (body.minutes && body.minutes > 0 && body.minutes <= 1440 ? body.minutes : 15) * 60000);
      if (isOpen(task.status)) await svc.snooze(task, until);
      text = t(lang, 'snoozed', { when: '' }).trim();
      break;
    }
    case 'notyet': {
      if (isOpen(task.status)) await svc.notYet(task);
      text = t(lang, 'ok_leave');
      break;
    }
    case 'open':
      if (task.status === 'reminded') await store.patchTask(task.id, { status: 'acknowledged' });
      await store.replaceReminders(task.id, [], ['nudge']);
      await store.logEvent(task.id, 'opened');
      break;
    default:
      throw new HttpError(400, 'invalid_action');
  }
  log('notify_action', { rid, action: body.action });
  void admin.from('metrics').insert({ user_id: rem.user_id, name: 'notification_action', value: 1, props: { action: body.action } });
  return { ok: true, text };
}

// ---------------------------------------------------------------------------
// Data export & deletion (privacy)
// ---------------------------------------------------------------------------

async function exportData(ctx: Ctx) {
  const tables = ['profiles', 'tasks', 'reminders', 'task_events', 'conversations', 'messages', 'memory_items', 'devices'] as const;
  const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
  for (const table of tables) {
    const { data } = await ctx.db.from(table).select('*').limit(10000);
    out[table] = data ?? [];
  }
  return out;
}

async function deleteAccount(ctx: Ctx) {
  const body = await readJson<{ confirm?: string }>(ctx.req);
  if (body.confirm !== 'DELETE') throw new HttpError(400, 'confirmation_required');
  // all user tables cascade from auth.users
  const { error } = await admin.auth.admin.deleteUser(ctx.userId);
  if (error) throw new HttpError(500, 'delete_failed');
  log('account_deleted', { rid: ctx.rid });
  return { ok: true };
}

const METRIC_NAMES = new Set(['app_open', 'tti_ms', 'voice_start', 'voice_roundtrip_ms', 'onboarding_done', 'notification_opened', 'client_error']);
async function metric(ctx: Ctx) {
  const body = await readJson<{ name?: string; value?: number; props?: Record<string, unknown> }>(ctx.req);
  if (!body.name || !METRIC_NAMES.has(body.name)) throw new HttpError(400, 'invalid_metric');
  const props = Object.fromEntries(Object.entries(body.props ?? {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 8));
  await ctx.db.from('metrics').insert({ user_id: ctx.userId, name: body.name, value: typeof body.value === 'number' ? body.value : null, props });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/api(?=\/)/, '').replace(/\/+$/, '');
  const rid = req.headers.get('x-request-id')?.slice(0, 80) || crypto.randomUUID();
  const m = req.method;
  const started = Date.now();
  try {
    // public routes
    if (path === '/v1/push/key' && m === 'GET') return json({ publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? null }, 200, { 'Cache-Control': 'public, max-age=3600' });
    if (path === '/v1/notify-action' && m === 'POST') return json(await notifyAction(req, rid));
    if (path === '/v1/health') return json({ ok: true, ai: ai?.name ?? null, stt: stt?.name ?? null, push: !!vapidFromEnv() });

    const ctx = await authed(req, url, rid);
    let seg: RegExpMatchArray | null;
    let result: unknown;

    if (path === '/v1/chat' && m === 'POST') {
      const body = await readJson<{ text?: string; conversation_id?: string; request_id?: string }>(req);
      const text = (body.text ?? '').trim();
      if (!text) throw new HttpError(400, 'empty');
      if (text.length > 2000) throw new HttpError(413, 'too_long');
      result = await chat(ctx, text, body.conversation_id ?? null, requestId(ctx, body));
    } else if (path === '/v1/voice' && m === 'POST') result = await voice(ctx);
    else if (path === '/v1/bootstrap' && m === 'GET') {
      const [tasks, conv, { data: prow }] = await Promise.all([listTasks(ctx), conversationId(ctx, url.searchParams.get('conversation_id')), ctx.db.from('profiles').select('onboarded_at').eq('id', ctx.userId).single()]);
      const [{ data: messages }, state] = await Promise.all([
        ctx.db.from('messages').select('id, role, content, meta, created_at').eq('conversation_id', conv).order('id', { ascending: false }).limit(20),
        ctx.store.getState(conv),
      ]);
      result = { profile: ctx.profile, onboarded_at: prow?.onboarded_at ?? null, conversation_id: conv, awaiting: state.pending?.field ?? null, messages: (messages ?? []).reverse(), ...tasks, features: { ai: !!ai, stt: !!stt, push: !!vapidFromEnv() } };
    } else if (path === '/v1/tasks' && m === 'GET') result = await listTasks(ctx);
    else if (path === '/v1/tasks' && m === 'POST') result = await createTask(ctx);
    else if ((seg = path.match(/^\/v1\/tasks\/([0-9a-f-]{36})$/))) {
      if (m === 'GET') result = await taskDetail(ctx, seg[1]);
      else if (m === 'PATCH') result = await updateTask(ctx, seg[1]);
      else if (m === 'DELETE') {
        await loadTask(ctx, seg[1]);
        await ctx.db.from('tasks').delete().eq('id', seg[1]);
        result = { ok: true };
      } else throw new HttpError(405, 'method_not_allowed');
    } else if ((seg = path.match(/^\/v1\/tasks\/([0-9a-f-]{36})\/(complete|cancel|reopen|snooze)$/)) && m === 'POST') result = await taskAction(ctx, seg[1], seg[2]);
    else if (path === '/v1/me' && m === 'GET') result = { profile: ctx.profile };
    else if (path === '/v1/me' && m === 'PATCH') result = await updateMe(ctx);
    else if ((seg = path.match(/^\/v1\/memory(?:\/([0-9a-f-]{36}))?$/))) result = await memoryRoute(ctx, seg[1] ?? null);
    else if (path === '/v1/devices' && (m === 'POST' || m === 'DELETE')) result = await devicesRoute(ctx);
    else if (path === '/v1/push/test' && m === 'POST') result = await pushTest(ctx);
    else if (path === '/v1/export' && m === 'GET') result = await exportData(ctx);
    else if (path === '/v1/account' && m === 'DELETE') result = await deleteAccount(ctx);
    else if (path === '/v1/metrics' && m === 'POST') result = await metric(ctx);
    else throw new HttpError(404, 'not_found');

    log('request', { rid, m, path: path.replace(/[0-9a-f-]{36}/g, ':id'), ms: Date.now() - started });
    return json(result, 200, { 'x-request-id': rid });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code }, err.status, { 'x-request-id': rid });
    log('unhandled', { rid, path, error: String(err).slice(0, 400) });
    return json({ error: String(err).includes('store:') ? 'save_failed' : 'internal' }, 500, { 'x-request-id': rid });
  }
});
