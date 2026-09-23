/* NORA service worker: app-shell caching + push notifications with actions. */
const VERSION = 'nora-v1';
const params = new URL(self.location.href).searchParams;
const API = params.get('api') || '';
const ANON = params.get('key') || '';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])).then(() => self.skipWaiting()));
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
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
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
    self.registration.showNotification(data.title || 'NORA', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: true,
      silent: data.sound === 'silent',
      requireInteraction: important || data.kind === 'departure',
      icon: '/icon-192.png',
      badge: '/badge.png',
      lang: data.lang,
      vibrate: important ? [200, 100, 200, 100, 300] : [150, 80, 150],
      data: { token: data.token, task_id: data.task_id, kind: data.kind },
      actions: (data.actions || []).slice(0, 2).map((a) => ({ action: a.action, title: a.title })),
    }),
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
  const { token, task_id } = n.data || {};
  n.close();
  const action = event.action || 'open';
  event.waitUntil(
    (async () => {
      if (action === 'open') {
        await act(token, 'open');
        await focusApp(`/?task=${encodeURIComponent(task_id || '')}`, { type: 'notification', action: 'open', task_id });
        return;
      }
      const ok = await act(token, action);
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.postMessage({ type: 'notification', action: 'refresh', task_id }));
      if (!ok) await focusApp(`/?task=${encodeURIComponent(task_id || '')}`, { type: 'notification', action, task_id });
    })(),
  );
});
