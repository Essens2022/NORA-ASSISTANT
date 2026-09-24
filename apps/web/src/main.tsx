import { render } from 'preact';
import { App } from './App.tsx';
import { detectDeviceLang, setLang } from './i18n/index.ts';
import { flushQueue, track } from './services/api.ts';
import { completeHandoff, watchHandoff } from './services/auth.ts';
import { registerServiceWorker } from './services/push.ts';
import { primeSpeech } from './services/voice/tts.ts';
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

// deep links: /activity, /profile, /?task=<id>
const path = location.pathname.slice(import.meta.env.BASE_URL.length).replace(/\/+$/, '') as Tab;
if (path === 'activity' || path === 'profile') setState({ tab: path });
const params = new URLSearchParams(location.search);
const deepTask = params.get('task');
const deepAlert = params.get('alert') === '1';
if (deepTask) history.replaceState(null, '', location.pathname);

void setLang(detectDeviceLang()).then(() => {
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
};
addEventListener('pointerdown', unlockAll, { once: true, capture: true });
addEventListener('keydown', unlockAll, { once: true, capture: true });
void registerServiceWorker();

if (deepTask) {
  const stop = setInterval(() => {
    if (getState().tasks[deepTask]) {
      setState(deepAlert ? { alertTaskId: deepTask } : { openTaskId: deepTask, tab: 'activity' });
      clearInterval(stop);
    }
  }, 200);
  setTimeout(() => clearInterval(stop), 10_000);
}

window.addEventListener('online', () => {
  setState({ online: true });
  void flushQueue().then(() => refreshTasks());
});
window.addEventListener('offline', () => setState({ online: false }));

// Coming back to the app: refresh (reminders may have changed statuses meanwhile)
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (getState().userId && Date.now() - hiddenAt > 60_000) void bootstrap();
});

// Messages from the service worker (notification buttons while the app is open)
navigator.serviceWorker?.addEventListener('message', (e) => {
  const d = e.data as { type?: string; action?: string; task_id?: string; title?: string; body?: string; sound?: string; kind?: string };
  if (d?.type === 'reminder') {
    // NORA is open: play her chime and show the reminder right here as well
    // NORA is open: the reminder takes the whole screen (with sound and voice)
    const id = d.task_id;
    if (id && (d.kind === 'main' || d.kind === 'departure' || d.kind === 'snooze' || d.kind === 'nudge')) {
      void refreshTasks().then(() => {
        if (getState().tasks[id]) setState({ alertTaskId: id });
      });
      return;
    }
    if (d.sound !== 'silent' && !document.hidden) playChime(d.sound === 'important' ? 'important' : 'normal');
    if (id) toast(`${d.title ?? ''}${d.body ? ` – ${d.body}` : ''}`, { label: tr('common.done'), run: () => void completeTask(id, false) }, 9000);
    void refreshTasks();
    return;
  }
  if (d?.type !== 'notification' || !d.task_id) return;
  if (d.action === 'open') setState(['main', 'departure', 'snooze', 'nudge'].includes(d.kind ?? '') ? { alertTaskId: d.task_id } : { openTaskId: d.task_id, tab: 'activity' });
  else if (d.action === 'done') void completeTask(d.task_id, false);
  else if (d.action === 'snooze') void snoozeTask(d.task_id, 15);
  else void refreshTasks();
});
