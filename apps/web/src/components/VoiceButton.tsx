import { tr } from '../i18n/index.ts';
import type { VoiceState } from '../state/store.ts';
import { Icon } from './Icon.tsx';

/**
 * NORA's presence: a living orb. It breathes while idle, follows your voice while
 * listening, swirls while thinking and pulses while speaking. State is also given
 * by the label and the icon, never by colour/motion alone.
 */
export function VoiceButton({ state, level, onPress, disabled }: { state: VoiceState; level: number; onPress: () => void; disabled?: boolean }) {
  const label = state === 'listening' ? tr('ai.stop') : tr('ai.mic');
  const scale = state === 'listening' ? 1 + Math.min(level, 1) * 0.18 : 1;
  return (
    <div class={`voice voice-${state}`}>
      <button type="button" class="orb" onClick={onPress} aria-label={label} aria-pressed={state === 'listening'} disabled={disabled} style={{ '--lvl': String(scale) }}>
        <span class="orb-glow" aria-hidden="true" />
        <span class="orb-core" aria-hidden="true">
          <span class="orb-swirl" />
          <span class="orb-swirl two" />
          <span class="orb-shine" />
        </span>
        <span class="orb-icon" aria-hidden="true">
          {state === 'listening' ? <Icon name="stop" size={26} /> : state === 'processing' ? null : state === 'speaking' ? <Icon name="speaker" size={26} /> : <Icon name="mic" size={28} />}
        </span>
      </button>
      <p class="voice-state" aria-live="polite">
        {state === 'listening' ? tr('ai.listening') : state === 'processing' ? tr('ai.understanding') : state === 'speaking' ? tr('ai.speaking') : tr('ai.tap_to_speak')}
      </p>
    </div>
  );
}
