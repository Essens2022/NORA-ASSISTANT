// "What NORA knows about your day" – the visible proof that she is paying attention.
import { activityBucket, type Task } from '@nora/core';
import { Icon } from '../../components/Icon.tsx';
import { formatTime, relativeDay, relativeFromNow, tp, tr } from '../../i18n/index.ts';
import { setState } from '../../state/store.ts';
import { nowLocal } from '../../utils/time.ts';

const DAY_START = 6 * 60;
const DAY_END = 24 * 60;

export function Briefing({ tasks, today, compact = false }: { tasks: Record<string, Task>; today: string; compact?: boolean }) {
  const all = Object.values(tasks);
  const todays = all.filter((t) => activityBucket(t, today) === 'today').sort((a, b) => (a.due_time ?? '99').localeCompare(b.due_time ?? '99'));
  const nowIso = new Date().toISOString();
  const next = all
    .filter((t) => ['today', 'upcoming'].includes(activityBucket(t, today)) && t.start_at && t.start_at >= nowIso)
    .sort((a, b) => a.start_at!.localeCompare(b.start_at!))[0];
  const attention = all.filter((t) => activityBucket(t, today) === 'attention').slice(0, 3);
  const z = nowLocal();
  const nowMin = z.hour * 60 + z.minute;
  const pos = (min: number) => `${Math.min(100, Math.max(0, ((min - DAY_START) / (DAY_END - DAY_START)) * 100))}%`;
  const timed = todays.filter((t) => t.due_time);

  return (
    <section class="briefing briefing-compact" aria-label={tr('ai.briefing')}>
      <div class="brief-compact-head">
        <p class="brief-label">
          <Icon name="spark" size={14} /> {tr('ai.briefing')}
        </p>
        {attention.length > 0 && (
          <button type="button" class="brief-attention-count" onClick={() => setState({ tab: 'activity' })}>
            <Icon name="alert" size={13} />
            <span>{attention.length}</span>
          </button>
        )}
      </div>

      {next ? (
        <button type="button" class="brief-next brief-next-compact" onClick={() => setState({ openTaskId: next.id })}>
          <Countdown iso={next.start_at!} />
          <span class="brief-next-label">{tr('ai.next_up')}</span>
          <span class="brief-next-title">{next.title}</span>
          <span class="brief-next-when">
            {next.due_date !== today && next.due_date ? `${relativeDay(next.due_date, today)} · ` : ''}
            {next.due_time ? formatTime(next.due_time) : ''}
          </span>
        </button>
      ) : (
        <p class="brief-compact-free">{todays.length ? tp('ai.brief', todays.length) : tr('ai.brief_free')}</p>
      )}
    </section>
  );
}

/** Ring that empties as the next task approaches (full = 3 h or more away). */
function Countdown({ iso }: { iso: string }) {
  const mins = Math.max(0, (Date.parse(iso) - Date.now()) / 60000);
  const frac = Math.min(1, mins / 180);
  const C = 2 * Math.PI * 18;
  return (
    <svg class="countdown" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="18" class="cd-track" />
      <circle cx="22" cy="22" r="18" class="cd-fill" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} />
      <circle cx="22" cy="22" r="4" class="cd-core" />
    </svg>
  );
}
