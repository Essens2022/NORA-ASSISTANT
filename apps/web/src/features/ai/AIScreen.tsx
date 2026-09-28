import type { Task } from '@nora/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.tsx';
import { Logo } from '../../components/Logo.tsx';
import { Button, Sheet } from '../../components/ui.tsx';
import { VoiceButton } from '../../components/VoiceButton.tsx';
import { Briefing } from './Briefing.tsx';
import { formatTime, relativeDay, tr } from '../../i18n/index.ts';
import { cancelVoice, retryMessage, sendText, toggleVoice } from '../../state/actions.ts';
import { setState, toast, useStore, type ChatItem, toastError, toastInfo } from '../../state/store.ts';
import { micPermission } from '../../services/voice/recorder.ts';
import { primeSpeech, tts } from '../../services/voice/tts.ts';
import { nowLocal, todayLocal } from '../../utils/time.ts';

// iOS only lets audio start (speech synthesis, an <audio> element) inside a real
// user gesture - and, on this screen, doing that claims the device's audio session
// from whatever else was playing (seen on device: opening NORA at all silenced
// Spotify, and it stayed silenced even after leaving the app again). Doing it once,
// eagerly, the moment the person touches *anything* in the whole app - as this used
// to, from main.tsx - grabbed that session long before there was any reply to
// speak, and for no reason if they never end up using voice at all. Unlock right
// here instead, on the two taps that can actually lead to NORA speaking (the mic,
// and sending a message that might get a spoken reply) - never earlier.
// unlockAudio() (utils/chime.ts) deliberately stays out of this: it opens its own
// AudioContext and, once open, that context is never closed - it's what was still
// holding the audio session claim after the mic was released, so Spotify never came
// back on its own the way it does after ChatGPT's mic (seen on device). It's only
// for playChime()'s notification sound (reminders), a real, occasional interrupt,
// not something every single voice turn needs to pay for.
const unlockVoiceAudio = () => {
  primeSpeech();
  tts.unlock();
};

const DRAFT_KEY = 'nora.draft';
const MIC_EXPLAINED = 'nora.mic_explained';

