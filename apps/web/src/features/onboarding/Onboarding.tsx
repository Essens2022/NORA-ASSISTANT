// Minimal onboarding: the promise, then one meaningful permission (notifications),
// explained before the OS prompt. Everything else is learned gradually.
import { useState } from 'preact/hooks';
import { Logo } from '../../components/Logo.tsx';
import { Button } from '../../components/ui.tsx';
import { tr } from '../../i18n/index.ts';
import { enablePush, pushStatus } from '../../services/push.ts';
import { track } from '../../services/api.ts';
import { updateProfile } from '../../state/actions.ts';
import { useStore } from '../../state/store.ts';

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const lang = useStore((s) => s.profile?.ui_lang ?? 'en');
  const canPush = ['default', 'granted'].includes(pushStatus());

  const finish = async () => {
    await updateProfile({ onboarded: true });
    track('onboarding_done');
  };

  if (step === 0)
    return (
      <div class="onboarding">
        <h1 class="brand big logo-splash">
          <Logo size={52} withWordmark />
        </h1>
        <p class="tagline">{tr('brand.tagline')}</p>
        <div class="onb-body">
          <h2>{tr('onb.how_title')}</h2>
          <p class="muted">{tr('onb.how_body')}</p>
        </div>
        <Button variant="primary" full onClick={() => (canPush ? setStep(1) : void finish())}>
          {tr('onb.start')}
        </Button>
      </div>
    );

  return (
    <div class="onboarding">
      <div class="onb-mark bell" aria-hidden="true" />
      <h1>{tr('onb.notif_title')}</h1>
      <p class="muted">{tr('onb.notif_body')}</p>
      <Button
        variant="primary"
        full
        busy={busy}
        onClick={async () => {
          setBusy(true);
          // the OS prompt can succeed while the actual subscription still fails
          // silently underneath (seen for real: onboarding completed, no error
          // shown, yet the device never registered) - track the real outcome so
          // that stops being invisible; onboarding itself still finishes either
          // way, Profile has its own retry if this device needs it later.
          const result = await enablePush(lang).catch((err) => `error:${err}`);
          track('push_enable_result', undefined, { result });
          setBusy(false);
          await finish();
        }}
      >
        {tr('onb.notif_enable')}
      </Button>
      <Button variant="ghost" full onClick={() => void finish()}>
        {tr('common.later')}
      </Button>
    </div>
  );
}
