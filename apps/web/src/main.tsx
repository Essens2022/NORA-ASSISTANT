import { render } from 'preact';
import { App } from './App.tsx';
import { setLang } from './i18n/index.ts';
import { flushQueue, track } from './services/api.ts';
import { completeHandoff, watchHandoff } from './services/auth.ts';
import { registerServiceWorker } from './services/push.ts';
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
// Audio (speech synthesis, an <audio> element, an AudioContext) only starts inside
// a real user gesture on iOS - but unlocking it on the very first touch anywhere in
// the whole app, unconditionally, claimed the device's audio session before there
// was ever anything to say, and kept it claimed even if voice was never touched -
// on device this silenced whatever else was playing (Spotify) the moment NORA was
// merely opened, and it never came back (seen on video). Unlocked instead, right on
// the two taps that can actually lead to NORA speaking - see AIScreen.tsx's
// unlockVoiceAudio (mic press, sending a message) and ReminderAlert.tsx (a
// reminder's own screen, which deliberately does interrupt other audio to be heard).
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

// 100dvh used to need a JS-computed stand-in for a stale dvh right after a long
// background/foreground cycle, a known iOS Safari bug - that's gone, plain 100dvh
// is trustworthy again. The keyboard is a separate story: interactive-widget=
// resizes-content (index.html) *asks* the browser to shrink the layout viewport
// (and so 100dvh) for the keyboard itself, the same way a native app's window
// would - but on this device, with this keyboard (seen on video: Gboard, not
// Apple's own), that request is silently ignored - window.innerHeight stays the
// full, un-shrunk height throughout, only visualViewport.height actually drops.
// 100dvh then never shrinks either, so the sticky footer (bottom:0 of a screen
// that's still "full height" as far as layout is concerned) sits at the true
// bottom of the *unshrunk* page - which the keyboard is now covering. Detect
// that gap directly (innerHeight vs. visualViewport.height) and ride it with a
// transform, exactly the amount the browser refused to do on its own - a
// transform never touches layout/height, only compositing, so this can't
// re-open the timing race the height-driven version of this had (the footer's
// container never changes size; only the footer's own paint position does).
// Where interactive-widget *is* honoured, innerHeight already shrinks with
// visualViewport, this gap comes out ~0, and the transform is a no-op - so the
// same code is correct whether or not this device's keyboard cooperates.
const setKbOffset = () => {
  const vv = window.visualViewport;
  let kb = vv ? Math.min(400, Math.max(0, window.innerHeight - vv.height)) : 0;
  // Never let the lift push the footer's top edge above where the header and
  // briefing need to end, no matter what the raw keyboard measurement says -
  // the one thing that's gone wrong here before (the whole top pushed away,
  // only the footer's own background left showing).
  const footerH = document.querySelector<HTMLElement>('.ai-footer')?.offsetHeight ?? 180;
  const headReserve = (document.querySelector<HTMLElement>('.ai-head')?.offsetHeight ?? 0) + (document.querySelector<HTMLElement>('.briefing')?.offsetHeight ?? 0) + 24;
  kb = Math.min(kb, Math.max(0, window.innerHeight - footerH - headReserve));
  document.documentElement.style.setProperty('--kb', `${kb}px`);
};
setKbOffset();
window.visualViewport?.addEventListener('resize', setKbOffset);
window.visualViewport?.addEventListener('scroll', setKbOffset);
window.addEventListener('resize', setKbOffset);
window.addEventListener('orientationchange', setKbOffset);

// Safari still tries to "scroll the focused field into view" the moment it's
// focused, exactly like it always did - and with a sticky-positioned footer that
// scroll routinely overshoots (a known WebKit quirk with sticky elements),
// dragging the *whole page*, header and all, up past the top of the screen (seen
// on device: everything gone, just empty background above the keyboard). The AI
// Home screen never needs the page itself to scroll for this - only its own
// conversation does (.ai-scroll) - so while a field is focused, hold the page at
// the top and let nothing move it: html.kb-open (styles.css) disables page
// scrolling outright, and this listener corrects any scroll that sneaks in
// before/around that straight back to zero, every time, until focus is lost.
let kbHideAt = 0;
let kbPollTimer = 0;
const holdScrollAtTop = () => {
  if (document.documentElement.classList.contains('kb-open') && (window.scrollX !== 0 || window.scrollY !== 0)) window.scrollTo(0, 0);
};
window.addEventListener('scroll', holdScrollAtTop, { passive: true });