export function AIScreen() {
  const { messages, voice, level, tasks, profile, online, features } = useStore((s) => ({
    messages: s.messages,
    voice: s.voice,
    level: s.level,
    tasks: s.tasks,
    profile: s.profile,
    online: s.online,
    features: s.features,
  }));
  const [draft, setDraft] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [explainMic, setExplainMic] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const today = todayLocal();

  useEffect(() => {
    try {
      if (draft) localStorage.setItem(DRAFT_KEY, draft);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }, [draft]);

  useLayoutEffect(() => {
    const el = listRef.current;
    // nothing to scroll to yet – leave the empty-state heading at the top, not centred off-screen
    if (el && messages.length) el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.pending]);

  useEffect(() => () => cancelVoice(), []);

  const startVoice = async (skipExplain = false) => {
    unlockVoiceAudio(); // synchronously inside the tap, before any await below
    if (!skipExplain && voice === 'idle') {
      let explained = false;
      try {
        explained = localStorage.getItem(MIC_EXPLAINED) === '1';
      } catch {
        /* ignore */
      }
      if (!explained && (await micPermission()) !== 'granted') {
        setExplainMic(true);
        return;
      }
    }
    const err = await toggleVoice();
    if (err === 'denied') toastError(tr('ai.mic_denied'), 6000);
    else if (err) toastInfo(tr('ai.mic_unsupported'), 6000);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    unlockVoiceAudio(); // synchronously inside the tap: a text message can get a spoken reply too
    setDraft('');
    // the textarea's grown height is set directly on the element (not via CSS), so
    // clearing the draft alone wouldn't shrink it back down
    const textarea = (e.currentTarget as HTMLFormElement)?.querySelector('.composer-input') as HTMLTextAreaElement | null;
    if (textarea) textarea.style.height = 'auto';
    const ok = await sendText(text);
    if (!ok) setDraft((d) => d || text); // never lose typed input
  };

  const hour = nowLocal().hour;
  // Midnight–4am is still "evening" as far as a greeting goes – the night hasn't
  // turned into morning just because the clock rolled over to a new date.
  const greet = hour < 4 ? tr('ai.greet_evening') : hour < 12 ? tr('ai.greet_morning') : hour < 18 ? tr('ai.greet_afternoon') : tr('ai.greet_evening');
  const examples = tr('ai.examples').split('|');
  const avatarFile = voice === 'listening' ? 'avatar-listening' : voice === 'processing' ? 'avatar-thinking' : voice === 'speaking' ? 'avatar-speaking' : 'avatar-idle';

  return (
    <div class="screen ai-screen">
      <header class="ai-head">
        <h1 class="brand">
          <Logo size={34} withWordmark />
        </h1>
        <p class="greet">
          <img src={`${import.meta.env.BASE_URL}${avatarFile}.webp`} alt="" class="ai-avatar-thumb" />
          <span>
            {greet}
            {profile?.display_name ? `, ${profile.display_name}` : ''}
          </span>
        </p>
      </header>

      {/* the briefing stays put, like the voice button and composer below it – only
          the conversation scrolls, never pushed off or hidden on a short phone */}
      <Briefing tasks={tasks} today={today} />

      <div class="ai-scroll" ref={listRef}>
        <div class="conversation" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 ? (
            <div class="ai-empty">
              <p>{tr('ai.empty')}</p>
              <ul class="examples">
                {examples.map((ex) => (
                  <li key={ex}>
                    <button type="button" onClick={() => setDraft(ex)}>
                      “{ex}”
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            messages.slice(-30).map((m) => <Bubble key={m.id} m={m} today={today} tasks={tasks} />)
          )}
        </div>
      </div>

      {!online && <p class="offline-note">{tr('ai.offline')}</p>}

      {/* wrapped so the two stick together at the bottom of the screen while the
          keyboard is open (see .ai-footer in styles.css) - the conversation above
          scrolls, this stays put instead of scrolling away with it */}
      <div class="ai-footer">
        <VoiceButton state={voice} level={level} onPress={() => void startVoice()} disabled={!features.stt && voice === 'idle'} />

        <form class="composer" onSubmit={submit}>
          <label class="sr-only" for="composer-input">
            {tr('ai.input_placeholder')}
          </label>
          <textarea
            id="composer-input"
            class="composer-input"
            rows={1}
            value={draft}
            maxLength={2000}
            autocomplete="off"
            placeholder={tr('ai.input_placeholder')}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              setDraft(el.value);
              // grow with the text, like WhatsApp, instead of scrolling sideways in one line
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              // Enter sends (matches the old <input> behaviour); Shift+Enter makes a new line
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
              }
            }}
            enterkeyhint="send"
          />
          <button type="submit" class="composer-send" aria-label={tr('ai.send')} disabled={!draft.trim()}>
            <Icon name="send" size={18} />
          </button>
        </form>
      </div>

      <Sheet open={explainMic} onClose={() => setExplainMic(false)} title={tr('onb.mic_title')}>
        <p class="muted">{tr('onb.mic_body')}</p>
        <div class="actions-row">
          <Button onClick={() => setExplainMic(false)}>{tr('common.later')}</Button>
          <Button
            variant="primary"
            icon="mic"
            onClick={() => {
              try {
                localStorage.setItem(MIC_EXPLAINED, '1');
              } catch {
                /* ignore */
              }
              setExplainMic(false);
              void startVoice(true);
            }}
          >
            {tr('onb.mic_allow')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function Bubble({ m, today, tasks }: { m: ChatItem & { retry?: { text: string; requestId: string } }; today: string; tasks: Record<string, Task> }) {
  if (m.pending)
    return (
      <div class="bubble assistant pending" aria-label={tr('ai.understanding')}>
        <span class="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    );
  const linked = m.results?.length ? m.results : null;
  return (
    <div class={`bubble ${m.role}${m.error ? ' error' : ''}${m.fresh ? ' fresh' : ''}`}>
      {m.fresh && m.role === 'assistant' ? (
        <p aria-label={m.text}>
          {m.text.split(/(\s+)/).map((w, i) =>
            /\s/.test(w) ? (
              w
            ) : (
              <span class="word" style={{ animationDelay: `${i * 28}ms` }} aria-hidden="true" key={i}>
                {w}
              </span>
            ),
          )}
        </p>
      ) : (
        <p>{m.text}</p>
      )}
      {linked && (
        <ul class="bubble-results">
          {linked.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => tasks[r.id] && setState({ openTaskId: r.id })}>
                <span>{r.due_time ? formatTime(r.due_time) : r.due_date ? relativeDay(r.due_date, today) : '•'}</span> {r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {m.error && m.retry && (
        <button type="button" class="link" onClick={() => retryMessage(m)}>
          <Icon name="undo" size={14} /> {tr('common.retry')}
        </button>
      )}
    </div>
  );
}
