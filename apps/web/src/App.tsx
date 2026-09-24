import { Nav, Toasts } from './components/Nav.tsx';
import { AIScreen } from './features/ai/AIScreen.tsx';
import { ActivityScreen } from './features/activity/ActivityScreen.tsx';
import { SignIn } from './features/auth/SignIn.tsx';
import { Onboarding } from './features/onboarding/Onboarding.tsx';
import { ProfileScreen } from './features/profile/ProfileScreen.tsx';
import { TaskDetailHost } from './features/task/TaskDetail.tsx';
import { ReminderAlert } from './features/alert/ReminderAlert.tsx';
import { bootstrap } from './state/actions.ts';
import { tr } from './i18n/index.ts';
import { useStore } from './state/store.ts';

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

  if (handoff) return <Handoff state={handoff} />;
  if (!authReady) return <Splash />;
  if (!userId) return <SignIn />;
  if (!bootstrapped && !profile) return <Splash />;
  // no cached profile to fall back on – never render an empty app shell
  if (bootstrapped && !profile) return <BootstrapFailed />;
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
        {tab === 'profile' && <ProfileScreen />}
      </main>
      <Nav />
      <TaskDetailHost />
      <ReminderAlert />
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

/** bootstrap() failed and there is no cached profile: never leave the app shell empty. */
function BootstrapFailed() {
  return (
    <div class="auth handoff" role="alert">
      <h1 class="brand big">NORA</h1>
      <div class="auth-card">
        <h2>{tr('common.error')}</h2>
        <p class="muted">{tr('ai.offline')}</p>
        <button type="button" class="btn-google" onClick={() => void bootstrap()}>
          <span>{tr('common.retry')}</span>
        </button>
      </div>
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
      {state !== 'working' && (
        // a stalled/expired hand-off must never trap the user on this screen forever
        <button type="button" class="auth-alt" onClick={() => (location.href = location.origin + location.pathname)}>
          {tr('common.continue')}
        </button>
      )}
    </div>
  );
}
