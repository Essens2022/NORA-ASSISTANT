import { tr } from '../i18n/index.ts';
import { setState, useStore, type Tab } from '../state/store.ts';
import { Icon } from './Icon.tsx';
import { NoraKitIcon } from './NoraKitIcon.tsx';

const TABS: Array<{ id: Tab; icon: string; key: 'nav.ai' | 'nav.activity' | 'nav.calendar' | 'nav.memory' | 'nav.profile' }> = [
  { id: 'ai', icon: 'home', key: 'nav.ai' },
  { id: 'calendar', icon: 'calendar', key: 'nav.calendar' },
  { id: 'activity', icon: 'activity', key: 'nav.activity' },
  { id: 'memory', icon: 'memory', key: 'nav.memory' },
  { id: 'profile', icon: 'profile', key: 'nav.profile' },
];

export function Nav() {
  const { tab, attention } = useStore((s) => ({
    tab: s.tab,
    attention: Object.values(s.tasks).filter((t) => t.status === 'needs_clarification' || t.status === 'missed').length,
  }));
  return (
    <nav class="nav" aria-label={tr('nav.label')}>
      {TABS.map((t) => (
        <button
          type="button"
          key={t.id}
          class={`nav-item${tab === t.id ? ' active' : ''}`}
          aria-current={tab === t.id ? 'page' : undefined}
          onClick={() => {
            setState({ tab: t.id });
            // Activity/Profile share the page's scroll position – switching tabs
            // must never land mid-page with the header hidden.
            scrollTo(0, 0);
            try {
              history.replaceState(null, '', t.id === 'ai' ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}${t.id}`);
            } catch {
              /* ignore */
            }
          }}
        >
          <span class="nav-pill">
            <span class="nav-icon">
              <NoraKitIcon path={`${tab === t.id ? 'icons-active' : 'icons'}/${t.icon}.svg`} size={24} />
              {t.id === 'activity' && attention > 0 && (
                <span class="badge" aria-label={`${attention}`}>
                  {attention}
                </span>
              )}
            </span>
            <span>{tr(t.key)}</span>
          </span>
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
