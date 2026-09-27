// "What NORA remembers about you" – preferences learned from conversation
// (kind 'preference') and facts explicitly asked to remember (kind 'fact'),
// both already stored server-side via the assistant's `remember` action.
import type { MemoryItem } from '@nora/core';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.tsx';
import { Button, Confirm, EmptyState, Input } from '../../components/ui.tsx';
import { relativeFromNow, tr } from '../../i18n/index.ts';
import { api } from '../../services/api.ts';
import { toastError } from '../../state/store.ts';

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

export function MemoryScreen() {
  const [items, setItemsState] = useState<MemoryItem[] | null>(memoryCache);
  const [query, setQuery] = useState('');
  const setItems = (v: MemoryItem[]) => {
    memoryCache = v;
    setItemsState(v);
  };
  const load = () =>
    api<{ items: MemoryItem[] }>('/v1/memory')
      .then((r) => setItems(Array.isArray(r.items) ? r.items : []))
      .catch(() => setItems(memoryCache ?? []));
  useEffect(() => void load(), []);

  const filtered = (items ?? []).filter((m) => m.value.toLowerCase().includes(query.trim().toLowerCase()));
  const preferences = filtered.filter((m) => m.kind === 'preference');
  const facts = filtered.filter((m) => m.kind === 'fact');

  return (
    <div class="screen memory-screen">
      <header class="screen-head">
        <h1>{tr('mem.title')}</h1>
      </header>
      <p class="hint mem-hint">{tr('mem.hint')}</p>

      {items === null ? (
        <div class="skeleton-list" aria-busy="true" aria-label={tr('common.loading')}>
          <div class="skeleton skeleton-row" />
          <div class="skeleton skeleton-row" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={tr('mem.empty_title')} text={tr('mem.empty_hint')} />
      ) : (
        <>
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

          <MemoryGroup title={tr('mem.preferences')} items={preferences} onChanged={load} />
          <MemoryGroup title={tr('mem.facts')} items={facts} onChanged={load} />

          {filtered.length === 0 && query && <p class="muted pad">{tr('mem.no_match')}</p>}

          <DeleteAll disabled={items.length === 0} onDone={load} />
        </>
      )}
    </div>
  );
}

function MemoryGroup({ title, items, onChanged }: { title: string; items: MemoryItem[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  if (!items.length) return null;
  return (
    <section class="group">
      <h2 class="group-title">
        {title} <span class="count">{items.length}</span>
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
                    <Icon name="edit" size={16} />
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
                    <Icon name="trash" size={16} />
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
