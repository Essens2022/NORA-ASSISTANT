import { departureTime, describeRule, TASK_KINDS, toZoned, weekdayOf, type Lang, type Task } from '@nora/core';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.tsx';
import { statusLabel } from '../../components/TaskCard.tsx';
import { Button, Confirm, Input, Select, Sheet, TextArea } from '../../components/ui.tsx';
import { formatDate, formatInstant, formatTime, getLang, relativeDay, tr, type MessageKey } from '../../i18n/index.ts';
import { api } from '../../services/api.ts';
import { cancelTask, completeTask, createTask, deleteTask, reopenTask, snoozeTask, updateTask } from '../../state/actions.ts';
import { getState, setState, toast, useStore } from '../../state/store.ts';
import { todayLocal, userTz } from '../../utils/time.ts';

interface Detail {
  reminders: Array<{ id: string; kind: string; fire_at: string; status: string }>;
  events: Array<{ type: string; created_at: string }>;
}

type Mode = 'view' | 'edit' | 'reschedule' | 'snooze';

export function TaskDetailHost() {
  const { id, task } = useStore((s) => ({ id: s.openTaskId, task: s.openTaskId ? s.tasks[s.openTaskId] : null }));
  if (!id || !task) return null;
  return <TaskDetail key={id} task={task} />;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';

function repeatOf(rrule: string | null): Repeat {
  if (!rrule) return 'none';
  if (rrule === 'FREQ=DAILY') return 'daily';
  if (rrule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays';
  if (/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/.test(rrule)) return 'weekly';
  if (/^FREQ=MONTHLY;BYMONTHDAY=\d+$/.test(rrule)) return 'monthly';
  if (rrule === 'FREQ=YEARLY') return 'yearly';
  return 'custom';
}

function ruleFor(repeat: Repeat, date: string | null, current: string | null): string | null {
  const d = date ?? todayLocal();
  switch (repeat) {
    case 'none':
      return null;
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${DAY_CODES[weekdayOf(d)]}`;
    case 'monthly':
      return `FREQ=MONTHLY;BYMONTHDAY=${Number(d.slice(8, 10))}`;
    case 'yearly':
      return 'FREQ=YEARLY';
    default:
      return current;
  }
}

function repeatOptions(hasCustom: boolean) {
  const labels: Record<Lang, Record<Exclude<Repeat, 'custom'>, string>> = {
    en: { none: 'Never', daily: 'Every day', weekdays: 'Weekdays', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' },
    ro: { none: 'Niciodată', daily: 'Zilnic', weekdays: 'Zilele lucrătoare', weekly: 'Săptămânal', monthly: 'Lunar', yearly: 'Anual' },
    it: { none: 'Mai', daily: 'Ogni giorno', weekdays: 'Giorni feriali', weekly: 'Ogni settimana', monthly: 'Ogni mese', yearly: 'Ogni anno' },
    ru: { none: 'Никогда', daily: 'Каждый день', weekdays: 'По будням', weekly: 'Каждую неделю', monthly: 'Каждый месяц', yearly: 'Каждый год' },
  };
  const l = labels[getLang()];
  const opts: Array<{ value: Repeat; label: string }> = (['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const).map((v) => ({ value: v, label: l[v] }));
  if (hasCustom) opts.push({ value: 'custom', label: '…' });
  return opts;
}

const detailCache = new Map<string, Detail>();

function TaskDetail({ task }: { task: Task }) {
  const [mode, setMode] = useState<Mode>('view');
  const [detail, setDetailState] = useState<Detail | null>(detailCache.get(task.id) ?? null);
  const setDetail = (d: Detail) => {
    detailCache.set(task.id, d);
    setDetailState(d);
  };
  const [confirm, setConfirm] = useState<'delete' | 'cancel' | null>(null);
  const today = todayLocal();
  const close = () => setState({ openTaskId: null });
  const profile = useStore((s) => s.profile);

  useEffect(() => {
    let alive = true;
    api<Detail & { task: Task }>(`/v1/tasks/${task.id}`)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail({ reminders: [], events: [] }));
    return () => {
      alive = false;
    };
  }, [task.id, task.updated_at]);

  const open = !['completed', 'cancelled'].includes(task.status);
  const dep = profile ? departureTime(task, profile.prefs) : null;

  return (
    <Sheet open onClose={close} title={mode === 'edit' ? tr('task.edit') : mode === 'reschedule' ? tr('task.reschedule') : mode === 'snooze' ? tr('task.snooze') : task.title}>
      {mode === 'view' && (
        <div class="detail">
          <p class={`status-pill s-${task.status}`}>{statusLabel(task)}</p>
          <dl class="detail-list">
            <div>
              <dt>
                <Icon name="calendar" size={16} /> {tr('task.date')}
              </dt>
              <dd>{task.due_date ? `${relativeDay(task.due_date, today)} · ${formatDate(task.due_date)}` : tr('task.no_date')}</dd>
            </div>
            <div>
              <dt>
                <Icon name="clock" size={16} /> {tr('task.time')}
              </dt>
              <dd>{task.due_time ? formatTime(task.due_time) : task.time_window ? tr(`task.window.${task.time_window}` as MessageKey) : tr('task.any_time')}</dd>
            </div>
            {task.location && (
              <div>
                <dt>
                  <Icon name="pin" size={16} /> {tr('task.location')}
                </dt>
                <dd>{task.location}</dd>
              </div>
            )}
            {dep && (
              <div>
                <dt>
                  <Icon name="car" size={16} /> {tr('task.travel')}
                </dt>
                <dd>
                  {task.travel_min} min · {tr('task.leave_at', { time: formatTime(dep) })}
                </dd>
              </div>
            )}
            {task.recurrence && (
              <div>
                <dt>
                  <Icon name="repeat" size={16} /> {tr('task.recurrence')}
                </dt>
                <dd>{describeRule(task.recurrence, task.due_time, getLang(), task.due_date, profile?.prefs.hour12)}</dd>
              </div>
            )}
            <div>
              <dt>{tr('task.kind')}</dt>
              <dd>
                {tr(`kind.${task.kind}` as MessageKey)} · {tr(`priority.${task.priority}` as MessageKey)}
              </dd>
            </div>
            {task.notes && (
              <div>
                <dt>{tr('task.notes')}</dt>
                <dd class="pre">{task.notes}</dd>
              </div>
            )}
          </dl>

          <h3 class="sub">
            <Icon name="bell" size={16} /> {tr('task.reminders')}
          </h3>
          {detail === null ? (
            <p class="muted">…</p>
          ) : detail.reminders.length ? (
            <ul class="reminder-list">
              {detail.reminders.map((r) => (
                <li key={r.id} class={r.status === 'sent' ? 'sent' : ''}>
                  <span>{tr(`rem.${r.kind}` as MessageKey)}</span>
                  <span>
                    {formatInstant(r.fire_at, userTz())}
                    {r.status === 'sent' ? ` · ${tr('rem.sent')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="muted">{tr('task.no_reminders')}</p>
          )}
          {task.followup_count > 0 && <p class="muted small">{tr('task.followups', { n: task.followup_count })}</p>}

          <div class="detail-actions">
            {open ? (
              <>
                <Button
                  variant="primary"
                  icon="check"
                  onClick={() => {
                    void completeTask(task.id);
                    close();
                  }}
                >
                  {tr('task.complete')}
                </Button>
                <Button icon="calendar" onClick={() => setMode('reschedule')}>
                  {tr('task.reschedule')}
                </Button>
                {task.due_date && (
                  <Button icon="clock" onClick={() => setMode('snooze')}>
                    {tr('task.snooze')}
                  </Button>
                )}
                <Button icon="edit" onClick={() => setMode('edit')}>
                  {tr('task.edit')}
                </Button>
                <Button variant="ghost" icon="close" onClick={() => setConfirm('cancel')}>
                  {tr('task.cancel')}
                </Button>
              </>
            ) : (
              <Button variant="primary" icon="undo" onClick={() => void reopenTask(task.id)}>
                {tr('task.reopen')}
              </Button>
            )}
            <Button variant="danger" icon="trash" onClick={() => setConfirm('delete')}>
              {tr('task.delete')}
            </Button>
          </div>

          {detail && detail.events.length > 0 && (
            <details class="history">
              <summary>{tr('task.history')}</summary>
              <ul>
                {detail.events.map((e, i) => (
                  <li key={i}>
                    <span>{tr(`evt.${e.type}` as MessageKey)}</span>
                    <span class="muted">{formatInstant(e.created_at, userTz())}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {mode === 'edit' && <EditForm task={task} onDone={() => setMode('view')} />}
      {mode === 'reschedule' && <RescheduleForm task={task} onDone={() => setMode('view')} />}
      {mode === 'snooze' && <SnoozeForm task={task} onDone={() => setMode('view')} />}

      <Confirm
        open={confirm === 'delete'}
        title={tr('task.delete')}
        body={tr('task.delete_confirm')}
        confirm={tr('common.delete')}
        cancel={tr('common.cancel')}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void deleteTask(task.id);
        }}
      />
      <Confirm
        open={confirm === 'cancel'}
        title={tr('task.cancel')}
        body={tr('task.cancel_confirm')}
        confirm={tr('task.cancel')}
        cancel={tr('common.back')}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void cancelTask(task.id);
          close();
        }}
      />
    </Sheet>
  );
}

function RescheduleForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const [date, setDate] = useState(task.due_date ?? todayLocal());
  const [time, setTime] = useState(task.due_time ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <form
      class="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await updateTask(task.id, { date: date || null, time: time || null });
        setBusy(false);
        if (ok) onDone();
      }}
    >
      <Input label={tr('task.date')} type="date" value={date} onValue={setDate} />
      <Input label={tr('task.time')} type="time" value={time} onValue={setTime} hint={tr('task.any_time')} />
      <div class="actions-row">
        <Button onClick={onDone}>{tr('common.back')}</Button>
        <Button variant="primary" type="submit" busy={busy}>
          {tr('common.save')}
        </Button>
      </div>
    </form>
  );
}

function SnoozeForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const [time, setTime] = useState('');
  const presets: Array<[string, MessageKey]> = [
    ['10m', 'snooze.10m'],
    ['30m', 'snooze.30m'],
    ['1h', 'snooze.1h'],
    ['tonight', 'snooze.tonight'],
    ['tomorrow', 'snooze.tomorrow'],
  ];
  const done = (until: string | null) => {
    if (until) {
      const z = toZoned(until, userTz());
      toast(tr('snooze.done', { when: `${relativeDay(z.date, todayLocal()).toLowerCase()} ${formatTime(z.time)}` }));
    }
    onDone();
  };
  return (
    <div class="form">
      {!custom ? (
        <div class="chips">
          {presets.map(([p, key]) => (
            <button type="button" class="chip" key={p} onClick={async () => done(await snoozeTask(task.id, p))}>
              {tr(key)}
            </button>
          ))}
          <button type="button" class="chip" onClick={() => setCustom(true)}>
            {tr('snooze.custom')}
          </button>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!time) return;
            const [y, m, d] = date.split('-').map(Number);
            const [hh, mm] = time.split(':').map(Number);
            // local wall time in the user's timezone → ISO
            const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
            const z = toZoned(guess, userTz());
            const offsetMin = (Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute) - guess.getTime()) / 60000;
            done(await snoozeTask(task.id, new Date(guess.getTime() - offsetMin * 60000).toISOString()));
          }}
        >
          <Input label={tr('task.date')} type="date" value={date} onValue={setDate} min={todayLocal()} />
          <Input label={tr('task.time')} type="time" value={time} onValue={setTime} required />
          <div class="actions-row">
            <Button onClick={() => setCustom(false)}>{tr('common.back')}</Button>
            <Button variant="primary" type="submit" disabled={!time}>
              {tr('common.save')}
            </Button>
          </div>
        </form>
      )}
      {!custom && (
        <div class="actions-row">
          <Button onClick={onDone}>{tr('common.back')}</Button>
        </div>
      )}
    </div>
  );
}

