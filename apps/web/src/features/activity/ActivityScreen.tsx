import { activityBucket, type Task } from '@nora/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ProgressRing } from '../../components/ProgressRing.tsx';
import { TaskCard } from '../../components/TaskCard.tsx';
import { Button, EmptyState } from '../../components/ui.tsx';
import { tr, type MessageKey } from '../../i18n/index.ts';
import { loadCompleted } from '../../state/actions.ts';
import { setState, toast, useStore, toastError } from '../../state/store.ts';
import { todayLocal } from '../../utils/time.ts';

const order = (a: Task, b: Task) => `${a.due_date ?? '9999'}${a.due_time ?? '99'}${a.created_at}`.localeCompare(`${b.due_date ?? '9999'}${b.due_time ?? '99'}${b.created_at}`);

export function ActivityScreen() {
  const { tasks, completedLoaded, bootstrapped } = useStore((s) => ({ tasks: s.tasks, completedLoaded: s.completedLoaded, bootstrapped: s.bootstrapped }));
  const [showCompleted, setShowCompleted] = useState(false);
  const [loadingDone, setLoadingDone] = useState(false);
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

  useEffect(() => {
    if (!completedLoaded) void loadCompleted().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dueToday = useMemo(() => Object.values(tasks).filter((t) => t.due_date === today && t.status !== 'cancelled'), [tasks, today]);
  const doneToday = dueToday.filter((t) => t.status === 'completed').length;
  const dayPercent = dueToday.length ? Math.round((doneToday / dueToday.length) * 100) : null;

  const stats: Array<['today' | 'attention' | 'upcoming', MessageKey]> = [
    ['today', 'act.today'],
    ['attention', 'act.attention'],
    ['upcoming', 'act.upcoming'],
  ];
  const scrollTo = (key: string) => document.getElementById(`g-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
      </header>

      {bootstrapped && dayPercent !== null && (
        <div class="day-card">
          <ProgressRing percent={dayPercent} />
          <div class="day-card-text">
            <h3>{tr('act.day_progress')}</h3>
            <p>{tr('act.day_progress_hint', { done: doneToday, total: dueToday.length })}</p>
          </div>
        </div>
      )}

      {bootstrapped && openCount > 0 && (
        <div class="act-stats" role="group" aria-label={tr('act.title')}>
          {stats.map(([key, label]) => (
            <button type="button" key={key} class={`act-stat${key === 'attention' && groups[key].length ? ' warn' : ''}`} onClick={() => scrollTo(key)} disabled={groups[key].length === 0}>
              <span class="act-stat-n">{groups[key].length}</span>
              <span class="act-stat-label">{tr(label)}</span>
            </button>
          ))}
        </div>
      )}

      {bootstrapped && openCount === 0 && (
        <EmptyState title={tr('act.empty_title')} text={tr('act.empty_hint')}>
          <Button variant="primary" icon="mic" onClick={() => setState({ tab: 'ai' })}>
            {tr('ai.mic')}
          </Button>
        </EmptyState>
      )}

      {!bootstrapped && openCount === 0 && (
        <div class="skeleton-list" aria-busy="true" aria-label={tr('common.loading')}>
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
    </div>
  );
}
