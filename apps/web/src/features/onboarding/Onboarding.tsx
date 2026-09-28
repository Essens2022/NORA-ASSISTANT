// Minimal onboarding: the promise, and the one permission that makes NORA's whole
// point work (reminders can't reach anyone without it) - asked right in the same
// tap as "let's go", not on a second screen with its own easy "later" out. The
// OS's own dialog can still always be dismissed (that's never ours to override),
// but NORA itself no longer offers a separate, softer way to skip past asking.
import { useState } from 'preact/hooks';
import { Logo } from '../../components/Logo.tsx';
import { Button } from '../../components/ui.tsx';
import { tr } from '../../i18n/index.ts';
import { enablePush, pushStatus } from '../../services/push.ts';
import { track } from '../../services/api.ts';
import { updateProfile } from '../../state/actions.ts';
import { useStore } from '../../state/store.ts';

export function Onboarding() {
  const [busy, setBusy] = useState(false);
  const lang = useStore((s) => s.profile?.ui_lang ?? 'en');
  const canPush = ['default', 'granted'].includes(pushStatus());

  const finish = async () => {
    await updateProfile({ onboarded: true });
    track('onboarding_done');
  };

  return (
    <div class="onboarding">
      <h1 class="brand big logo-splash">
        <Logo size={52} withWordmark />
      </h1>
      <p class="tagline">{tr('brand.tagline')}</p>
      <div class="onb-body">
        <h2>{tr('onb.how_title')}</h2>
        <p class="muted">{tr('onb.how_body')}</p>
        {canPush && <p class="muted">{tr('onb.notif_body')}</p>}
      </div>
      <Button
        variant="primary"
        full
        busy={busy}
        onClick={async () => {
          if (canPush) {
            setBusy(true);
            // the OS prompt can succeed while the actual subscription still fails
            // silently underneath (seen for real: onboarding completed, no error
            // shown, yet the device never registered) - track the real outcome so
            // that stops being invisible; onboarding itself still finishes either
            // way, Profile has its own retry if this device needs it later.
            const result = await enablePush(lang).catch((err) => `error:${err}`);
            track('push_enable_result', undefined, { result });
            setBusy(false);
          }
          await finish();
        }}
      >
        {tr('onb.start')}
      </Button>
    </div>
  );
}
