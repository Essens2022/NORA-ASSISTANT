// Full-screen "it's time" moment. iPhone web notifications can't carry buttons or a
// custom sound, so tapping NORA's notification (or a reminder arriving while NORA is
// open) lands here: big actions, a repeating chime and NORA saying it out loud.
import { useEffect, useState } from 'preact/hooks';
import { formatTime, getLang, tr } from '../../i18n/index.ts';
import { completeTask, snoozeTask, speak } from '../../state/actions.ts';
import { setState, useStore } from '../../state/store.ts';
import { playChime, unlockAudio } from '../../utils/chime.ts';

const REPEAT_MS = 5000;
const MAX_RINGS = 8; // ~40 s, then stays on screen silently

export function ReminderAlert() {
  const { id, task, name } = useStore((s) => ({ id: s.alertTaskId, task: s.alertTaskId ? s.tasks[s.alertTaskId] : undefined, name: s.profile?.display_name ?? null }));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id || !task) return;
    let rings = 0;
    const ring = () => {
      if (rings++ < MAX_RINGS) playChime('important');
    };
    ring();
    const timer = setInterval(ring, REPEAT_MS);
    const line = name ? tr('alert.say_named', { name, title: task.title }) : tr('alert.say', { title: task.title });
    const t = setTimeout(() => void speak(line, getLang()), 1200);
    // audio may start locked (opened from a notification): the first touch unlocks it
    const unlock = () => {
      unlockAudio();
      ring();
    };
    addEventListener('pointerdown', unlock, { once: true });
    return () => {
      clearInterval(timer);
      clearTimeout(t);
      removeEventListener('pointerdown', unlock);
    };
  }, [id, !!task]);

  if (!id || !task) return null;
  const close = () => setState({ alertTaskId: null });
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
    close();
  };

  return (
    <div class="alert-screen" role="alertdialog" aria-modal="true" aria-labelledby="alert-title">
      <div class="alert-pulse" aria-hidden="true">
        <span />
        <span />
      </div>
      <p class="alert-kicker">{name ? tr('alert.kicker_named', { name }) : tr('alert.kicker')}</p>
      <h1 id="alert-title" class="alert-title">
        {task.title}
      </h1>
      {(task.due_time || task.location) && <p class="alert-meta">{[task.due_time ? formatTime(task.due_time) : null, task.location].filter(Boolean).join(' · ')}</p>}
      <div class="alert-actions">
        <button type="button" class="alert-btn primary" disabled={busy} onClick={() => void act(() => completeTask(task.id, false))}>
          ✓ {tr('alert.done')}
        </button>
        <button type="button" class="alert-btn" disabled={busy} onClick={() => void act(() => snoozeTask(task.id, 10))}>
          {tr('alert.snooze10')}
        </button>
        <button type="button" class="alert-btn" disabled={busy} onClick={() => void act(() => snoozeTask(task.id, 60))}>
          {tr('alert.snooze60')}
        </button>
        <button type="button" class="alert-link" onClick={() => setState({ alertTaskId: null, openTaskId: task.id, tab: 'activity' })}>
          {tr('alert.details')}
        </button>
      </div>
    </div>
  );
}
