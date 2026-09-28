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
// With interactive-widget=resizes-content (index.html) the browser now shrinks the
// layout viewport for the keyboard itself, so visualViewport.height already *is*
// the keyboard-aware height - no separate --kb/transform bookkeeping needed here
// any more, the composer's sticky positioning (see .ai-footer in styles.css) rides
// this the same way it rides everything else.
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
// Placing the field itself above the keyboard used to take a pile of custom scroll
// tricks (visualViewport-based, scrollIntoView, position:fixed probes) that all
// overshot or undershot, because none of them agreed with where the keyboard
// actually was on a given device. Most of that is gone now: the viewport meta tag
// (interactive-widget=resizes-content, index.html) makes the browser itself shrink
// the page for the keyboard, so the sticky footer (.ai-footer in styles.css) is
// simply always at the bottom of the now-shorter screen.
//
// One thing that shrink doesn't fix by itself: Safari still tries to "scroll the
// focused field into view" the moment it's focused, exactly like it always did -
// and with a sticky-positioned footer that scroll routinely overshoots (a known
// WebKit quirk with sticky elements), dragging the *whole page*, header and all,
// up past the top of the screen (seen on device: everything gone, just empty
// background above the keyboard). The AI Home screen never needs the page itself
// to scroll for this - only its own conversation does (.ai-scroll) - so while a
// field is focused, hold the page at the top and let nothing move it: html.kb-open
// below disables page scrolling outright, and this listener corrects any scroll
// that sneaks in before/around that (e.g. the moment focus itself fires) straight
// back to zero, every time, until the field loses focus.
let kbHideAt = 0;
const holdScrollAtTop = () => {
  if (document.documentElement.classList.contains('kb-open') && (window.scrollX !== 0 || window.scrollY !== 0)) window.scrollTo(0, 0);
};
window.addEventListener('scroll', holdScrollAtTop, { passive: true });

const isTextField = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
// Tapping anywhere outside the field you're typing in dismisses the keyboard - the
// standard chat behaviour; otherwise the only way out is the keyboard's own "done"
// key. Only the field's own container (the composer with its send button) is exempt,
// so tapping "send" or a suggestion never yanks the keyboard away mid-action.
let dismissedAt = 0;
let dismissTarget: Element | null = null;
// Only the AI Home composer floats independently above the keyboard (see .ai-footer
// in styles.css) while the conversation/briefing behind it stay in their normal,
// undisturbed layout - so "tap outside to dismiss" there routinely lands on real
// content (a task card) that was never the point of the tap. Everywhere else (a
// dialog's own field, e.g. the reschedule sheet's "Ora"), the field and the buttons
// around it move together normally, so a tap that reaches a *button* is a deliberate
// press on it (e.g. "Salvează") and must go through even though it also dismisses.
let strictDismiss = false;
document.addEventListener(
  'pointerdown',
  (e) => {
    // a new finger-down is a new, deliberate tap: whatever guard the previous
    // dismiss set up is over (it only ever targets that gesture's own phantom click)
    dismissedAt = 0;
    dismissTarget = null;
    const active = document.activeElement;
    if (!isTextField(active)) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (isTextField(t) || t.closest('.composer, .field, label')) return;
    dismissedAt = Date.now();
    dismissTarget = t;
    strictDismiss = !!(active as HTMLElement).closest('.ai-footer');
    (active as HTMLElement).blur();
  },
  { capture: true },
);
// The tap that dismisses the keyboard must not also hit something it never aimed
// at. Blurring collapses the keyboard and the layout can shift under the
// still-descending finger, so the synthetic mousedown/click iOS fires *after*
// touchend lands on whatever is now at that spot - the composer (re-opening the
// keyboard), or (on the AI Home screen specifically) the briefing's task card,
// opening its detail sheet the instant you were just trying to put the keyboard
// away (seen on video). There: swallow the follow-up outright, the same way a
// dismiss tap works in any native app. Elsewhere: only swallow it when it would
// land somewhere *other* than what the finger actually touched, so a deliberate
// press on a real button (e.g. "Salvează" right after typing in the field next to
// it) still goes through.
for (const type of ['mousedown', 'click'] as const)
  document.addEventListener(
    type,
    (e) => {
      // generous window: a slower press keeps the finger down longer, and the phantom
      // click only fires after it lifts - any *new* pointerdown resets this anyway
      if (Date.now() - dismissedAt > 1500 || !dismissTarget) return;
      const t = e.target;
      if (!strictDismiss && t instanceof Node && dismissTarget.contains(t)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true },
  );
document.addEventListener(
  'focusin',
  (e) => {
    if (!isTextField(e.target)) return;
    kbHideAt = 0;
    document.documentElement.classList.add('kb-open');
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
