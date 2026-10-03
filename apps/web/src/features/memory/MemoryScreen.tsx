// "What NORA remembers about you" – durable preferences and facts learned
// from conversation, plus ideas/notes/moments the user asks to keep, all
// already stored server-side via the assistant's `remember` action (or added
// here directly with the + button).
import type { IconName } from '../../components/Icon.tsx';
import type { MemoryItem, MemoryKind } from '@nora/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.tsx';
import { Button, Confirm, EmptyState, IconButton, Input, Sheet } from '../../components/ui.tsx';
import { useStickyHeadHeight } from '../../hooks.ts';
import { relativeFromNow, tr, type MessageKey } from '../../i18n/index.ts';
import { api } from '../../services/api.ts';
import { toast, toastError } from '../../state/store.ts';

// kept between visits and prefetched after start-up, so the list shows instantly
let memoryCache: MemoryItem[] | null = null;
export function prefetchMemory() {
  return api<{ items: MemoryItem[] }>('/v1/memory')
    .then((r) => (memoryCache = Array.isArray(r.items) ? r.items : []))
    .catch(() => memoryCache);
}
/** Sign-out (or switching accounts without a reload) must not leak the previous user's memory. */
export function clearMemoryCache() {
  memoryCache = null;
}

// display order: what the user actively captures first, what NORA inferred after
const CATEGORIES: Array<{ kind: MemoryKind; label: MessageKey; icon: IconName; color: string }> = [
  { kind: 'idea', label: 'mem.ideas', icon: 'spark', color: 'kind-warning' },
  { kind: 'note', label: 'mem.notes', icon: 'file', color: 'kind-blue' },
  { kind: 'moment', label: 'mem.moments', icon: 'pin', color: 'kind-pink' },
  { kind: 'preference', label: 'mem.preferences', icon: 'repeat', color: 'kind-success' },
  { kind: 'fact', label: 'mem.facts', icon: 'bookmark', color: 'kind-purple' },
];
// only these are offered when adding a memory by hand - preference/fact are
// settings-like values NORA derives from conversation, not something to type in directly
const ADDABLE_KINDS: MemoryKind[] = ['idea', 'note', 'moment'];

