import { tr } from '../i18n/index.ts';
import type { VoiceState } from '../state/store.ts';
import { Icon } from './Icon.tsx';

/**
 * NORA's signature: a perfect circle (Electric Blue → Cyan) with one or two soft
 * outer rings. Listening = cyan-dominant rings that follow the voice level;
 * processing = deep blue with a quiet shimmer; speaking = a slow blue/cyan wave.
 * State is always also given by the label and icon, never by colour alone.
 */
export function VoiceButton({ state, level, onPress, disabled }: { state: VoiceState; level: number; onPress: () => void; disabled?: boolean }) {
  const label = state === 'listening' ? tr('ai.stop') : tr('ai.mic');
  // small amplitude – the rings breathe with the voice, they never jump
  const ring = state === 'listening' ? 1 + Math.min(level, 1) * 0.12 : 1;
  return (
    <div class={`voice voice-${state}`}>
      <div class="voice-stage" style={{ '--ring': String(ring) }}>
        <span class="voice-ring r1" aria-hidden="true" />
        <span class="voice-ring r2" aria-hidden="true" />
        <button type="button" class="voice-btn" onClick={onPress} aria-label={label} aria-pressed={state === 'listening'} disabled={disabled}>
          {state === 'listening' ? (
            <Icon name="stop" size={28} />
          ) : state === 'processing' ? (
            <span class="voice-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : state === 'speaking' ? (
            <Icon name="speaker" size={28} />
          ) : (
            <Icon name="mic" size={30} />
          )}
        </button>
      </div>
      <p class="voice-state" aria-live="polite">
        {state === 'listening' ? tr('ai.listening') : state === 'processing' ? tr('ai.understanding') : state === 'speaking' ? tr('ai.speaking') : tr('ai.tap_to_speak')}
      </p>
    </div>
  );
}
