// NORA dispatcher – invoked every minute by pg_cron (see migrations/*_nora_cron.sql).
//
// 1. Claim due reminders atomically (SKIP LOCKED – safe with overlapping runs).
// 2. Send each as a push notification in the user's language.
// 3. Follow-ups also become a question in the user's conversation, so they can answer by voice.
// 4. Mark tasks nobody acted on as missed; advance recurring tasks whose occurrence passed.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  addDays,
  buildNotification,
  canTransition,
  EMPTY_STATE,
  isOpen,
  nextOccurrence,
  nudgePlan,
  TaskService,
  toZoned,
  type ConversationState,
  type Lang,
  type Profile,
  type Reminder,
} from '../_shared/core/index.ts';
import { json, log } from '../_shared/http.ts';
import { pushToUser, vapidFromEnv } from '../_shared/push.ts';
import { rowToProfile, SupabaseStore } from '../_shared/store.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CRON_SECRET = Deno.env.get('CRON_SECRET');

async function profileOf(cache: Map<string, Profile>, userId: string): Promise<Profile | null> {
  if (cache.has(userId)) return cache.get(userId)!;
  const { data } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (!data) return null;
  const p = rowToProfile(data);
  cache.set(userId, p);
  return p;
}

async function askInConversation(userId: string, taskId: string, text: string) {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  let { data: conv } = await admin.from('conversations').select('id, state').eq('user_id', userId).gte('updated_at', since).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (!conv) {
    const { data } = await admin.from('conversations').insert({ user_id: userId, state: {} }).select('id, state').single();
    conv = data;
  }
  if (!conv) return;
  const now = new Date().toISOString();
  const state: ConversationState = { ...EMPTY_STATE, ...(conv.state as Partial<ConversationState>), focus_task_id: taskId, focus_at: now, pending: { task_id: taskId, field: 'followup', asked_at: now } };
  await admin.from('conversations').update({ state }).eq('id', conv.id);
  await admin.from('messages').insert({ conversation_id: conv.id, user_id: userId, role: 'assistant', content: text, meta: { kind: 'followup', task_id: taskId } });
}

async function sendDue(): Promise<{ claimed: number; sent: number; skipped: number; failed: number }> {
  const vapid = vapidFromEnv();
  const { data: due, error } = await admin.rpc('claim_due_reminders', { batch: 200 });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const reminders = (due ?? []) as Reminder[];
  const profiles = new Map<string, Profile>();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of reminders) {
    try {
      const store = new SupabaseStore(admin, r.user_id);
      const [task, profile] = await Promise.all([store.getTask(r.task_id), profileOf(profiles, r.user_id)]);
      if (!task || !profile || !isOpen(task.status) || !profile.prefs.notifications) {
        await admin.from('reminders').update({ status: 'cancelled' }).eq('id', r.id);
        skipped++;
        continue;
      }
      // very late reminders (e.g. after an outage) are useless except follow-ups
      const lateMin = (Date.now() - Date.parse(r.fire_at)) / 60000;
      if (lateMin > 180 && r.kind !== 'followup' && r.kind !== 'prep') {
        await admin.from('reminders').update({ status: 'cancelled', last_error: 'too_late' }).eq('id', r.id);
        skipped++;
        continue;
      }
      // A nudge only makes sense if the user still hasn't reacted to the reminder.
      if (r.kind === 'nudge' && task.status !== 'reminded') {
        await admin.from('reminders').update({ status: 'cancelled', last_error: 'already_acknowledged' }).eq('id', r.id);
        skipped++;
        continue;
      }
      const lang = (profile.conv_lang ?? profile.ui_lang) as Lang;
      const today = toZoned(new Date(), profile.timezone).date;
      const payload = buildNotification(r, task, lang, profile.prefs, today, { name: profile.display_name });

      const delivery = vapid ? await pushToUser(admin, r.user_id, payload, vapid) : { sent: 0, devices: 0 };
      if (r.kind === 'followup') await askInConversation(r.user_id, task.id, payload.chat ?? payload.title);

      await admin
        .from('reminders')
        .update({ status: delivery.sent > 0 || r.kind === 'followup' ? 'sent' : 'failed', sent_at: new Date().toISOString(), last_error: delivery.sent ? null : delivery.devices ? 'push_failed' : 'no_device' })
        .eq('id', r.id);
      if (delivery.sent > 0) sent++;
      else failed++;

      if (r.kind !== 'prep' && r.kind !== 'followup' && r.kind !== 'nudge' && canTransition(task.status, 'remind')) {
        await store.patchTask(task.id, { status: 'reminded' });
        // no reaction → NORA calls again
        const nudges = nudgePlan(r.kind, task.priority, profile.prefs, new Date());
        if (nudges.length) await store.replaceReminders(task.id, nudges, ['nudge']);
      }
      await store.logEvent(task.id, r.kind === 'followup' ? 'followup_sent' : 'reminder_sent', { kind: r.kind, devices: delivery.devices, delivered: delivery.sent });
    } catch (err) {
      failed++;
      log('dispatch_error', { reminder: r.id, error: String(err).slice(0, 300) });
      await admin.from('reminders').update({ status: r.attempts >= 3 ? 'failed' : 'pending', last_error: String(err).slice(0, 200) }).eq('id', r.id);
    }
  }
  return { claimed: reminders.length, sent, skipped, failed };
}

/** Tasks whose time passed long ago without any action → missed; recurring ones roll to the next occurrence. */
async function sweepOverdue(): Promise<{ missed: number; advanced: number }> {
  const cutoff = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data: rows } = await admin
    .from('tasks')
    .select('*')
    .in('status', ['scheduled', 'upcoming', 'reminded', 'acknowledged', 'rescheduled'])
    .lt('start_at', cutoff)
    .limit(200);
  let missed = 0;
  let advanced = 0;
  const profiles = new Map<string, Profile>();
  for (const row of rows ?? []) {
    const store = new SupabaseStore(admin, row.user_id);
    const { count } = await admin.from('reminders').select('id', { count: 'exact', head: true }).eq('task_id', row.id).eq('status', 'pending');
    if (count) continue; // a follow-up is still coming
    const task = (await store.getTask(row.id))!;
    if (task.recurrence && task.due_date) {
      const profile = await profileOf(profiles, task.user_id);
      if (!profile) continue;
      const today = toZoned(new Date(), profile.timezone).date;
      const next = nextOccurrence(task.recurrence, (task.metadata?.rrule_anchor as string) ?? task.due_date, addDays(today, -1));
      if (next) {
        const svc = new TaskService(store, profile);
        await store.logEvent(task.id, 'missed', { date: task.due_date, recurring: true });
        const moved = await store.patchTask(task.id, { due_date: next, status: 'scheduled', followup_count: 0 });
        await svc.replan(moved);
        advanced++;
        continue;
      }
    }
    await store.patchTask(task.id, { status: 'missed' });
    await store.logEvent(task.id, 'missed', { reason: 'no_action' });
    missed++;
  }
  return { missed, advanced };
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'forbidden' }, 403);
  const started = Date.now();
  try {
    const result = await sendDue();
    // the sweep is cheap but not needed every minute
    const sweep = new Date().getUTCMinutes() % 10 === 0 ? await sweepOverdue() : null;
    log('dispatch', { ms: Date.now() - started, ...result, sweep });
    return json({ ok: true, ...result, sweep });
  } catch (err) {
    log('dispatch_fatal', { error: String(err).slice(0, 400) });
    return json({ ok: false }, 500);
  }
});
