// App actions: everything the UI can do, with optimistic updates where safe.

import type { AssistantReply, Lang, Preferences, Profile, Task } from '@nora/core';
import { getLang, setFormat, setLang, tr, type MessageKey } from '../i18n/index.ts';
import { api, ApiError, flushQueue, newRequestId, sendOrQueue, track } from '../services/api.ts';
import { auth } from '../services/auth.ts';
import { syncSubscription } from '../services/push.ts';
import { MicUnavailableError, VoiceRecorder } from '../services/voice/recorder.ts';
import { savedVoice, tts } from '../services/voice/tts.ts';
import { getState, loadCachedTasks, patchTaskLocal, removeTask, resetState, setState, toast, upsertTasks, type ChatItem } from './store.ts';

// ----------------------------------------------------------------------------
// Session & bootstrap
// ----------------------------------------------------------------------------

export function initAuth() {
  if (!auth) {
    setState({ authReady: true });
    return;
  }
  // Never leave the user on the splash screen: if auth start-up stalls, show the app anyway.
  setTimeout(() => {
    if (!getState().authReady) setState({ authReady: true });
  }, 10_000);
  auth.onAuthStateChange((event: string, session: { user?: { id: string; email?: string } } | null) => {
    const prev = getState().userId;
    if (session?.user) {
      if (prev !== session.user.id) {
        setState({ userId: session.user.id, email: session.user.email ?? null, authReady: true });
        const cached = loadCachedTasks(session.user.id);
        if (cached.length) upsertTasks(cached);
        void bootstrap();
      } else setState({ authReady: true });
    } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
      if (prev) resetState();
      setState({ authReady: true });
    }
  });
}

interface Bootstrap {
  profile: Profile;
  onboarded_at: string | null;
  conversation_id: string;
  awaiting: string | null;
  messages: Array<{ id: number; role: 'user' | 'assistant'; content: string; meta?: { reply?: AssistantReply } }>;
  tasks: Task[];
  features: { ai: boolean; stt: boolean; push: boolean };
}

export async function bootstrap() {
  const started = performance.now();
  try {
    const b = await api<Bootstrap>('/v1/bootstrap');
    await applyProfile(b.profile);
    setState({
      profile: b.profile,
      onboardedAt: b.onboarded_at,
      conversationId: b.conversation_id,
      awaiting: b.awaiting,
      features: b.features,
      bootstrapped: true,
      messages: b.messages.map((m) => ({ id: `m${m.id}`, role: m.role, text: m.content, results: m.meta?.reply?.results, task_ids: m.meta?.reply?.task_ids })),
      tasks: Object.fromEntries(b.tasks.map((t) => [t.id, t])),
    });
    upsertTasks([]);
    track('app_open', Math.round(performance.now() - started));
    void flushQueue().then((n) => {
      if (n) void refreshTasks();
    });
    void syncSubscription(b.profile.ui_lang).catch(() => {});
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await auth?.signOut();
      return;
    }
    // offline: keep cached tasks, retry when back online
    setState({ bootstrapped: true, online: navigator.onLine });
  }
}

export async function applyProfile(p: Profile) {
  if (p.ui_lang !== getLang()) await setLang(p.ui_lang);
  setFormat({ locale: p.locale, hour12: p.prefs.hour12 });
}

export async function refreshTasks() {
  try {
    const { tasks } = await api<{ tasks: Task[] }>('/v1/tasks');
    const keepCompleted = Object.values(getState().tasks).filter((t) => t.status === 'completed' && !tasks.some((x) => x.id === t.id));
    setState({ tasks: Object.fromEntries([...keepCompleted, ...tasks].map((t) => [t.id, t])) });
    upsertTasks([]);
  } catch {
    /* offline – cached tasks stay */
  }
}

export async function loadCompleted() {
  const { tasks } = await api<{ tasks: Task[] }>('/v1/tasks?scope=completed');
  upsertTasks(tasks);
  setState({ completedLoaded: true });
}

// ----------------------------------------------------------------------------
// Conversation
// ----------------------------------------------------------------------------

let speakAbort: AbortController | null = null;

function replyLang(): Lang {
  const s = getState();
  return s.replyLang ?? s.profile?.conv_lang ?? s.profile?.ui_lang ?? getLang();
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'network' || err.code === 'timeout') return tr('ai.offline');
    if (err.code === 'save_failed') return tr('err.save_failed');
    if (err.code === 'too_long') return tr('err.too_long');
    if (err.code === 'stt_failed' || err.code === 'stt_unavailable') return tr('err.stt_failed');
  }
  return tr('common.error');
}

