// "What NORA knows about your day" – the visible proof that she is paying attention.
import { activityBucket, type Task } from '@nora/core';
import { Icon } from '../../components/Icon.tsx';
import { formatTime, relativeDay, relativeFromNow, tp, tr } from '../../i18n/index.ts';
import { setState } from '../../state/store.ts';
import { nowLocal } from '../../utils/time.ts';

const DAY_START = 6 * 60;
const DAY_END = 24 * 60;

export function Briefing({ tasks, today }: { tasks: Record<string, Task>; today: string }) {
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
    <section class="briefing" aria-label={tr('ai.briefing')}>
      <p class="brief-label">
        <Icon name="spark" size={14} /> {tr('ai.briefing')}
      </p>
      <p class="brief-summary">{todays.length ? tp('ai.brief', todays.length) : tr('ai.brief_free')}</p>

      {next && (
        <button type="button" class="brief-next" onClick={() => setState({ openTaskId: next.id })}>
          <Countdown iso={next.start_at!} />
          <span class="brief-next-label">{tr('ai.next_up')}</span>
          <span class="brief-next-title">{next.title}</span>
          <span class="brief-next-when">
            {next.due_date !== today && next.due_date ? `${relativeDay(next.due_date, today)} · ` : ''}
            {next.due_time ? formatTime(next.due_time) : ''}
            {next.start_at && next.due_date === today ? <em> · {relativeFromNow(next.start_at)}</em> : null}
          </span>
        </button>
      )}

      {timed.length > 0 && (
        <div class="timeline" role="img" aria-label={timed.map((t) => `${formatTime(t.due_time!)} ${t.title}`).join(', ')}>
          <span class="tl-track" />
          <span class="tl-past" style={{ width: pos(nowMin) }} />
          {timed.map((t) => {
            const [h, m] = t.due_time!.split(':').map(Number);
            const past = h * 60 + m < nowMin;
            return <span key={t.id} class={`tl-dot${past ? ' past' : ''}${t.id === next?.id ? ' next' : ''}`} style={{ left: pos(h * 60 + m) }} title={`${formatTime(t.due_time!)} ${t.title}`} />;
          })}
          <span class="tl-now" style={{ left: pos(nowMin) }} />
          <span class="tl-hours" aria-hidden="true">
            <span>6</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </span>
        </div>
      )}

      {attention.length > 0 && (
        <div class="brief-attention">
          <p class="brief-att-label">{tr('ai.needs_you')}</p>
          <ul>
            {attention.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setState({ openTaskId: t.id })}>
                  <Icon name="alert" size={14} />
                  <span>{t.title}</span>
                  <em>{t.missing_fields.includes('time') ? tr('act.missing_time') : !t.due_date ? tr('act.missing_date') : tr('act.missed')}</em>
                </button>
              </li>
            ))}
          </ul>
        </div>
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
