import { render } from 'preact';
import { App } from './App.tsx';
import { detectDeviceLang, setLang } from './i18n/index.ts';
import { flushQueue, track } from './services/api.ts';
import { registerServiceWorker } from './services/push.ts';
import { bootstrap, completeTask, initAuth, refreshTasks, snoozeTask } from './state/actions.ts';
import { getState, setState, type Tab } from './state/store.ts';
import { applyTheme } from './utils/theme.ts';
import { playChime } from './utils/chime.ts';
import { tr } from './i18n/index.ts';
import { toast } from './state/store.ts';
import './styles.css';

applyTheme();

// deep links: /activity, /profile, /?task=<id>
const path = location.pathname.replace(/\/+$/, '').slice(1) as Tab;
if (path === 'activity' || path === 'profile') setState({ tab: path });
const params = new URLSearchParams(location.search);
const deepTask = params.get('task');

void setLang(detectDeviceLang()).then(() => {
  render(<App />, document.getElementById('app')!);
  requestAnimationFrame(() => setTimeout(() => track('tti_ms', Math.round(performance.now())), 0));
});

initAuth();
void registerServiceWorker();

if (deepTask) {
  const stop = setInterval(() => {
    if (getState().tasks[deepTask]) {
      setState({ openTaskId: deepTask, tab: 'activity' });
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
  const d = e.data as { type?: string; action?: string; task_id?: string; title?: string; body?: string; sound?: string };
  if (d?.type === 'reminder') {
    // NORA is open: play her chime and show the reminder right here as well
    if (d.sound !== 'silent' && !document.hidden) playChime(d.sound === 'important' ? 'important' : 'normal');
    if (d.task_id) {
      const id = d.task_id;
      toast(`${d.title ?? ''}${d.body ? ` – ${d.body}` : ''}`, { label: tr('common.done'), run: () => void completeTask(id, false) }, 9000);
    }
    void refreshTasks();
    return;
  }
  if (d?.type !== 'notification' || !d.task_id) return;
  if (d.action === 'open') setState({ openTaskId: d.task_id, tab: 'activity' });
  else if (d.action === 'done') void completeTask(d.task_id, false);
  else if (d.action === 'snooze') void snoozeTask(d.task_id, 15);
  else void refreshTasks();
});