function applyReply(pendingId: string, res: { reply: AssistantReply; conversation_id: string; tasks: Task[] }) {
  upsertTasks(res.tasks);
  setState((s) => ({
    conversationId: res.conversation_id,
    awaiting: res.reply.awaiting,
    replyLang: res.reply.lang,
    messages: s.messages.map((m) => (m.id === pendingId ? { id: pendingId, role: 'assistant', text: res.reply.text, results: res.reply.results, task_ids: res.reply.task_ids } : m)),
  }));
}

export async function sendText(text: string, requestId = newRequestId()): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;
  const userItem: ChatItem = { id: `u-${requestId}`, role: 'user', text: clean };
  const pendingId = `a-${requestId}`;
  setState((s) => ({ messages: [...s.messages.filter((m) => m.id !== userItem.id && m.id !== pendingId), userItem, { id: pendingId, role: 'assistant', text: '', pending: true }] }));
  try {
    const res = await api<{ reply: AssistantReply; conversation_id: string; tasks: Task[] }>('/v1/chat', {
      body: { text: clean, conversation_id: getState().conversationId, request_id: requestId },
      requestId,
    });
    applyReply(pendingId, res);
    return true;
  } catch (err) {
    setState((s) => ({ messages: s.messages.map((m) => (m.id === pendingId ? { ...m, pending: false, error: true, text: errorText(err), retry: { text: clean, requestId } } as ChatItem : m)) }));
    return false;
  }
}

export function retryMessage(item: ChatItem & { retry?: { text: string; requestId: string } }) {
  if (item.retry) void sendText(item.retry.text, item.retry.requestId);
}

// ----------------------------------------------------------------------------
// Voice: idle → listening → processing → speaking → (listening again if NORA asked something)
// ----------------------------------------------------------------------------

let recorder: VoiceRecorder | null = null;

export function stopSpeaking() {
  speakAbort?.abort();
  tts.stop();
  if (getState().voice === 'speaking') setState({ voice: 'idle' });
}

export async function speak(text: string, lang: Lang) {
  const prefs = getState().profile?.prefs;
  if (!prefs?.voice_replies || !tts.available()) return;
  speakAbort = new AbortController();
  setState({ voice: 'speaking' });
  await tts.speak(text, lang, { voiceURI: savedVoice(lang), signal: speakAbort.signal });
  if (getState().voice === 'speaking') setState({ voice: 'idle' });
}

export async function toggleVoice(): Promise<'denied' | 'unsupported' | 'busy' | null> {
  const s = getState();
  if (s.voice === 'listening') {
    recorder?.stop('manual');
    return null;
  }
  if (s.voice === 'speaking') {
    stopSpeaking();
  }
  if (s.voice === 'processing') return null;
  return listen();
}

async function listen(followUp = false): Promise<'denied' | 'unsupported' | 'busy' | null> {
  const rec = new VoiceRecorder({ onLevel: (level) => setState({ level }) });
  recorder = rec;
  try {
    await rec.start();
  } catch (err) {
    recorder = null;
    setState({ voice: 'idle' });
    return err instanceof MicUnavailableError ? err.reason : 'unsupported';
  }
  setState({ voice: 'listening' });
  track('voice_start');
  const { result, reason } = await rec.done;
  recorder = null;
  if (!result) {
    setState({ voice: 'idle' });
    if (reason === 'no_speech' && !followUp) toast(tr('ai.nothing_heard'));
    return null;
  }
  setState({ voice: 'processing' });
  const started = performance.now();
  const requestId = newRequestId();
  const pendingId = `a-${requestId}`;
  setState((st) => ({ messages: [...st.messages, { id: pendingId, role: 'assistant', text: '', pending: true }] }));
  try {
    const form = new FormData();
    form.append('audio', result.blob, 'speech');
    form.append('duration', result.durationSec.toFixed(2));
    form.append('request_id', requestId);
    if (getState().conversationId) form.append('conversation_id', getState().conversationId!);
    const res = await api<{ heard: boolean; transcript?: string; reply_text?: string; reply?: AssistantReply; conversation_id?: string; tasks?: Task[] }>('/v1/voice', { form, timeoutMs: 40_000, requestId });
    if (!res.heard || !res.reply) {
      setState((st) => ({ voice: 'idle', messages: st.messages.filter((m) => m.id !== pendingId) }));
      toast(tr('ai.nothing_heard'));
      return null;
    }
    setState((st) => {
      const idx = st.messages.findIndex((m) => m.id === pendingId);
      const msgs = [...st.messages];
      msgs.splice(idx, 0, { id: `u-${requestId}`, role: 'user', text: res.transcript! });
      return { messages: msgs };
    });
    applyReply(pendingId, { reply: res.reply, conversation_id: res.conversation_id!, tasks: res.tasks ?? [] });
    track('voice_roundtrip_ms', Math.round(performance.now() - started), { path: res.reply.path });
    await speak(res.reply.text, res.reply.lang);
    // NORA asked a question → keep the conversation going hands-free
    if (res.reply.awaiting && getState().voice === 'idle') return listen(true);
    setState({ voice: 'idle' });
  } catch (err) {
    setState((st) => ({ voice: 'idle', messages: st.messages.map((m) => (m.id === pendingId ? { ...m, pending: false, error: true, text: errorText(err) } : m)) }));
  }
  return null;
}

