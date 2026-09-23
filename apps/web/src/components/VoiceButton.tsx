import { tr } from '../i18n/index.ts';
import type { VoiceState } from '../state/store.ts';
import { Icon } from './Icon.tsx';

/** The big central mic. State is communicated by label + shape + motion, not colour alone. */
export function VoiceButton({ state, level, onPress, disabled }: { state: VoiceState; level: number; onPress: () => void; disabled?: boolean }) {
  const label = state === 'listening' ? tr('ai.stop') : tr('ai.mic');
  const scale = state === 'listening' ? 1 + Math.min(level, 1) * 0.35 : 1;
  return (
    <div class={`voice voice-${state}`}>
      <span class="voice-ring" style={{ transform: `scale(${scale})` }} aria-hidden="true" />
      <button type="button" class="voice-btn" onClick={onPress} aria-label={label} aria-pressed={state === 'listening'} disabled={disabled}>
        {state === 'listening' ? <Icon name="stop" size={30} /> : state === 'processing' ? <span class="dots" aria-hidden="true"><i /><i /><i /></span> : state === 'speaking' ? <Icon name="speaker" size={30} /> : <Icon name="mic" size={32} />}
      </button>
      <p class="voice-state" aria-live="polite">
        {state === 'listening' ? tr('ai.listening') : state === 'processing' ? tr('ai.understanding') : state === 'speaking' ? tr('ai.speaking') : tr('ai.tap_to_speak')}
      </p>
    </div>
  );
}
