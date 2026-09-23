import { activityBucket, type Task } from '@nora/core';
import { useMemo, useState } from 'preact/hooks';
import { TaskCard } from '../../components/TaskCard.tsx';
import { Button, EmptyState } from '../../components/ui.tsx';
import { tr, type MessageKey } from '../../i18n/index.ts';
import { loadCompleted } from '../../state/actions.ts';
import { setState, toast, useStore, toastError } from '../../state/store.ts';
import { todayLocal } from '../../utils/time.ts';
import { NewTaskSheet } from '../task/TaskDetail.tsx';

const order = (a: Task, b: Task) => `${a.due_date ?? '9999'}${a.due_time ?? '99'}${a.created_at}`.localeCompare(`${b.due_date ?? '9999'}${b.due_time ?? '99'}${b.created_at}`);

export function ActivityScreen() {
  const { tasks, completedLoaded, bootstrapped } = useStore((s) => ({ tasks: s.tasks, completedLoaded: s.completedLoaded, bootstrapped: s.bootstrapped }));
  const [showCompleted, setShowCompleted] = useState(false);
  const [loadingDone, setLoadingDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const today = todayLocal();

  const groups = useMemo(() => {
    const g: Record<'today' | 'upcoming' | 'attention' | 'inbox' | 'completed', Task[]> = { today: [], upcoming: [], attention: [], inbox: [], completed: [] };
    for (const t of Object.values(tasks)) {
      const b = activityBucket(t, today);
      if (b !== 'hidden') g[b].push(t);
    }
    g.today.sort(order);
    g.upcoming.sort(order);
    g.attention.sort(order);
    g.inbox.sort((a, b) => b.created_at.localeCompare(a.created_at));
    g.completed.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
    return g;
  }, [tasks, today]);

  const openCount = groups.today.length + groups.upcoming.length + groups.attention.length + groups.inbox.length;

  const toggleCompleted = async () => {
    if (!showCompleted && !completedLoaded) {
      setLoadingDone(true);
      try {
        await loadCompleted();
      } catch {
        toastError(tr('err.network'));
      }
      setLoadingDone(false);
    }
    setShowCompleted((v) => !v);
  };

  const sections: Array<['attention' | 'today' | 'upcoming' | 'inbox', MessageKey, boolean]> = [
    ['today', 'act.today', false],
    ['upcoming', 'act.upcoming', true],
    ['attention', 'act.attention', true],
    ['inbox', 'act.inbox', false],
  ];

  return (
    <div class="screen activity-screen">
      <header class="screen-head">
        <h1>{tr('act.title')}</h1>
        <Button small icon="plus" onClick={() => setCreating(true)}>
          {tr('task.new')}
        </Button>
      </header>

      {bootstrapped && openCount === 0 && (
        <EmptyState title={tr('act.empty_title')} text={tr('act.empty_hint')}>
          <Button variant="primary" icon="mic" onClick={() => setState({ tab: 'ai' })}>
            {tr('ai.mic')}
          </Button>
        </EmptyState>
      )}

      {!bootstrapped && openCount === 0 && (
        <div class="skeleton-list" aria-busy="true" aria-label="…">
          <div class="skeleton skeleton-row" />
          <div class="skeleton skeleton-row" />
          <div class="skeleton skeleton-row" />
        </div>
      )}

      {sections.map(([key, label, showDate]) =>
        groups[key].length ? (
          <section class="group" key={key} aria-labelledby={`g-${key}`}>
            <h2 id={`g-${key}`} class={`group-title${key === 'attention' ? ' warn' : ''}`}>
              {tr(label)} <span class="count">{groups[key].length}</span>
            </h2>
            <ul class="task-list">
              {groups[key].map((t) => (
                <TaskCard key={t.id} task={t} today={today} showDate={showDate} />
              ))}
            </ul>
          </section>
        ) : null,
      )}

      <div class="completed-toggle">
        <Button small busy={loadingDone} onClick={() => void toggleCompleted()}>
          {showCompleted ? tr('act.hide_completed') : tr('act.show_completed')}
        </Button>
      </div>
      {showCompleted && (
        <section class="group" aria-labelledby="g-completed">
          <h2 id="g-completed" class="group-title">
            {tr('act.completed')}
          </h2>
          {groups.completed.length ? (
            <ul class="task-list">
              {groups.completed.slice(0, 50).map((t) => (
                <TaskCard key={t.id} task={t} today={today} showDate />
              ))}
            </ul>
          ) : (
            <p class="muted pad">{tr('act.completed_empty')}</p>
          )}
        </section>
      )}
      <NewTaskSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
