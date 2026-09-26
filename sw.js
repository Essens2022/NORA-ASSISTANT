/* NORA service worker: app-shell caching + push notifications with actions. */
const VERSION = 'nora-v6';
const params = new URL(self.location.href).searchParams;
const API = params.get('api') || '';
const ANON = params.get('key') || '';
// the app's base path ("/" or "/nora-assistant/" on GitHub Pages)
const BASE = new URL('./', self.location.href).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll([BASE, `${BASE}manifest.webmanifest`, `${BASE}icon.svg`])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never cache API / personal data
  if (req.mode === 'navigate') {
    // network first, fall back to the cached shell when offline
    event.respondWith(
      fetch(req)
        .then((res) => {
          // never cache a 5xx / captive-portal page as the offline shell
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(BASE, copy));
          }
          return res;
        })
        .catch(() => caches.match(BASE)),
    );
    return;
  }
  if (url.pathname.startsWith(`${BASE}assets/`)) {
    // hashed, immutable build assets: cache first
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'NORA', body: event.data ? event.data.text() : '' };
  }
  const important = data.sound === 'important';
  event.waitUntil(
    (async () => {
    // If NORA is open, let the app play its own chime and show the reminder inline too.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: 'reminder', title: data.title, body: data.body, task_id: data.task_id, kind: data.kind, sound: data.sound }));
    // Belt-and-braces against a suppressed banner/sound (Focus mode, a quiet
    // notification style, an unread system notification the person hasn't
    // noticed…): the app icon itself gets a badge, cleared when NORA is opened.
    try {
      if (self.navigator?.setAppBadge) await self.navigator.setAppBadge();
    } catch {
      /* Badging API not available here */
    }
    const silent = data.sound === 'silent';
    await self.registration.showNotification(data.title || 'NORA', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: true,
      silent,
      // stays on screen until the user reacts – NORA doesn't let it slip by
      requireInteraction: !!data.sticky || important,
      icon: `${BASE}icon-192.png`,
      badge: `${BASE}badge.png`,
      lang: data.lang,
      // Chrome throws if `vibrate` is present at all on a silent notification, even []
      ...(silent ? {} : { vibrate: important ? [120, 70, 120, 70, 420, 250, 120, 70, 120, 70, 420] : [120, 70, 120, 70, 380] }), // NORA's signature: two short taps and a longer one
      data: { token: data.token, task_id: data.task_id, kind: data.kind },
      actions: (data.actions || []).slice(0, 2).map((a) => ({ action: a.action, title: a.title })),
    });
    })(),
  );
});

async function act(token, action) {
  if (!API || !token) return false;
  try {
    const res = await fetch(`${API}/v1/notify-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify({ token, action }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function focusApp(url, message) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of all) {
    if (message) c.postMessage(message);
    if ('focus' in c) {
      await c.focus();
      return;
    }
  }
  await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const { token, task_id, kind } = n.data || {};
  n.close();
  const action = event.action || 'open';
  event.waitUntil(
    (async () => {
      if (action === 'open') {
        // Opening a reminder is not an answer: the full-screen reminder asks for one
        // and NORA keeps calling (nudges) until the user presses a button there.
        if (!['main', 'departure', 'snooze', 'nudge'].includes(kind)) await act(token, 'open');
        const alert = ['main', 'departure', 'snooze', 'nudge'].includes(kind) ? '&alert=1' : '';
        // Tested: forcing a real navigate() of an already-open window (instead of just
        // focus()) did NOT unlock audio either - confirms this is iOS requiring an actual
        // touch event dispatched to the document, not something a trusted navigation can
        // stand in for. Keep the simple, fluid focus(); the alert screen's own first-touch
        // handler is what gets the voice heard.
        await focusApp(`${BASE}?task=${encodeURIComponent(task_id || '')}${alert}`, { type: 'notification', action: 'open', task_id, kind });
        return;
      }
      const ok = await act(token, action);
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.postMessage({ type: 'notification', action: 'refresh', task_id }));
      if (!ok) await focusApp(`${BASE}?task=${encodeURIComponent(task_id || '')}`, { type: 'notification', action, task_id });
    })(),
  );
});