function TaskFields(props: {
  v: Record<string, string>;
  set: (k: string, val: string) => void;
  hasCustomRule: boolean;
}) {
  const { v, set } = props;
  return (
    <>
      <Input label={tr('task.title')} value={v.title} onValue={(x) => set('title', x)} required maxLength={120} />
      <div class="grid2">
        <Input label={tr('task.date')} type="date" value={v.date} onValue={(x) => set('date', x)} />
        <Input label={tr('task.time')} type="time" value={v.time} onValue={(x) => set('time', x)} />
      </div>
      {!v.time && v.date && (
        <Select
          label={tr('task.any_time')}
          value={v.window || 'anytime'}
          options={(['anytime', 'morning', 'afternoon', 'evening'] as const).map((w) => ({ value: w, label: tr(`task.window.${w}` as MessageKey) }))}
          onChange={(x) => set('window', x)}
        />
      )}
      <div class="grid2">
        <Select label={tr('task.kind')} value={v.kind} options={TASK_KINDS.map((k) => ({ value: k, label: tr(`kind.${k}` as MessageKey) }))} onChange={(x) => set('kind', x)} />
        <Select label={tr('task.priority')} value={v.priority} options={(['low', 'normal', 'high'] as const).map((p) => ({ value: p, label: tr(`priority.${p}` as MessageKey) }))} onChange={(x) => set('priority', x)} />
      </div>
      <Select label={tr('task.recurrence')} value={v.repeat as Repeat} options={repeatOptions(props.hasCustomRule)} onChange={(x) => set('repeat', x)} />
      <Input label={tr('task.location')} value={v.location} onValue={(x) => set('location', x)} maxLength={200} />
      {(v.kind === 'appointment' || v.kind === 'travel') && v.time && (
        <Input label={tr('task.travel')} type="number" inputMode="numeric" min={0} max={1440} value={v.travel} onValue={(x) => set('travel', x)} />
      )}
      <TextArea label={tr('task.notes')} value={v.notes} onValue={(x) => set('notes', x)} />
    </>
  );
}

