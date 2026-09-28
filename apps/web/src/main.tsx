import { render } from 'preact';
import { App } from './App.tsx';
import { setLang } from './i18n/index.ts';
import { flushQueue, track } from './services/api.ts';
import { completeHandoff, watchHandoff } from './services/auth.ts';
import { registerServiceWorker } from './services/push.ts';
import { primeSpeech, tts } from './services/voice/tts.ts';
import { unlockAudio } from './utils/chime.ts';
import { bootstrap, completeTask, initAuth, refreshTasks, snoozeTask } from './state/actions.ts';
import { getState, setState, type Tab } from './state/store.ts';
import { applyTheme } from './utils/theme.ts';
import { playChime } from './utils/chime.ts';
import { tr } from './i18n/index.ts';
import { toast } from './state/store.ts';
import '@fontsource-variable/inter/wght.css';
import './styles.css';

applyTheme();

// Clear the "you have something unanswered" badge (set from the push handler
// in the service worker) the moment the person actually looks at NORA.
try {
  navigator.clearAppBadge?.();
} catch {
  /* Badging API not available here */
}

// deep links: /activity, /profile, /?task=<id>
const path = location.pathname.slice(import.meta.env.BASE_URL.length).replace(/\/+$/, '') as Tab;
if (path === 'activity' || path === 'calendar' || path === 'memory' || path === 'profile') setState({ tab: path });
const params = new URLSearchParams(location.search);
const deepTask = params.get('task');
const deepAlert = params.get('alert') === '1';
if (deepTask) history.replaceState(null, '', location.pathname);

// The sign-in screen is shown before we know anything about the person, so it
// always starts in English – only once they're authenticated does their profile's
// ui_lang (or, for a brand-new account, the device language passed at sign-up
// time – see SignIn.tsx) take over.
void setLang('en').then(() => {
  render(<App />, document.getElementById('app')!);
  requestAnimationFrame(() => setTimeout(() => track('tti_ms', Math.round(performance.now())), 0));
});

// Google sign-in from the installed app comes back through an in-app browser (iOS)
if (new URLSearchParams(location.search).has('handoff')) setState({ handoff: 'working' });
void completeHandoff().then((r) => setState({ handoff: r === 'handed' || r === 'failed' ? r : null }));
watchHandoff(() => undefined);
initAuth();
// iOS: sound and speech only work after a touch – unlock both on the first one
const unlockAll = () => {
  primeSpeech();
  unlockAudio();
  tts.unlock();
};
addEventListener('pointerdown', unlockAll, { once: true, capture: true });
addEventListener('keydown', unlockAll, { once: true, capture: true });
void registerServiceWorker();

if (deepTask) {
  const stop = setInterval(() => {
    const t = getState().tasks[deepTask];
    if (!t) return;
    // a stale/already-answered reminder link must never take the full screen
    if (deepAlert && t.status !== 'reminded') {
      clearInterval(stop);
      return;
    }
    setState(deepAlert ? { alertTaskId: deepTask } : { openTaskId: deepTask, tab: 'activity' });
    clearInterval(stop);
  }, 200);
  setTimeout(() => clearInterval(stop), 10_000);
}

window.addEventListener('online', () => {
  setState({ online: true });
  // bootstrap() may have failed while offline and left the app with no profile at all
  if (getState().userId && !getState().profile) void bootstrap();
  else void flushQueue().then(() => refreshTasks());
});
window.addEventListener('offline', () => setState({ online: false }));

// iOS Safari can report a stale 100dvh right after a long background/foreground
// cycle, tall enough that the whole page scrolls as one block (briefing included)
// instead of just the conversation – until the app is fully restarted. Compute the
// real visible height ourselves and keep it current, instead of trusting dvh alone.
const setAppHeight = () => {
  const vv = window.visualViewport;
  document.documentElement.style.setProperty('--app-h', `${vv?.height ?? window.innerHeight}px`);
};
setAppHeight();
window.visualViewport?.addEventListener('resize', setAppHeight);
window.visualViewport?.addEventListener('scroll', setAppHeight);
window.addEventListener('resize', setAppHeight);

