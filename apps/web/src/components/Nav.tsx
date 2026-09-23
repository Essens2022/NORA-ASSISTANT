import { tr } from '../i18n/index.ts';
import { setState, useStore, type Tab } from '../state/store.ts';
import { Icon, type IconName } from './Icon.tsx';

const TABS: Array<{ id: Tab; icon: IconName; key: 'nav.ai' | 'nav.activity' | 'nav.profile' }> = [
  { id: 'ai', icon: 'spark', key: 'nav.ai' },
  { id: 'activity', icon: 'list', key: 'nav.activity' },
  { id: 'profile', icon: 'user', key: 'nav.profile' },
];

export function Nav() {
  const { tab, attention } = useStore((s) => ({
    tab: s.tab,
    attention: Object.values(s.tasks).filter((t) => t.status === 'needs_clarification' || t.status === 'missed').length,
  }));
  return (
    <nav class="nav" aria-label="Main">
      {TABS.map((t) => (
        <button
          type="button"
          key={t.id}
          class={`nav-item${tab === t.id ? ' active' : ''}`}
          aria-current={tab === t.id ? 'page' : undefined}
          onClick={() => {
            setState({ tab: t.id });
            try {
              history.replaceState(null, '', t.id === 'ai' ? '/' : `/${t.id}`);
            } catch {
              /* ignore */
            }
          }}
        >
          <span class="nav-icon">
            <Icon name={t.icon} size={22} />
            {t.id === 'activity' && attention > 0 && (
              <span class="badge" aria-label={`${attention}`}>
                {attention}
              </span>
            )}
          </span>
          <span>{tr(t.key)}</span>
        </button>
      ))}
    </nav>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div class={`toast ${t.kind}`} key={t.id}>
          <span class="toast-icon" aria-hidden="true">
            <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'info' ? 'bell' : 'check'} size={18} />
          </span>
          <span>{t.text}</span>
          {t.action && (
            <button type="button" class="toast-action" onClick={t.action.run}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