export function MemoryScreen() {
  const [items, setItemsState] = useState<MemoryItem[] | null>(memoryCache);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MemoryKind | null>(null);
  const [adding, setAdding] = useState(false);
  const setItems = (v: MemoryItem[]) => {
    memoryCache = v;
    setItemsState(v);
  };
  const load = () =>
    api<{ items: MemoryItem[] }>('/v1/memory')
      .then((r) => setItems(Array.isArray(r.items) ? r.items : []))
      .catch(() => setItems(memoryCache ?? []));
  useEffect(() => void load(), []);

  const filtered = (items ?? []).filter((m) => m.value.toLowerCase().includes(query.trim().toLowerCase()) && (!filter || m.kind === filter));
  const present = useMemo(() => new Set((items ?? []).map((m) => m.kind)), [items]);
  // This screen never unmounts (every tab stays mounted, just hidden - see
  // App.tsx), so a filter chip tapped earlier stays selected even after its
  // category's last item is deleted (or edited to a different kind). Once
  // present.size drops to 1, the chip row itself stops rendering (nothing
  // left to choose between) - leaving that stale filter neither visible nor
  // reachable to clear, silently hiding every item with no explanation (no
  // "no match" message either, since that only shows when query/filter are
  // truthy from the user's own current action). Clear it the moment it no
  // longer corresponds to a real, currently-chosen-worthy category.
  useEffect(() => {
    if (filter && !present.has(filter)) setFilter(null);
  }, [filter, present]);
  const [headRef, headH] = useStickyHeadHeight();

  return (
    <div class="screen memory-screen">
      <div class="screen-sticky-head" ref={headRef}>
        <header class="screen-head">
          <h1>{tr('mem.title')}</h1>
          <IconButton icon="plus" label={tr('mem.add')} onClick={() => setAdding(true)} />
        </header>

        {items !== null && items.length > 0 && (
          <>
            <div class="mem-search-wrap">
              <Icon name="search" size={18} class="mem-search-icon" />
              <label class="sr-only" for="mem-search">
                {tr('mem.search')}
              </label>
              <input
                id="mem-search"
                class="input mem-search"
                value={query}
                maxLength={80}
                placeholder={tr('mem.search')}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              />
            </div>

            {present.size > 1 && (
              <div class="chips mem-filter" role="group" aria-label={tr('mem.title')}>
                <button type="button" class={`chip${filter === null ? ' selected' : ''}`} onClick={() => setFilter(null)}>
                  {tr('mem.all')}
                </button>
                {CATEGORIES.filter((c) => present.has(c.kind)).map((c) => (
                  <button type="button" key={c.kind} class={`chip${filter === c.kind ? ' selected' : ''}`} onClick={() => setFilter(c.kind)}>
                    {tr(c.label)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ paddingTop: headH }}>
      {items === null ? (
        <div class="skeleton-list" aria-busy="true" aria-label={tr('common.loading')}>
          <div class="skeleton skeleton-row" />
          <div class="skeleton skeleton-row" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={tr('mem.empty_title')} text={tr('mem.empty_hint')}>
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            {tr('mem.add')}
          </Button>
        </EmptyState>
      ) : (
        <>
          {CATEGORIES.filter((c) => !filter || filter === c.kind).map((c) => (
            <MemoryGroup key={c.kind} category={c} items={filtered.filter((m) => m.kind === c.kind)} onChanged={load} />
          ))}

          {filtered.length === 0 && (query || filter) && <p class="muted pad">{tr('mem.no_match')}</p>}

          <DeleteAll disabled={items.length === 0} onDone={load} />
        </>
      )}
      </div>

      <AddMemorySheet open={adding} onClose={() => setAdding(false)} onAdded={load} />
    </div>
  );
}

function AddMemorySheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<MemoryKind>('note');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setValue('');
    setKind('note');
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={tr('mem.add_title')}
    >
      <form
        class="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = value.trim();
          if (!v) return;
          setBusy(true);
          try {
            const key = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            await api('/v1/memory', { method: 'POST', body: { key, value: v.slice(0, 300), kind } });
            toast(tr('common.saved'));
            reset();
            onClose();
            onAdded();
          } catch {
            toastError(tr('err.save_failed'));
          }
          setBusy(false);
        }}
      >
        <Input label={tr('mem.item')} value={value} onValue={setValue} maxLength={300} placeholder={tr('mem.add_placeholder')} />
        <div>
          <p class="chip-row-label">{tr('mem.add_kind')}</p>
          <div class="chips" role="group" aria-label={tr('mem.add_kind')}>
            {ADDABLE_KINDS.map((k) => (
              <button type="button" key={k} class={`chip${kind === k ? ' selected' : ''}`} onClick={() => setKind(k)}>
                {tr(CATEGORIES.find((c) => c.kind === k)!.label)}
              </button>
            ))}
          </div>
        </div>
        <div class="actions-row">
          <Button onClick={onClose}>{tr('common.cancel')}</Button>
          <Button variant="primary" type="submit" busy={busy} disabled={!value.trim()}>
            {tr('mem.add')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function MemoryGroup({
  category,
  items,
  onChanged,
}: {
  category: { kind: MemoryKind; label: MessageKey; icon: IconName; color: string };
  items: MemoryItem[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  if (!items.length) return null;
  return (
    <section class="group">
      <h2 class="group-title">
        {tr(category.label)} <span class="count">{items.length}</span>
      </h2>
      <ul class="memory-list">
        {items.map((m) => (
          <li key={m.id}>
            {editing === m.id ? (
              <form
                class="memory-edit"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api(`/v1/memory/${m.id}`, { method: 'PATCH', body: { value } });
                    setEditing(null);
                    onChanged();
                  } catch {
                    toastError(tr('err.save_failed'));
                  }
                }}
              >
                <Input label={tr('mem.item')} value={value} onValue={setValue} maxLength={300} />
                <div class="actions-row">
                  <Button small onClick={() => setEditing(null)}>
                    {tr('common.cancel')}
                  </Button>
                  <Button small variant="primary" type="submit">
                    {tr('common.save')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <span class={`kind-badge square ${category.color}`} aria-hidden="true">
                  <Icon name={category.icon} size={17} />
                </span>
                <span class="memory-body">
                  <span class="memory-text">{m.value}</span>
                  {relativeFromNow(m.created_at) && <span class="memory-meta">{relativeFromNow(m.created_at)}</span>}
                </span>
                <span class="memory-actions">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`${tr('common.edit')}: ${m.value}`}
                    onClick={() => {
                      setEditing(m.id);
                      setValue(m.value);
                    }}
                  >
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`${tr('common.delete')}: ${m.value}`}
                    onClick={async () => {
                      await api(`/v1/memory/${m.id}`, { method: 'DELETE' }).catch(() => toastError(tr('err.save_failed')));
                      onChanged();
                    }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeleteAll({ disabled, onDone }: { disabled: boolean; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (disabled) return null;
  return (
    <>
      <Button small variant="danger" icon="trash" onClick={() => setConfirm(true)}>
        {tr('prof.memory_delete_all')}
      </Button>
      <Confirm
        open={confirm}
        title={tr('prof.memory_delete_all')}
        body={tr('prof.memory_delete_all_confirm')}
        confirm={tr('common.delete')}
        cancel={tr('common.cancel')}
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          await api('/v1/memory', { method: 'DELETE' }).catch(() => toastError(tr('err.save_failed')));
          onDone();
        }}
      />
    </>
  );
}