// The keyboard makes all of this worse: on iOS (especially the standalone/home-screen
// PWA) the keyboard shrinks only the *visual* viewport, not the *layout* viewport that
// position:fixed and 100dvh size against - and opening a text input makes Safari
// scroll the page to bring it into view, a scroll it then frequently fails to undo (a
// known WebKit bug). That's what makes the bottom nav "fly away" mid-screen and other
// content look like it vanished. Focus/blur on the field itself is the one signal
// that's always reliable, so use that to hide the (otherwise-misplaced) nav.
//
// Placing the field itself above the keyboard used to be a different story: every
// custom scroll calculation we tried (visualViewport-based, scrollIntoView, even
// getBoundingClientRect() on a position:fixed probe) overshot or undershot, because on
// this device none of them agree with where the keyboard actually is. But the deeper
// problem, found afterwards, was that the page had nowhere TO scroll at all - .ai-screen
// was capped to exactly one screen's height with overflow hidden, so there was no slack
// for any scroll (ours or Safari's own) to move into. Now that .kb-open gives it real
// room (see .ai-screen in styles.css), retry the simple, native way: ask the browser to
// scroll the field into view itself, after a beat for the keyboard's open animation.
// Once the field is scrolled into place, the page must stop moving entirely - no
// amount of tuning the extra scroll room (see .ai-screen in styles.css) reliably
// prevents a swipe from dragging it further, because how much room actually exists
// depends on --app-h, which this device doesn't keep accurate for the keyboard. So
// don't rely on there being "just the right amount" of room at all: once positioned,
// actively hold the page at that scroll position - if anything (a swipe, momentum
// scrolling) moves it, snap it straight back, every time, until the field loses focus.
let kbHideAt = 0;
let scrollLockY: number | null = null;
let scrollLockTimer = 0;
const enforceScrollLock = () => {
  if (scrollLockY !== null && (window.scrollX !== 0 || window.scrollY !== scrollLockY)) window.scrollTo(0, scrollLockY);
};
window.addEventListener('scroll', enforceScrollLock, { passive: true });

const isTextField = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
document.addEventListener(
  'focusin',
  (e) => {
    if (!isTextField(e.target)) return;
    kbHideAt = 0;
    scrollLockY = null; // free to move while the field is still being positioned
    document.documentElement.classList.add('kb-open');
    const el = e.target as HTMLElement;
    // instant, not 'smooth': animating this at the same time as the keyboard's own
    // slide-up animation is what made the field's rise look janky/stuttery - two
    // independent animations fighting for the same 300ms. Snapping it into place
    // immediately lets the keyboard's animation be the only one the eye tracks.
    setTimeout(() => el.scrollIntoView({ block: 'end', behavior: 'auto' }), 350);
    clearTimeout(scrollLockTimer);
    scrollLockTimer = window.setTimeout(() => {
      scrollLockY = window.scrollY;
    }, 700);
  },
  { capture: true },
);
document.addEventListener(
  'focusout',
  (e) => {
    if (!isTextField(e.target)) return;
    // focus can hop straight from one field to another (e.g. Tab) - give that a beat
    // before deciding the keyboard is actually closing, instead of flashing the nav.
    const at = (kbHideAt = Date.now());
    clearTimeout(scrollLockTimer);
    scrollLockY = null;
    setTimeout(() => {
      if (kbHideAt === at) document.documentElement.classList.remove('kb-open');
    }, 100);
  },
  { capture: true },
);
window.addEventListener('orientationchange', setAppHeight);

// Coming back to the app: refresh (reminders may have changed statuses meanwhile)
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else {
    // the browser's own viewport figures can still be settling right at this instant
    requestAnimationFrame(setAppHeight);
    try {
      navigator.clearAppBadge?.();
    } catch {
      /* ignore */
    }
    if (getState().userId && Date.now() - hiddenAt > 60_000) void bootstrap();
  }
});

// A notification can arrive (or be tapped) before this fresh page load's own
// bootstrap() has populated the conversation history – refreshTasks() alone would
// then show the reminder alert over a briefly empty chat until the next restart.
// Fall back to a full bootstrap() the first time, so tasks and messages land together.
const freshTasks = () => (getState().bootstrapped ? refreshTasks() : bootstrap());

// Messages from the service worker (notification buttons while the app is open)
navigator.serviceWorker?.addEventListener('message', (e) => {
  const d = e.data as { type?: string; action?: string; task_id?: string; title?: string; body?: string; sound?: string; kind?: string };
  if (d?.type === 'reminder') {
    // NORA is open: the reminder takes the whole screen (with sound and voice)
    const id = d.task_id;
    if (id && (d.kind === 'main' || d.kind === 'departure' || d.kind === 'snooze' || d.kind === 'nudge')) {
      void freshTasks().then(() => {
        if (getState().tasks[id]?.status === 'reminded') setState({ alertTaskId: id });
      });
      return;
    }
    if (d.sound !== 'silent' && !document.hidden) playChime(d.sound === 'important' ? 'important' : 'normal');
    if (id) toast(`${d.title ?? ''}${d.body ? ` – ${d.body}` : ''}`, { label: tr('common.done'), run: () => void completeTask(id, false) }, 9000);
    void refreshTasks();
    return;
  }
  if (d?.type !== 'notification' || !d.task_id) return;
  if (d.action === 'open') {
    const id = d.task_id;
    if (['main', 'departure', 'snooze', 'nudge'].includes(d.kind ?? '')) {
      // fetch fresh state first: a stale/already-answered reminder must never take the screen
      void freshTasks().then(() => {
        if (getState().tasks[id]?.status === 'reminded') setState({ alertTaskId: id });
      });
    } else setState({ openTaskId: id, tab: 'activity' });
  }
  else if (d.action === 'done') void completeTask(d.task_id, false);
  else if (d.action === 'snooze') void snoozeTask(d.task_id, 15);
  else void refreshTasks();
});
