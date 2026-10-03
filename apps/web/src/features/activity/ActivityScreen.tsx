import { activityBucket, type Task } from '@nora/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { TaskCard } from '../../components/TaskCard.tsx';
import { Button, EmptyState } from '../../components/ui.tsx';
import { useMeasuredHeight, useStickyHeadHeight } from '../../hooks.ts';
import { tr, type MessageKey } from '../../i18n/index.ts';
import { loadCompleted } from '../../state/actions.ts';
import { setState, useStore, toastError } from '../../state/store.ts';
import { todayLocal } from '../../utils/time.ts';
import { NewTaskSheet } from '../task/TaskDetail.tsx';

const order = (a: Task, b: Task) => `${a.due_date ?? '9999'}${a.due_time ?? '99'}${a.created_at}`.localeCompare(`${b.due_date ?? '9999'}${b.due_time ?? '99'}${b.created_at}`);

export function ActivityScreen() {
  const { tasks, completedLoaded, bootstrapped, active } = useStore((s) => ({ tasks: s.tasks, completedLoaded: s.completedLoaded, bootstrapped: s.bootstrapped, active: s.tab === 'activity' }));
  const [filter, setFilter] = useState<'all' | 'today' | 'completed'>('all');
  const [loadingDone, setLoadingDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const today = todayLocal();
  const [headRef, headH] = useStickyHeadHeight(16, active);
  const [addRef, addH] = useMeasuredHeight(active);

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

  useEffect(() => {
    if (filter !== 'completed' || completedLoaded) return;
    setLoadingDone(true);
    loadCompleted()
      .catch(() => toastError(tr('err.network')))
      .finally(() => setLoadingDone(false));
  }, [filter, completedLoaded]);

  const sections: Array<['attention' | 'today' | 'upcoming' | 'inbox', MessageKey, boolean]> = [
    ['today', 'act.today', false],
    ['upcoming', 'act.upcoming', true],
    ['attention', 'act.attention', true],
    ['inbox', 'act.inbox', false],
  ];

  return (
    <div class="screen activity-screen">
      <div class="screen-sticky-head" ref={headRef}>
        <header class="screen-head">
          <h1>{tr('act.title')}</h1>
        </header>

        <div class="chips act-range" role="group" aria-label={tr('act.title')}>
          {(['all', 'today', 'completed'] as const).map((f) => (
            <button type="button" key={f} class={`chip${filter === f ? ' selected' : ''}`} onClick={() => setFilter(f)}>
              {tr(f === 'all' ? 'act.filter_all' : f === 'today' ? 'act.today' : 'act.completed')}
            </button>
          ))}
        </div>
      </div>

      <div style={{ paddingTop: headH, paddingBottom: addH ? addH + 16 : 0 }}>
      {!bootstrapped && (
        <div class="skeleton-list" aria-busy="true" aria-label={tr('common.loading')}>
          <div class="skeleton skeleton-row" />
          <div class="skeleton skeleton-row" />
          <div class="skeleton skeleton-row" />
        </div>
      )}

      {bootstrapped && filter === 'today' && (
        <ul class="task-list">
          {groups.today.map((t) => (
            <TaskCard key={t.id} task={t} today={today} />
          ))}
        </ul>
      )}
      {bootstrapped && filter === 'today' && groups.today.length === 0 && <EmptyState title={tr('act.empty_title')} text={tr('act.empty_hint')} />}

      {bootstrapped && filter === 'completed' && (
        <ul class="task-list">
          {groups.completed.slice(0, 50).map((t) => (
            <TaskCard key={t.id} task={t} today={today} showDate />
          ))}
        </ul>
      )}
      {bootstrapped && filter === 'completed' && !loadingDone && groups.completed.length === 0 && <p class="muted pad">{tr('act.completed_empty')}</p>}

      {bootstrapped && filter === 'all' && openCount === 0 && (
        <EmptyState title={tr('act.empty_title')} text={tr('act.empty_hint')}>
          <Button variant="primary" icon="mic" onClick={() => setState({ tab: 'ai' })}>
            {tr('ai.mic')}
          </Button>
        </EmptyState>
      )}

      {bootstrapped &&
        filter === 'all' &&
        sections.map(([key, label, showDate]) =>
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
      </div>

      <div class="act-add" ref={addRef}>
        <Button variant="primary" icon="plus" full onClick={() => setCreating(true)}>
          {tr('task.add_cta')}
        </Button>
      </div>

      <NewTaskSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
