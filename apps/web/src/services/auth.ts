// Authentication (Supabase Auth). Email one-time code works inside installed
// PWAs (magic links would open the browser instead); Google / Apple are behind flags.

import { AuthClient, type Session } from '@supabase/auth-js';
import { config, isConfigured } from '../config/brand.ts';

export const auth: InstanceType<typeof AuthClient> | null = isConfigured()
  ? new AuthClient({
      url: `${config.supabaseUrl}/auth/v1`,
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` },
      storageKey: 'nora.auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    })
  : null;

export async function currentSession(): Promise<Session | null> {
  if (!auth) return null;
  const { data } = await auth.getSession();
  return data.session;
}

export async function accessToken(): Promise<string | null> {
  return (await currentSession())?.access_token ?? null;
}

export async function sendCode(email: string, meta: Record<string, string>) {
  if (!auth) throw new Error('not_configured');
  const { error } = await auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + import.meta.env.BASE_URL, data: meta } });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string) {
  if (!auth) throw new Error('not_configured');
  const { data, error } = await auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data.session;
}

export async function signInWith(provider: 'google' | 'apple') {
  if (!auth) throw new Error('not_configured');
  let redirectTo = location.origin + import.meta.env.BASE_URL;
  if (isStandalone()) {
    // iOS opens the provider in a separate in-app browser; see handoff below
    const nonce = randomNonce();
    try {
      localStorage.setItem(HANDOFF_KEY, JSON.stringify({ n: nonce, t: Date.now() }));
    } catch {
      /* private mode: plain redirect */
    }
    redirectTo += `?handoff=${nonce}`;
  }
  const { error } = await auth.signInWithOAuth({ provider, options: { redirectTo } });
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// OAuth hand-off for installed (home-screen) apps.
// On iOS the provider page opens in an in-app browser that does not share the
// app's storage, so the session would land there instead of in NORA. That
// browser parks the refresh token under a one-time nonce (5 min, single use,
// see migration nora_auth_handoff); the installed app claims it when it becomes
// visible again.
// ----------------------------------------------------------------------------

const HANDOFF_KEY = 'nora.handoff';
// generous: 2FA / "create account" on the provider's side can take a while
const HANDOFF_TTL_MS = 30 * 60_000;

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pendingHandoff(): { n: string; t: number } | null {
  try {
    const p = JSON.parse(localStorage.getItem(HANDOFF_KEY) ?? 'null');
    return p && typeof p.n === 'string' && Date.now() - p.t < HANDOFF_TTL_MS ? p : null;
  } catch {
    return null;
  }
}

function clearHandoff() {
  try {
    localStorage.removeItem(HANDOFF_KEY);
  } catch {
    /* ignore */
  }
}

async function rpc<T>(fn: string, body: Record<string, string>, accessToken?: string): Promise<T> {
  const headers: Record<string, string> = { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`rpc_${fn}_${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Runs once at start-up when the URL carries ?handoff=<nonce>.
 * 'own'    – this is the app's own context (e.g. Android returned into the app): keep the session.
 * 'handed' – we are the in-app browser: the session was passed to the app and dropped here.
 * 'failed' – something went wrong; the user can still sign in with email.
 */
export async function completeHandoff(): Promise<'none' | 'own' | 'handed' | 'failed'> {
  const url = new URL(location.href);
  const nonce = url.searchParams.get('handoff');
  if (!nonce || !auth) return 'none';
  url.searchParams.delete('handoff');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  // the installed app is NEVER the in-app browser that must hand its session off,
  // even if the stored nonce expired or a second sign-in overwrote it meanwhile
  if (isStandalone() || pendingHandoff()?.n === nonce) {
    clearHandoff();
    return 'own';
  }
  try {
    const { data } = await auth.getSession(); // waits until the tokens in the URL are processed
    const session = data.session;
    if (!session) return 'failed';
    await rpc('nora_handoff_put', { p_nonce: nonce, p_refresh_token: session.refresh_token }, session.access_token);
    // leave the session to the app: no refresh here (would rotate the token), no server sign-out
    auth.stopAutoRefresh();
    try {
      localStorage.removeItem('nora.auth');
    } catch {
      /* ignore */
    }
    return 'handed';
  } catch {
    return 'failed';
  }
}

/** In the installed app: claim a parked session whenever the app comes back to the foreground. */
export function watchHandoff(onDone: () => void) {
  let busy = false;
  const check = async () => {
    const p = pendingHandoff();
    if (!p || busy || !auth) {
      if (!p) clearHandoff();
      return;
    }
    busy = true;
    try {
      const token = await rpc<string | null>('nora_handoff_take', { p_nonce: p.n });
      if (token) {
        clearHandoff();
        const { error } = await auth.refreshSession({ refresh_token: token });
        if (!error) onDone();
      }
    } catch {
      /* offline – try again on the next focus */
    }
    busy = false;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  addEventListener('focus', () => void check());
  setInterval(() => {
    if (pendingHandoff() && document.visibilityState === 'visible') void check();
  }, 2000);
  void check();
}

export async function signOut() {
  await auth?.signOut();
}
