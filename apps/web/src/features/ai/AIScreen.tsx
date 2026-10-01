import type { Task } from '@nora/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.tsx';
import { Logo } from '../../components/Logo.tsx';
import { Button, Sheet } from '../../components/ui.tsx';
import { VoiceButton } from '../../components/VoiceButton.tsx';
import { formatTime, relativeDay, tr } from '../../i18n/index.ts';
import { cancelVoice, retryMessage, sendText, toggleVoice } from '../../state/actions.ts';
import { setState, toast, useStore, type ChatItem, toastError, toastInfo } from '../../state/store.ts';
import { micPermission } from '../../services/voice/recorder.ts';
import { primeSpeech, tts } from '../../services/voice/tts.ts';
import { todayLocal } from '../../utils/time.ts';

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
  const [composerOpen, setComposerOpen] = useState(false);
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

  const quickCopy = {
    ro: { reminder: 'Promemoria', note: 'Notă', message: 'Mesaj', more: 'Mai mult' },
    it: { reminder: 'Promemoria', note: 'Nota', message: 'Messaggio', more: 'Altro' },
    en: { reminder: 'Reminder', note: 'Note', message: 'Message', more: 'More' },
    ru: { reminder: 'Напоминание', note: 'Заметка', message: 'Сообщение', more: 'Ещё' },
  }[(profile?.ui_lang ?? 'en') as 'ro' | 'it' | 'en' | 'ru'];

  return (
    <div class="screen ai-screen">
      <header class="ai-head approved-home-head">
        <h1 class="brand">
          <Logo size={30} withWordmark />
        </h1>
        <button type="button" class="approved-settings-btn" aria-label={tr('nav.profile')} onClick={() => setState({ tab: 'profile' })}>
          <Icon name="settings" size={19} />
        </button>
      </header>

      <section class="approved-voice-home" aria-label={tr('nav.ai')}>
        <VoiceButton state={voice} level={level} onPress={() => void startVoice()} disabled={!features.stt && voice === 'idle'} />
        <h2>{voice === 'listening' ? (profile?.ui_lang === 'it' ? 'Ti ascolto' : profile?.ui_lang === 'ro' ? 'Te ascult' : profile?.ui_lang === 'ru' ? 'Я слушаю' : 'I’m listening') : (profile?.ui_lang === 'it' ? 'Ti ascolto' : profile?.ui_lang === 'ro' ? 'Te ascult' : profile?.ui_lang === 'ru' ? 'Я слушаю' : 'I’m listening')}</h2>
        <p>{profile?.ui_lang === 'it' ? 'Dimmi cosa devo fare…' : profile?.ui_lang === 'ro' ? 'Spune-mi ce trebuie să fac…' : profile?.ui_lang === 'ru' ? 'Скажи, что мне сделать…' : 'Tell me what I should do…'}</p>
      </section>

      <div class="approved-quick-grid">
        <button type="button" onClick={() => { setDraft(profile?.ui_lang === 'it' ? 'Ricordami ' : profile?.ui_lang === 'ro' ? 'Amintește-mi ' : 'Remind me '); setComposerOpen(true); }}>
          <span><Icon name="bell" size={20} /></span><small>{quickCopy.reminder}</small>
        </button>
        <button type="button" onClick={() => setState({ tab: 'calendar' })}>
          <span><Icon name="calendar" size={20} /></span><small>{tr('cal.title')}</small>
        </button>
        <button type="button" onClick={() => setState({ tab: 'activity' })}>
          <span><Icon name="list" size={20} /></span><small>{tr('act.title')}</small>
        </button>
        <button type="button" onClick={() => { setDraft(profile?.ui_lang === 'it' ? 'Ricorda questa nota: ' : profile?.ui_lang === 'ro' ? 'Ține minte această notă: ' : 'Remember this note: '); setComposerOpen(true); }}>
          <span><Icon name="edit" size={20} /></span><small>{quickCopy.note}</small>
        </button>
        <button type="button" onClick={() => setComposerOpen(true)}>
          <span><Icon name="message" size={20} /></span><small>{quickCopy.message}</small>
        </button>
        <button type="button" onClick={() => setState({ tab: 'profile' })}>
          <span><Icon name="more" size={20} /></span><small>{quickCopy.more}</small>
        </button>
      </div>

      <div class={`approved-chat-layer${composerOpen || messages.length ? ' open' : ''}`}>
        <div class="ai-scroll" ref={listRef}>
          <div class="conversation" aria-live="polite" aria-relevant="additions">
            {messages.slice(-30).map((m) => <Bubble key={m.id} m={m} today={today} tasks={tasks} />)}
          </div>
        </div>

        {!online && <p class="offline-note">{tr('ai.offline')}</p>}

        <div class="ai-footer">
          <form class="composer" onSubmit={submit}>
            <label class="sr-only" for="composer-input">{tr('ai.input_placeholder')}</label>
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
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              onFocus={() => setComposerOpen(true)}
              onKeyDown={(e) => {
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
