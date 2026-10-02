import { addDays, weekdayOf, type Task } from '@nora/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.tsx';
import { TaskCard } from '../../components/TaskCard.tsx';
import { EmptyState } from '../../components/ui.tsx';
import { useStickyHeadHeight } from '../../hooks.ts';
import { getLocale, tr } from '../../i18n/index.ts';
import { setState, useStore } from '../../state/store.ts';
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

const HOURS = Array.from({ length: 24 }, (_, i) => i);
function hourOf(time: string): number {
  return Number(time.slice(0, 2));
}
function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

export function CalendarScreen() {
  const tasks = useStore((s) => s.tasks);
  const focusDate = useStore((s) => s.calendarFocusDate);
  const today = todayLocal();
  const [month, setMonth] = useState(() => monthOf(focusDate ?? today));
  const [selected, setSelected] = useState(focusDate ?? today);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'timeline'>('list');
  const [mode, setMode] = useState<'day' | 'week' | 'month'>('day');
  const locale = getLocale();

  // the screen now stays mounted across tab switches (see App.tsx), so "jump to this
  // date" (from confirming a new task) has to be picked up reactively, not just once on mount
  useEffect(() => {
    if (!focusDate) return;
    setMonth(monthOf(focusDate));
    setSelected(focusDate);
    setState({ calendarFocusDate: null });
  }, [focusDate]);

  const byDate = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of Object.values(tasks)) {
      if (!t.due_date || t.status === 'cancelled') continue;
      (m[t.due_date] ??= []).push(t);
    }
    return m;
  }, [tasks]);

  const dayTasks = (byDate[selected] ?? []).slice().sort(order);
  const timedTasks = dayTasks.filter((t) => t.due_time);
  const untimedTasks = dayTasks.filter((t) => !t.due_time);
  const byHour = useMemo(() => {
    const m: Record<number, Task[]> = {};
    for (const t of timedTasks) (m[hourOf(t.due_time!)] ??= []).push(t);
    return m;
  }, [dayTasks]);
  const nowHour = selected === today ? new Date().getHours() : -1;
  const total = daysInMonth(month);
  const offset = mondayFirst(month);
  const cells: Array<string | null> = [...Array(offset).fill(null), ...Array.from({ length: total }, (_, i) => addDays(month, i))];

  // the day/week strip shown above the agenda - Monday-first, same convention as the month grid
  const stripStart = addDays(selected, -mondayFirst(selected));
  const stripDays = Array.from({ length: 7 }, (_, i) => addDays(stripStart, i));
  const stripLabels = weekdayLabels(locale);
  const weekTasks = useMemo(() => stripDays.map((d) => ({ date: d, tasks: (byDate[d] ?? []).slice().sort(order) })), [byDate, stripStart]);
  const [headRef, headH] = useStickyHeadHeight();

  return (
    <div class="screen calendar-screen">
      <div class="screen-sticky-head" ref={headRef}>
        <header class="screen-head">
          <h1>{tr('cal.title')}</h1>
        </header>

        <div class="chips cal-mode" role="group" aria-label={tr('cal.view')}>
          {(['day', 'week', 'month'] as const).map((m) => (
            <button type="button" key={m} class={`chip${mode === m ? ' selected' : ''}`} onClick={() => setMode(m)}>
              {tr(m === 'day' ? 'cal.mode_day' : m === 'week' ? 'cal.mode_week' : 'cal.mode_month')}
            </button>
          ))}
        </div>

        {mode !== 'month' && (
          <div class="cal-strip" role="group" aria-label={tr('cal.view')}>
            {stripDays.map((d, i) => (
              <button
                type="button"
                key={d}
                class={`cal-strip-day${d === selected ? ' selected' : ''}${d === today ? ' today' : ''}${byDate[d]?.length ? ' has-tasks' : ''}`}
                onClick={() => setSelected(d)}
              >
                <span class="cal-strip-label">{stripLabels[i]}</span>
                <span class="cal-strip-num">{Number(d.slice(8, 10))}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ paddingTop: headH }}>

      {mode === 'month' && (
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
      )}

      {mode === 'week' ? (
        <section class="group cal-week-agenda">
          {weekTasks.map(({ date, tasks: dt }) =>
            dt.length ? (
              <div key={date}>
                <h2 class="group-title">{date === today ? tr('cal.today') : dayTitle(date, locale)}</h2>
                <ul class="task-list">
                  {dt.map((t) => (
                    <TaskCard key={t.id} task={t} today={today} />
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          {weekTasks.every(({ tasks: dt }) => dt.length === 0) && <EmptyState title={tr('cal.empty_title')} text={tr('cal.empty_hint')} />}
        </section>
      ) : (
        <section class="group">
          <div class="cal-day-head">
            <h2 class="group-title">
              {selected === today ? tr('cal.today') : dayTitle(selected, locale)} <span class="count">{dayTasks.length}</span>
            </h2>
            {dayTasks.length > 0 && (
              <div class="cal-view-toggle" role="group" aria-label={tr('cal.view')}>
                <button type="button" class={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')} aria-label={tr('cal.view_list')}>
                  <Icon name="list" size={16} />
                </button>
                <button type="button" class={view === 'timeline' ? 'active' : ''} aria-pressed={view === 'timeline'} onClick={() => setView('timeline')} aria-label={tr('cal.view_timeline')}>
                  <Icon name="clock" size={16} />
                </button>
              </div>
            )}
          </div>

          {dayTasks.length === 0 && <EmptyState title={tr('cal.empty_title')} text={tr('cal.empty_hint')} />}

          {dayTasks.length > 0 && view === 'list' && (
            <ul class="task-list">
              {dayTasks.map((t) => (
                <TaskCard key={t.id} task={t} today={today} />
              ))}
            </ul>
          )}

          {dayTasks.length > 0 && view === 'timeline' && (
            <>
              {untimedTasks.length > 0 && (
                <>
                  <p class="cal-timeline-anytime-label">{tr('task.any_time')}</p>
                  <ul class="task-list">
                    {untimedTasks.map((t) => (
                      <TaskCard key={t.id} task={t} today={today} />
                    ))}
                  </ul>
                </>
              )}
              <div class="cal-timeline">
                {HOURS.map((h) => (
                  <div key={h} class={`cal-timeline-hour${h === nowHour ? ' now' : ''}${!byHour[h] ? ' empty' : ''}`}>
                    <span class="cal-timeline-time">{hourLabel(h)}</span>
                    <div class="cal-timeline-tasks">
                      {(byHour[h] ?? []).map((t) => (
                        <button type="button" key={t.id} class="cal-timeline-task" onClick={() => setState({ openTaskId: t.id })}>
                          {t.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <button type="button" class="cal-fab" aria-label={tr('cal.add')} onClick={() => setCreating(true)}>
        <Icon name="plus" size={22} />
      </button>
      </div>

      <NewTaskSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