function fieldsToPayload(v: Record<string, string>, current: string | null) {
  return {
    title: v.title.trim(),
    date: v.date || null,
    time: v.time || null,
    time_window: v.time || !v.date || v.window === 'anytime' || !v.window ? null : v.window,
    kind: v.kind,
    priority: v.priority,
    location: v.location.trim() || null,
    notes: v.notes.trim() || null,
    travel_min: v.travel ? Number(v.travel) : null,
    recurrence: ruleFor(v.repeat as Repeat, v.date || null, current),
  };
}

function EditForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const [v, setV] = useState<Record<string, string>>({
    title: task.title,
    date: task.due_date ?? '',
    time: task.due_time ?? '',
    window: task.time_window ?? '',
    kind: task.kind,
    priority: task.priority,
    location: task.location ?? '',
    notes: task.notes ?? '',
    travel: task.travel_min ? String(task.travel_min) : '',
    repeat: repeatOf(task.recurrence),
  });
  const [busy, setBusy] = useState(false);
  return (
    <form
      class="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.title.trim()) return;
        setBusy(true);
        const ok = await updateTask(task.id, fieldsToPayload(v, task.recurrence));
        setBusy(false);
        if (ok) onDone();
      }}
    >
      <TaskFields v={v} set={(k, val) => setV((o) => ({ ...o, [k]: val }))} hasCustomRule={repeatOf(task.recurrence) === 'custom'} />
      <div class="actions-row">
        <Button onClick={onDone}>{tr('common.back')}</Button>
        <Button variant="primary" type="submit" busy={busy} disabled={!v.title.trim()}>
          {tr('common.save')}
        </Button>
      </div>
    </form>
  );
}

export function NewTaskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const empty = { title: '', date: '', time: '', window: '', kind: 'generic', priority: 'normal', location: '', notes: '', travel: '', repeat: 'none' };
  const [v, setV] = useState<Record<string, string>>(empty);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onClose={() => {
        setV(empty);
        onClose();
      }}
      title={tr('task.new')}
    >
      <form
        class="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!v.title.trim()) return;
          setBusy(true);
          const task = await createTask(fieldsToPayload(v, null));
          setBusy(false);
          if (task) {
            setV(empty);
            onClose();
            if (getState().tab === 'activity') toast(tr('common.saved'));
          }
        }}
      >
        <TaskFields v={v} set={(k, val) => setV((o) => ({ ...o, [k]: val }))} hasCustomRule={false} />
        <div class="actions-row">
          <Button onClick={onClose}>{tr('common.cancel')}</Button>
          <Button variant="primary" type="submit" busy={busy} disabled={!v.title.trim()}>
            {tr('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
