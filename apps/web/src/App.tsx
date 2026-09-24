import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { Nav, Toasts } from './components/Nav.tsx';
import { AIScreen } from './features/ai/AIScreen.tsx';
import { ActivityScreen } from './features/activity/ActivityScreen.tsx';
import { SignIn } from './features/auth/SignIn.tsx';
import { Onboarding } from './features/onboarding/Onboarding.tsx';
import { TaskDetailHost } from './features/task/TaskDetail.tsx';
import { tr } from './i18n/index.ts';
import { useStore } from './state/store.ts';

// Profile is not needed for first paint – load it on demand.
function useLazy<P>(loader: () => Promise<ComponentType<P>>, when: boolean): ComponentType<P> | null {
  const [C, setC] = useState<ComponentType<P> | null>(null);
  useEffect(() => {
    if (when && !C) void loader().then((c) => setC(() => c));
  }, [when]);
  return C;
}

export function App() {
  const { authReady, userId, bootstrapped, onboardedAt, profile, tab, online, handoff } = useStore((s) => ({
    authReady: s.authReady,
    userId: s.userId,
    bootstrapped: s.bootstrapped,
    onboardedAt: s.onboardedAt,
    profile: s.profile,
    tab: s.tab,
    online: s.online,
    handoff: s.handoff,
  }));
  const Profile = useLazy(() => import('./features/profile/ProfileScreen.tsx').then((m) => m.ProfileScreen), tab === 'profile');

  if (handoff) return <Handoff state={handoff} />;
  if (!authReady) return <Splash />;
  if (!userId) return <SignIn />;
  if (!bootstrapped && !profile) return <Splash />;
  if (profile && !onboardedAt) return <Onboarding />;

  return (
    <div class="app">
      <a class="skip" href="#main">
        {tr('nav.ai')}
      </a>
      {!online && (
        <div class="offline-bar" role="status">
          {tr('common.offline')}
        </div>
      )}
      <main id="main" class="main">
        {tab === 'ai' && <AIScreen />}
        {tab === 'activity' && <ActivityScreen />}
        {tab === 'profile' && (Profile ? <Profile /> : <div class="screen" />)}
      </main>
      <Nav />
      <TaskDetailHost />
      <Toasts />
    </div>
  );
}

function Splash() {
  return (
    <div class="splash" aria-busy="true">
      <div class="splash-mark" />
    </div>
  );
}

/** Shown in the in-app browser after Google sign-in from the installed app. */
function Handoff({ state }: { state: 'working' | 'handed' | 'failed' }) {
  return (
    <div class="auth handoff" role="status" aria-live="polite">
      <h1 class="brand big">NORA</h1>
      {state === 'working' && <p class="muted">{tr('auth.handoff_working')}</p>}
      {state === 'handed' && (
        <div class="auth-card">
          <div class="handoff-check" aria-hidden="true">✓</div>
          <h2>{tr('auth.handoff_done_title')}</h2>
          <p class="muted">{tr('auth.handoff_done_body')}</p>
        </div>
      )}
      {state === 'failed' && (
        <div class="auth-card">
          <h2>{tr('auth.oauth_failed')}</h2>
          <p class="muted">{tr('auth.handoff_failed_body')}</p>
        </div>
      )}
    </div>
  );
}
