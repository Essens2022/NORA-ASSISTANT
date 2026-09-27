import { addDays, weekdayOf, type Task } from '@nora/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.tsx';
import { TaskCard } from '../../components/TaskCard.tsx';
import { Button, EmptyState } from '../../components/ui.tsx';
import { getLocale, tr } from '../../i18n/index.ts';
import { getState, setState, useStore } from '../../state/store.ts';
import { todayLocal } from '../../utils/time.ts';
import { NewTaskSheet } from '../task/TaskDetail.tsx';

const order = (a: Task, b: Task) => `${a.due_time ?? '99'}${a.created_at}`.localeCompare(`${b.due_time ?? '99'}${b.created_at}`);

function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
function shiftMonth(monthStart: string, delta: number): string {
  const [y, m] = monthStart.slice(0, 7).split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}
function daysInMonth(monthStart: string): number {
  const [y, m] = monthStart.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
// Monday-first offset: weekdayOf() returns 0=Sun..6=Sat.
const mondayFirst = (d: string) => (weekdayOf(d) + 6) % 7;

const WEEK_REF = Date.UTC(2024, 0, 1); // a Monday, purely to read locale weekday names off
function weekdayLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(WEEK_REF + i * 86_400_000)).replace('.', ''));
}
function monthTitle(monthStart: string, locale: string): string {
  const s = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${monthStart}T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function dayTitle(date: string, locale: string): string {
  const s = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function CalendarScreen() {
  const tasks = useStore((s) => s.tasks);
  const today = todayLocal();
  const focusDate = getState().calendarFocusDate;
  const [month, setMonth] = useState(() => monthOf(focusDate ?? today));
  const [selected, setSelected] = useState(focusDate ?? today);
  const [creating, setCreating] = useState(false);
  const locale = getLocale();

  useEffect(() => {
    if (focusDate) setState({ calendarFocusDate: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byDate = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of Object.values(tasks)) {
      if (!t.due_date || t.status === 'cancelled') continue;
      (m[t.due_date] ??= []).push(t);
    }
    return m;
  }, [tasks]);

  const dayTasks = (byDate[selected] ?? []).slice().sort(order);
  const total = daysInMonth(month);
  const offset = mondayFirst(month);
  const cells: Array<string | null> = [...Array(offset).fill(null), ...Array.from({ length: total }, (_, i) => addDays(month, i))];

  return (
    <div class="screen calendar-screen">
      <header class="screen-head">
        <h1>{tr('cal.title')}</h1>
        <Button small icon="plus" onClick={() => setCreating(true)}>
          {tr('task.new')}
        </Button>
      </header>

      <div class="cal-card">
        <div class="cal-nav">
          <button type="button" class="icon-btn" aria-label={tr('cal.prev_month')} onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <Icon name="back" size={18} />
          </button>
          <span class="cal-month">{monthTitle(month, locale)}</span>
          <button type="button" class="icon-btn" aria-label={tr('cal.next_month')} onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            <Icon name="chevron" size={18} />
          </button>
        </div>

        <div class="cal-weekdays">
          {weekdayLabels(locale).map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div class="cal-grid">
          {cells.map((d, i) =>
            d ? (
              <button
                type="button"
                key={d}
                class={`cal-day${d === selected ? ' selected' : ''}${d === today ? ' today' : ''}${byDate[d]?.length ? ' has-tasks' : ''}`}
                onClick={() => setSelected(d)}
              >
                {Number(d.slice(8, 10))}
              </button>
            ) : (
              <span key={`gap-${i}`} class="cal-day empty" aria-hidden="true" />
            ),
          )}
        </div>
      </div>

      <section class="group">
        <h2 class="group-title">
          {selected === today ? tr('cal.today') : dayTitle(selected, locale)} <span class="count">{dayTasks.length}</span>
        </h2>
        {dayTasks.length ? (
          <ul class="task-list">
            {dayTasks.map((t) => (
              <TaskCard key={t.id} task={t} today={today} />
            ))}
          </ul>
        ) : (
          <EmptyState title={tr('cal.empty_title')} text={tr('cal.empty_hint')} />
        )}
      </section>

      <NewTaskSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
