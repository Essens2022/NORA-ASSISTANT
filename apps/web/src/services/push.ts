// Push notifications: service worker registration + Web Push subscription.
// Permission is requested only after explaining the benefit (spec §47).

import { config } from '../config/brand.ts';
import { api } from './api.ts';

export type PushStatus = 'unsupported' | 'ios_needs_install' | 'default' | 'denied' | 'granted';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushStatus(): PushStatus {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (!('PushManager' in window) || !('Notification' in window)) return isIOS() && !isStandalone() ? 'ios_needs_install' : 'unsupported';
  return Notification.permission as PushStatus;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return Promise.resolve(null);
  registration ??= navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js?api=${encodeURIComponent(config.apiUrl)}&key=${encodeURIComponent(config.supabaseAnonKey)}`, { scope: import.meta.env.BASE_URL })
    .catch(() => null);
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
  await syncSubscription(lang);
  return 'granted';
}

/** Keep the server's copy of this device's subscription fresh (called on start). */
export async function syncSubscription(lang: string): Promise<boolean> {
  if (pushStatus() !== 'granted') return false;
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
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api('/v1/devices', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
