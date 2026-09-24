// API client: auth header, timezone, request ids (idempotency), timeouts,
// and an offline queue for safe task operations.

import { config } from '../config/brand.ts';
import { getState, setState } from '../state/store.ts';
import { accessToken, auth } from './auth.ts';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(code);
  }
}

export const newRequestId = (): string => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// When the user picks a timezone manually, the device timezone must not override it.
const TZ_MANUAL = 'nora.tz_manual';
export function isManualTimezone(): boolean {
  try {
    return localStorage.getItem(TZ_MANUAL) === '1';
  } catch {
    return false;
  }
}
export function setManualTimezone(manual: boolean) {
  try {
    if (manual) localStorage.setItem(TZ_MANUAL, '1');
    else localStorage.removeItem(TZ_MANUAL);
  } catch {
    /* ignore */
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
  requestId?: string;
  auth?: boolean;
}

export async function api<T = unknown>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { 'x-request-id': opts.requestId ?? newRequestId() };
  if (!isManualTimezone()) headers['x-timezone'] = deviceTimezone();
  if (opts.auth !== false) {
    const token = await accessToken();
    if (!token) throw new ApiError('unauthorized', 401);
    headers.Authorization = `Bearer ${token}`;
  }
  headers.apikey = config.supabaseAnonKey;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
    });
  } catch (err) {
    if (!navigator.onLine) setState({ online: false });
    throw new ApiError((err as Error)?.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (res.status === 401 && !retried && auth) {
    await auth.refreshSession();
    return api<T>(path, opts, true);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `http_${res.status}`, res.status);
  // a request just made it through: whatever set `online: false` earlier no longer applies
  if (!getState().online) setState({ online: true });
  return data as T;
}

// ----------------------------------------------------------------------------
// Offline queue – only idempotent / safe task operations are queued.
// ----------------------------------------------------------------------------

interface Queued {
  id: string;
  path: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

const QKEY = () => `nora.queue.${getState().userId}`;

function readQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(QKEY()) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(q: Queued[]) {
  try {
    localStorage.setItem(QKEY(), JSON.stringify(q));
  } catch {
    /* ignore */
  }
}

/** Send now; if the network is down, queue it and resolve with null. */
export async function sendOrQueue<T>(path: string, method: Queued['method'], body?: unknown): Promise<T | null> {
  try {
    return await api<T>(path, { method, body });
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'network' || err.code === 'timeout')) {
      writeQueue([...readQueue(), { id: newRequestId(), path, method, body }]);
      // only a real connectivity problem should show the offline bar
      if (!navigator.onLine) setState({ online: false });
      return null;
    }
    throw err;
  }
}

let flushing = false;
export async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let done = 0;
  try {
    // re-read on every iteration: a write queued concurrently (another tab, another
    // sendOrQueue call) must not be lost by overwriting storage with a stale snapshot
    for (let item = readQueue()[0]; item; item = readQueue()[0]) {
      try {
        await api(item.path, { method: item.method, body: item.body, requestId: item.id });
      } catch (err) {
        // network/timeout or a server error: keep the item, stop for now and retry later
        if (!(err instanceof ApiError) || err.code === 'network' || err.code === 'timeout' || !err.status || err.status >= 500 || err.status === 429) break;
        // a real 4xx: the operation is no longer valid (e.g. the task was deleted) – drop it
      }
      writeQueue(readQueue().filter((q) => q.id !== item.id));
      done++;
    }
  } finally {
    flushing = false;
  }
  return done;
}

export function track(name: string, value?: number, props?: Record<string, string | number | boolean>) {
  if (!getState().userId) return;
  api('/v1/metrics', { body: { name, value, props } }).catch(() => {});
}
