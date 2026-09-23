import type { Task } from '@nora/core';
import { formatTime, relativeDay, tr, type MessageKey } from '../i18n/index.ts';
import { completeTask, reopenTask } from '../state/actions.ts';
import { setState } from '../state/store.ts';
import { Icon } from './Icon.tsx';

export function TaskCard({ task, today, showDate = false }: { task: Task; today: string; showDate?: boolean }) {
  const done = task.status === 'completed';
  const missingTime = task.missing_fields.includes('time');
  const missingDate = task.missing_fields.includes('date') || (task.status === 'needs_clarification' && !task.due_date);
  const meta: string[] = [];
  if (showDate && task.due_date) meta.push(relativeDay(task.due_date, today));
  if (task.location) meta.push(task.location);
  const flag = task.status === 'missed' ? tr('act.missed') : missingTime ? tr('act.missing_time') : missingDate ? tr('act.missing_date') : null;

  return (
    <li class={`task-card${done ? ' done' : ''}${task.priority === 'high' ? ' high' : ''}`}>
      <button
        type="button"
        class={`check${done ? ' checked' : ''}`}
        role="checkbox"
        aria-checked={done}
        aria-label={tr('act.mark_done', { title: task.title })}
        onClick={() => (done ? reopenTask(task.id) : completeTask(task.id))}
      >
        {done && <Icon name="check" size={16} />}
      </button>
      <button type="button" class="task-main" onClick={() => setState({ openTaskId: task.id })}>
        <span class="task-time">{task.due_time ? formatTime(task.due_time) : task.time_window ? tr(`task.window.${task.time_window}` as MessageKey) : ''}</span>
        <span class="task-text">
          <span class="task-title">{task.title}</span>
          {(meta.length > 0 || flag || task.recurrence) && (
            <span class="task-meta">
              {task.recurrence && <Icon name="repeat" size={13} />}
              {meta.join(' · ')}
              {flag && (
                <span class="flag">
                  <Icon name="alert" size={13} /> {flag}
                </span>
              )}
            </span>
          )}
        </span>
        <Icon name="chevron" size={16} class="chev" />
      </button>
    </li>
  );
}

export function statusLabel(task: Task): string {
  return tr(`status.${task.status}` as MessageKey);
}
