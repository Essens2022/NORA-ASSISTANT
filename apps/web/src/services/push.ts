// Push notifications: service worker registration + Web Push subscription.
// Permission is requested only after explaining the benefit (spec §47).

import { config } from '../config/brand.ts';
import { api } from './api.ts';
import { getState, subscribe } from '../state/store.ts';

export type PushStatus = 'unsupported' | 'ios_needs_install' | 'default' | 'denied' | 'granted';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushStatus(): PushStatus {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (!('PushManager' in window) || !('Notification' in window)) return isIOS() && !isStandalone() ? 'ios_needs_install' : 'unsupported';
  return Notification.permission as PushStatus;
}

// The browser never lets JS revoke a granted Notification permission, so "off" for this
// device has to be tracked separately – otherwise syncSubscription() (run on every start
// and every resume) silently re-subscribes the moment the user turns it off.
const OPT_OUT_KEY = 'nora.push_off';
export function isPushOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}
function setPushOptedOut(off: boolean) {
  try {
    if (off) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* ignore */
  }
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

// The service-worker update above only kicks in when sw.js itself changes - which it
// almost never does, so an installed app brought back from the background keeps
// running the JS it loaded days ago even though every deploy since shipped new,
// differently-hashed bundles. Ask the server for the current index.html on every
// resume and compare its main bundle with the one actually running; on a mismatch,
// reload (unless the person is mid-typing - then the next resume gets it).
let checkingBuild = false;
async function reloadIfNewBuild() {
  if (checkingBuild || import.meta.env.DEV) return;
  checkingBuild = true;
  try {
    const running = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.src;
    if (!running) return;
    const html = await (await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: 'no-store' })).text();
    const latest = html.match(/assets\/index-[^"']+\.js/)?.[0];
    if (!latest || running.endsWith(latest)) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    location.reload();
  } catch {
    /* offline or blocked: nothing to do, the next resume tries again */
  } finally {
    checkingBuild = false;
  }
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return Promise.resolve(null);
  if (!registration) {
    // A standalone/home-screen PWA keeps running whatever JS it already loaded until
    // it's actually reloaded - installing a new build's service worker in the
    // background does nothing for an app the person never force-quits, so a fix can
    // ship and still never reach them. Reload once the moment a new one takes over,
    // and prod it to check for one every time the app comes back to the foreground.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      // Reloading mid-handoff (Google/Apple sign-in returning through an in-app
      // browser, see auth.ts) wipes the in-memory state that was about to show
      // "you're connected" and drops the person straight back to the sign-in
      // screen - even though the handoff itself already succeeded server-side
      // (confirmed: the session really was parked, just never shown). Wait for
      // that screen to clear (its own "continue" button navigates away anyway,
      // which picks up the new build on its own) before reloading out from
      // under it.
      const doReload = () => location.reload();
      if (!getState().handoff) return doReload();
      const unsubscribe = subscribe(() => {
        if (getState().handoff) return;
        unsubscribe();
        doReload();
      });
    });
    registration = navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js?api=${encodeURIComponent(config.apiUrl)}&key=${encodeURIComponent(config.supabaseAnonKey)}`, { scope: import.meta.env.BASE_URL })
      .catch(() => null);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      void registration?.then((r) => r?.update());
      void reloadIfNewBuild();
    });
  }
  return registration;
}

function keyToBytes(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Ask permission (must be called from a user gesture) and register this device. */
export async function enablePush(lang: string): Promise<PushStatus> {
  const status = pushStatus();
  if (status === 'unsupported' || status === 'ios_needs_install' || status === 'denied') return status;
  const permission = status === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return permission as PushStatus;
  setPushOptedOut(false); // an explicit re-enable always wins over a previous "off"
  const synced = await syncSubscription(lang);
  // The OS permission prompt succeeding doesn't mean this device actually ended up
  // with a working subscription on the server - registerServiceWorker() or the
  // /v1/devices call can each fail on their own (seen for real: a device that went
  // through onboarding with no error shown, yet never got a single row in `devices`
  // - it was reporting success here regardless of whether syncSubscription() had).
  // Report it as if permission was never secured, so the caller's UI shows the
  // "enable" button again instead of a false "notifications are on".
  return synced ? 'granted' : 'default';
}

/** Keep the server's copy of this device's subscription fresh (called on start). */
export async function syncSubscription(lang: string): Promise<boolean> {
  if (pushStatus() !== 'granted' || isPushOptedOut()) return false;
  const reg = await registerServiceWorker();
  if (!reg) return false;
  const { publicKey } = await api<{ publicKey: string | null }>('/v1/push/key', { auth: false });
  if (!publicKey) return false;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) as unknown as BufferSource });
  }
  const json = sub.toJSON();
  await api('/v1/devices', { body: { endpoint: json.endpoint, keys: json.keys, lang } });
  return true;
}

export async function disablePushOnThisDevice(): Promise<void> {
  setPushOptedOut(true);
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api('/v1/devices', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
