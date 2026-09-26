// Full-screen "it's time" moment. iPhone web notifications can't carry buttons or a
// custom sound, so tapping NORA's notification (or a reminder arriving while NORA is
// open) lands here: big actions, a repeating chime and NORA saying it out loud.
import { useEffect, useState } from 'preact/hooks';
import { formatTime, getLang, tr } from '../../i18n/index.ts';
import { completeTask, snoozeTask, speak } from '../../state/actions.ts';
import { setState, useStore } from '../../state/store.ts';
import { playChime, unlockAudio } from '../../utils/chime.ts';
import { tts } from '../../services/voice/tts.ts';

const REPEAT_MS = 5000;
const MAX_RINGS = 8; // ~40 s, then stays on screen silently

export function ReminderAlert() {
  const { id, task, name } = useStore((s) => ({ id: s.alertTaskId, task: s.alertTaskId ? s.tasks[s.alertTaskId] : undefined, name: s.profile?.display_name ?? null }));
  const [busy, setBusy] = useState(false);

  // this screen is always dark (see .alert-screen), regardless of the app's own
  // light/dark setting – the status bar has to follow along or it shows up as a
  // pale strip over a dark screen.
  useEffect(() => {
    if (!id) return;
    const meta = document.querySelector('meta[name="theme-color"]');
    const previous = meta?.getAttribute('content');
    meta?.setAttribute('content', '#0b1220');
    return () => {
      if (previous != null) meta?.setAttribute('content', previous);
    };
  }, [!!id]);

  useEffect(() => {
    if (!id || !task) return;
    let rings = 0;
    const ring = () => {
      if (rings++ < MAX_RINGS) playChime('important');
    };
    ring();
    const timer = setInterval(ring, REPEAT_MS);
    const line = name ? tr('alert.say_named', { name, title: task.title }) : tr('alert.say', { title: task.title });
    // Try right away, no delay: if this screen was reached by tapping the
    // notification itself, iOS sometimes still carries that tap's "user
    // activated" trust into the freshly opened page for a brief moment –
    // our best chance of speaking without any further touch on the page.
    const say = () => void speak(line, getLang());
    say();
    // That trust often doesn't carry over: the first touch anywhere on this
    // screen unlocks audio and repeats sound + voice immediately, instead of
    // waiting for the reminder to be dismissed first.
    const unlock = () => {
      unlockAudio();
      tts.unlock();
      ring();
      say();
    };
    addEventListener('pointerdown', unlock, { once: true });
    return () => {
      clearInterval(timer);
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
