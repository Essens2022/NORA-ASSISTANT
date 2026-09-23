import type { Task } from '@nora/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.tsx';
import { Button, Sheet } from '../../components/ui.tsx';
import { VoiceButton } from '../../components/VoiceButton.tsx';
import { brand } from '../../config/brand.ts';
import { Briefing } from './Briefing.tsx';
import { formatTime, relativeDay, tr } from '../../i18n/index.ts';
import { cancelVoice, retryMessage, sendText, toggleVoice } from '../../state/actions.ts';
import { setState, toast, useStore, type ChatItem } from '../../state/store.ts';
import { micPermission } from '../../services/voice/recorder.ts';
import { nowLocal, todayLocal } from '../../utils/time.ts';

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
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.pending]);

  useEffect(() => () => cancelVoice(), []);

  const startVoice = async (skipExplain = false) => {
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
    if (err === 'denied') toast(tr('ai.mic_denied'), undefined, 6000);
    else if (err) toast(tr('ai.mic_unsupported'), undefined, 6000);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const ok = await sendText(text);
    if (!ok) setDraft((d) => d || text); // never lose typed input
  };

  const hour = nowLocal().hour;
  const greet = hour < 12 ? tr('ai.greet_morning') : hour < 18 ? tr('ai.greet_afternoon') : tr('ai.greet_evening');
  const examples = tr('ai.examples').split('|');

  return (
    <div class="screen ai-screen">
      <header class="ai-head">
        <h1 class="brand">{brand.appName}</h1>
        <p class="greet">
          {greet}
          {profile?.display_name ? `, ${profile.display_name}` : ''}
        </p>
      </header>

      <Briefing tasks={tasks} today={today} />

      <div class="conversation" ref={listRef} aria-live="polite" aria-relevant="additions">
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

      {!online && <p class="offline-note">{tr('ai.offline')}</p>}

      <VoiceButton state={voice} level={level} onPress={() => void startVoice()} disabled={!features.stt && voice === 'idle'} />

      <form class="composer" onSubmit={submit}>
        <label class="sr-only" for="composer-input">
          {tr('ai.input_placeholder')}
        </label>
        <input
          id="composer-input"
          class="composer-input"
          value={draft}
          maxLength={2000}
          autocomplete="off"
          placeholder={tr('ai.input_placeholder')}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          enterKeyHint="send"
        />
        <button type="submit" class="composer-send" aria-label={tr('ai.send')} disabled={!draft.trim()}>
          <Icon name="send" size={18} />
        </button>
      </form>

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