export function cancelVoice() {
  recorder?.cancel();
  stopSpeaking();
  setState({ voice: 'idle' });
}

// ----------------------------------------------------------------------------
// Tasks
// ----------------------------------------------------------------------------

async function taskOp(id: string, op: 'complete' | 'cancel' | 'reopen', optimistic: Task['status']) {
  const before = getState().tasks[id];
  if (!before) return;
  patchTaskLocal(id, { status: optimistic, ...(optimistic === 'completed' ? { completed_at: new Date().toISOString() } : {}) });
  try {
    const res = await sendOrQueue<{ task: Task }>(`/v1/tasks/${id}/${op}`, 'POST');
    if (res?.task) upsertTasks([res.task]);
    else if (res === null) toast(tr('common.offline'));
  } catch {
    upsertTasks([before]);
    toast(tr('err.save_failed'));
  }
}

export async function completeTask(id: string, withUndo = true) {
  const recurring = !!getState().tasks[id]?.recurrence;
  await taskOp(id, 'complete', recurring ? 'scheduled' : 'completed');
  if (withUndo && !recurring) toast(tr('act.completed_toast'), { label: tr('act.undo'), run: () => void reopenTask(id) });
}
export const cancelTask = (id: string) => taskOp(id, 'cancel', 'cancelled');
export const reopenTask = (id: string) => taskOp(id, 'reopen', 'scheduled');

export async function snoozeTask(id: string, preset: string | number) {
  const body = typeof preset === 'number' ? { minutes: preset } : preset.includes('T') ? { until: preset } : { preset };
  try {
    const res = await sendOrQueue<{ task: Task; until: string }>(`/v1/tasks/${id}/snooze`, 'POST', body);
    if (res?.task) upsertTasks([res.task]);
    return res?.until ?? null;
  } catch {
    toast(tr('err.save_failed'));
    return null;
  }
}

export async function updateTask(id: string, changes: Record<string, unknown>): Promise<boolean> {
  const before = getState().tasks[id];
  try {
    const res = await api<{ task: Task }>(`/v1/tasks/${id}`, { method: 'PATCH', body: changes });
    upsertTasks([res.task]);
    return true;
  } catch {
    if (before) upsertTasks([before]);
    toast(tr('err.save_failed'));
    return false;
  }
}

export async function deleteTask(id: string) {
  const before = getState().tasks[id];
  removeTask(id);
  setState({ openTaskId: null });
  try {
    await sendOrQueue(`/v1/tasks/${id}`, 'DELETE');
  } catch {
    if (before) upsertTasks([before]);
    toast(tr('err.save_failed'));
  }
}

export async function createTask(fields: Record<string, unknown>): Promise<Task | null> {
  try {
    const res = await api<{ task: Task }>('/v1/tasks', { body: { ...fields, request_id: newRequestId() } });
    upsertTasks([res.task]);
    return res.task;
  } catch {
    toast(tr('err.save_failed'));
    return null;
  }
}

// ----------------------------------------------------------------------------
// Profile
// ----------------------------------------------------------------------------

export async function updateProfile(patch: Partial<Omit<Profile, 'prefs' | 'id'>> & { prefs?: Partial<Preferences>; onboarded?: boolean }): Promise<boolean> {
  const before = getState().profile;
  if (!before) return false;
  const optimistic: Profile = { ...before, ...patch, prefs: { ...before.prefs, ...(patch.prefs ?? {}) } } as Profile;
  setState({ profile: optimistic });
  await applyProfile(optimistic);
  try {
    const res = await api<{ profile: Profile; onboarded_at: string | null }>('/v1/me', { method: 'PATCH', body: patch });
    setState({ profile: res.profile, ...(patch.onboarded ? { onboardedAt: res.onboarded_at } : {}) });
    await applyProfile(res.profile);
    if (patch.prefs && ['reminder_lead_min', 'travel_buffer_min', 'day_before', 'default_time', 'evening_time', 'followups', 'notifications'].some((k) => k in patch.prefs!)) void refreshTasks();
    return true;
  } catch {
    setState({ profile: before });
    await applyProfile(before);
    toast(tr('err.save_failed'));
    return false;
  }
}

export function t(key: MessageKey, vars?: Record<string, string | number>) {
  return tr(key, vars);
}

export { replyLang };
