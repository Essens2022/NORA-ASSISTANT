// Tiny global store (no library): subscribe + selector hook.
import { useEffect, useReducer, useRef } from 'preact/hooks';
import type { AssistantReply, Lang, Profile, Task, TaskStatus } from '@nora/core';
import { onI18nChange } from '../i18n/index.ts';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';
export type Tab = 'ai' | 'activity' | 'profile';

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
  error?: boolean;
  results?: AssistantReply['results'];
  task_ids?: string[];
  retry?: { text: string; requestId: string };
  /** Arrived during this session – animated in. */
  fresh?: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'success' | 'error' | 'info';
  action?: { label: string; run: () => void };
}

export interface AppState {
  authReady: boolean;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  onboardedAt: string | null;
  bootstrapped: boolean;
  tasks: Record<string, Task>;
  completedLoaded: boolean;
  conversationId: string | null;
  messages: ChatItem[];
  awaiting: string | null;
  voice: VoiceState;
  level: number;
  online: boolean;
  tab: Tab;
  openTaskId: string | null;
  toasts: Toast[];
  features: { ai: boolean; stt: boolean; tts: boolean; push: boolean };
  replyLang: Lang | null;
  /** OAuth hand-off screen shown in the in-app browser (see services/auth.ts) */
  handoff: 'working' | 'handed' | 'failed' | null;
  /** task shown in the full-screen reminder moment */
  alertTaskId: string | null;
}

const initial: AppState = {
  authReady: false,
  userId: null,
  email: null,
  profile: null,
  onboardedAt: null,
  bootstrapped: false,
  tasks: {},
  completedLoaded: false,
  conversationId: null,
  messages: [],
  awaiting: null,
  voice: 'idle',
  level: 0,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  tab: 'ai',
  openTaskId: null,
  toasts: [],
  features: { ai: true, stt: true, tts: false, push: true },
  replyLang: null,
  handoff: null,
  alertTaskId: null,
};

let state: AppState = initial;
const subs = new Set<() => void>();

export const getState = () => state;

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  subs.forEach((f) => f());
}

export function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function resetState() {
  state = { ...initial, authReady: true, online: state.online };
  subs.forEach((f) => f());
}

/** Re-render when the selected slice changes (shallow compare) or the language changes. */
export function useStore<T>(select: (s: AppState) => T): T {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const selRef = useRef(select);
  selRef.current = select;
  const valRef = useRef<T>(select(state));
  valRef.current = select(state);
  useEffect(() => {
    const check = () => {
      const next = selRef.current(state);
      if (!shallowEqual(next, valRef.current)) {
        valRef.current = next;
        force(0);
      }
    };
    const a = subscribe(check);
    // state may have changed between render and subscription – don't miss it
    check();
    const b = onI18nChange(() => force(0));
    return () => {
      a();
      b();
    };
  }, []);
  return valRef.current;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ----------------------------------------------------------------------------
// Task helpers
// ----------------------------------------------------------------------------

export function upsertTasks(list: Task[]) {
  if (!list.length) return;
  setState((s) => {
    const tasks = { ...s.tasks };
    for (const t of list) tasks[t.id] = t;
    return { tasks };
  });
  persistTasks();
}

export function removeTask(id: string) {
  setState((s) => {
    const tasks = { ...s.tasks };
    delete tasks[id];
    return { tasks };
  });
  persistTasks();
}

export function patchTaskLocal(id: string, patch: Partial<Task> & { status?: TaskStatus }) {
  const t = state.tasks[id];
  if (t) upsertTasks([{ ...t, ...patch }]);
}

let persistTimer: number | undefined;
function persistTasks() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(`nora.tasks.${state.userId}`, JSON.stringify(Object.values(state.tasks)));
    } catch {
      /* storage full / private mode – the server is the source of truth */
    }
  }, 300);
}

export function loadCachedTasks(userId: string): Task[] {
  try {
    return JSON.parse(localStorage.getItem(`nora.tasks.${userId}`) ?? '[]');
  } catch {
    return [];
  }
}

let toastSeq = 0;
export function toast(text: string, action?: Toast['action'], ms = 3000, kind: Toast['kind'] = 'success') {
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, action, kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms);
}

export const toastError = (text: string, ms = 4000) => toast(text, undefined, ms, 'error');
export const toastInfo = (text: string, ms = 3000) => toast(text, undefined, ms, 'info');