// A page whose content fits the viewport shouldn't be scrollable at all (see
// the .page-scrollable comment in styles.css for why overscroll-behavior
// alone doesn't cover this). Re-checked on every layout change that could
// make the fit change - a tab switch, data loading in, the keyboard opening/
// closing, rotating the device - via a ResizeObserver on <body> rather than
// hooking every one of those individually.
// iOS shrinks/grows window.innerHeight on its own as the address bar
// collapses and reappears *during* a scroll gesture - turning overflow off
// right then (mid-scroll, scrollY > 0) would yank the content back to 0 out
// from under the person's finger (seen on device as a jump/micro-stutter).
// But leaving it scrollable and just waiting for scrollY to settle at 0 on
// its own (an earlier version of this) turned out worse: switching from a
// taller tab to Profilo can momentarily still report the old, taller
// scrollHeight (the ResizeObserver callback racing the tab-panel's own
// display toggle), so Profilo briefly looked scrollable - and a flick
// during that exact window left it scrolled with nothing to ever bring it
// back (seen on a real recording: the title scrolled off and stayed gone).
// Snapping to the top before dropping scrollability guarantees it always
// actually lands there instead of just hoping it already has - but never
// while a finger is actively down, which would be the exact "yanked out
// from under the finger" jank this is meant to avoid. touchend re-checks,
// so a page that settles non-scrollable after all still gets corrected
// the moment the finger lifts, not left stuck.
let touching = false;
const updatePageScrollable = () => {
  const scrollable = document.documentElement.scrollHeight > window.innerHeight + 1;
  if (scrollable) {
    document.documentElement.classList.add('page-scrollable');
    return;
  }
  if (touching) return;
  if (window.scrollY !== 0) window.scrollTo(0, 0);
  document.documentElement.classList.remove('page-scrollable');
};
window.addEventListener('touchstart', () => (touching = true), { passive: true });
for (const type of ['touchend', 'touchcancel'] as const)
  window.addEventListener(
    type,
    () => {
      touching = false;
      updatePageScrollable();
    },
    { passive: true },
  );
new ResizeObserver(updatePageScrollable).observe(document.body);
window.addEventListener('resize', updatePageScrollable);
updatePageScrollable();

// Belt and braces for the above: .page-scrollable only stops the page from
// being scrolled *after the fact* (it changes overflow, which blocks the
// browser's own scroll mechanism but not a direct touch-drag the same way
// .nav - which is position:fixed and was simply never a scroll target to
// begin with - is immovable). Cancel a drag outright whenever it would move
// the page and the page isn't marked scrollable, so a non-scrollable screen
// is exactly that from the very first pixel of the gesture, not just once
// some CSS/JS state has caught up. Lets a drag through untouched when it's
// actually inside its own scrollable element (the chat on Home, a sheet's
// body, a horizontally-scrollable chip row) - those still work normally
// even while the outer page itself is locked.
const hasOwnScroll = (el: Element) => {
  const cs = getComputedStyle(el);
  return (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) || (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth);
};
document.addEventListener(
  'touchmove',
  (e) => {
    if (document.documentElement.classList.contains('page-scrollable')) return;
    for (let el = e.target as Element | null; el && el !== document.body; el = el.parentElement) {
      if (hasOwnScroll(el)) return;
    }
    e.preventDefault();
  },
  { passive: false },
);

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
    // Belt and braces for --kb (see setKbOffset above): on a second focus right
    // after the keyboard just closed, iOS sometimes never re-fires visualViewport's
    // resize/scroll events for the reopen, leaving --kb stuck at its old (closed,
    // ~0) value. Poll directly for as long as the keyboard could still be
    // animating, so a missed event doesn't leave the footer stranded.
    clearInterval(kbPollTimer);
    kbPollTimer = window.setInterval(setKbOffset, 80);
    setTimeout(() => clearInterval(kbPollTimer), 900);
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
    clearInterval(kbPollTimer);
    setTimeout(() => {
      if (kbHideAt === at) document.documentElement.classList.remove('kb-open');
    }, 100);
  },
  { capture: true },
);
// Coming back to the app: refresh (reminders may have changed statuses meanwhile)
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else {
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
