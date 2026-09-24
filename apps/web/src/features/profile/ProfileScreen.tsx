import { LANGS, type Lang, type MemoryItem, type Preferences, type SoundLevel } from '@nora/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.tsx';
import { Button, Confirm, Input, Section, Segmented, Select, Toggle } from '../../components/ui.tsx';
import { DEFAULT_LOCALE, formatDate, formatTime, getLang, LANG_NAMES, tr } from '../../i18n/index.ts';
import { api, deviceTimezone, isManualTimezone, setManualTimezone } from '../../services/api.ts';
import { signOut } from '../../services/auth.ts';
import { disablePushOnThisDevice, enablePush, pushStatus, type PushStatus } from '../../services/push.ts';
import { saveVoice, savedVoice, tts } from '../../services/voice/tts.ts';
import { updateProfile } from '../../state/actions.ts';
import { toast, useStore, toastError } from '../../state/store.ts';
import { applyTheme, currentTheme, type Theme } from '../../utils/theme.ts';
import { playChime } from '../../utils/chime.ts';

const LOCALES = ['en-US', 'en-GB', 'ro-RO', 'it-IT', 'ru-RU', 'de-DE', 'fr-FR', 'es-ES', 'pt-PT', 'pl-PL', 'uk-UA'];

export function ProfileScreen() {
  const { profile, email } = useStore((s) => ({ profile: s.profile, email: s.email }));
  if (!profile) return <div class="screen" />;
  const p = profile.prefs;
  const setPref = <K extends keyof Preferences>(k: K, v: Preferences[K]) => updateProfile({ prefs: { [k]: v } as Partial<Preferences> });

  return (
    <div class="screen profile-screen">
      <header class="screen-head">
        <h1>{tr('prof.title')}</h1>
      </header>

      <Section title={tr('prof.account')} id="account">
        <NameField value={profile.display_name ?? ''} />
        <div class="row">
          <span class="row-label">{tr('prof.email')}</span>
          <span class="muted">{email}</span>
        </div>
        <Button icon="back" onClick={() => void signOut()}>
          {tr('prof.logout')}
        </Button>
      </Section>

      <Section title={tr('prof.language')} id="language">
        <Select<Lang>
          label={tr('prof.ui_lang')}
          value={profile.ui_lang}
          options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))}
          onChange={(l) => void updateProfile({ ui_lang: l, ...(profile.locale.startsWith(profile.ui_lang) ? { locale: DEFAULT_LOCALE[l] } : {}) })}
        />
        <Select<string>
          label={tr('prof.conv_lang')}
          value={profile.conv_lang ?? 'auto'}
          options={[{ value: 'auto', label: tr('prof.conv_auto') }, ...LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))]}
          onChange={(v) => void updateProfile({ conv_lang: v === 'auto' ? null : (v as Lang) })}
        />
      </Section>

      <Section title={tr('prof.region')} id="region">
        <Select<string>
          label={tr('prof.locale')}
          value={profile.locale}
          options={LOCALES.map((l) => ({ value: l, label: `${new Intl.DisplayNames([getLang()], { type: 'region' }).of(l.split('-')[1]) ?? l} · ${new Intl.DateTimeFormat(l, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(Date.UTC(2026, 8, 23, 12)))}` }))}
          onChange={(v) => void updateProfile({ locale: v })}
        />
        <Segmented<string>
          label={tr('prof.hour_format')}
          value={p.hour12 === null ? 'auto' : p.hour12 ? '12' : '24'}
          options={[
            { value: 'auto', label: tr('prof.h_auto') },
            { value: '24', label: tr('prof.h24') },
            { value: '12', label: tr('prof.h12') },
          ]}
          onChange={(v) => void setPref('hour12', v === 'auto' ? null : v === '12')}
        />
        <p class="hint">
          {formatDate('2026-09-23')} · {formatTime('14:30')}
        </p>
        <TimezoneField current={profile.timezone} />
      </Section>

      <Section title={tr('prof.voice')} id="voice">
        <Toggle label={tr('prof.voice_replies')} checked={p.voice_replies} onChange={(v) => void setPref('voice_replies', v)} />
        {p.voice_replies && <VoicePicker lang={profile.conv_lang ?? profile.ui_lang} />}
      </Section>

      <Section title={tr('prof.notifications')} id="notifications">
        <PushControl />
        <Toggle label={tr('prof.notif_all')} checked={p.notifications} onChange={(v) => void setPref('notifications', v)} />
        <Segmented<SoundLevel>
          label={tr('prof.sound')}
          value={p.sound}
          options={[
            { value: 'silent', label: tr('prof.sound_silent') },
            { value: 'normal', label: tr('prof.sound_normal') },
            { value: 'important', label: tr('prof.sound_important') },
          ]}
          onChange={(v) => {
            void setPref('sound', v);
            if (v !== 'silent') playChime(v === 'important' ? 'important' : 'normal');
          }}
        />
        <Button small icon="speaker" onClick={() => playChime(p.sound === 'important' ? 'important' : 'normal')} disabled={p.sound === 'silent'}>
          {tr('prof.sound_preview')}
        </Button>
      </Section>

      <Section title={tr('prof.reminders')} id="reminders">
        <Select<string>
          label={tr('prof.lead')}
          value={String(p.reminder_lead_min)}
          options={[0, 5, 10, 15, 30, 60, 120].map((n) => ({ value: String(n), label: n ? tr('prof.lead_n', { n }) : tr('prof.lead_at') }))}
          onChange={(v) => void setPref('reminder_lead_min', Number(v))}
        />
        <Select<string>
          label={tr('prof.buffer')}
          value={String(p.travel_buffer_min)}
          options={[0, 10, 15, 30, 45, 60].map((n) => ({ value: String(n), label: `${n} min` }))}
          onChange={(v) => void setPref('travel_buffer_min', Number(v))}
        />
        <Toggle label={tr('prof.day_before')} checked={p.day_before} onChange={(v) => void setPref('day_before', v)} />
        <TimePref label={tr('prof.default_time')} value={p.default_time} onSave={(v) => void setPref('default_time', v)} />
        <TimePref label={tr('prof.evening_time')} value={p.evening_time} onSave={(v) => void setPref('evening_time', v)} />
        <Toggle label={tr('prof.followups')} checked={p.followups} onChange={(v) => void setPref('followups', v)} />
        {p.followups && (
          <Select<string>
            label={tr('prof.max_followups')}
            value={String(p.max_followups)}
            options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: tr('prof.times_n', { n }) }))}
            onChange={(v) => void setPref('max_followups', Number(v))}
          />
        )}
      </Section>

      <Section title={tr('prof.memory')} id="memory">
        <p class="hint">{tr('prof.memory_hint')}</p>
        <Toggle label={tr('prof.personalization')} checked={p.personalization} onChange={(v) => void setPref('personalization', v)} />
        <MemoryList />
      </Section>

      <Section title={tr('prof.appearance')} id="appearance">
        <ThemePicker />
      </Section>

      <Section title={tr('prof.privacy')} id="privacy">
        <PrivacyControls />
      </Section>

      <p class="version muted">{tr('prof.version', { v: __APP_VERSION__ })}</p>
    </div>
  );
}

function NameField({ value }: { value: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = () => {
    if (v.trim() !== value) void updateProfile({ display_name: v.trim() || null });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
        (document.activeElement as HTMLElement)?.blur();
      }}
    >
      <Input label={tr('prof.name')} value={v} onValue={setV} placeholder={tr('prof.name_placeholder')} maxLength={60} onBlur={save} autocomplete="given-name" />
    </form>
  );
}

function TimePref({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <Input label={label} type="time" value={v} onValue={setV} onBlur={() => v && v !== value && onSave(v)} onChange={(e) => {
    const nv = (e.target as HTMLInputElement).value;
    if (nv && nv !== value) onSave(nv);
  }} />;
}

function TimezoneField({ current }: { current: string }) {
  const device = deviceTimezone();
  const [manual, setManual] = useState(isManualTimezone());
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
    } catch {
      return [current, device];
    }
  }, []);
  return (
    <>
      <Toggle
        label={tr('prof.tz_auto', { tz: device })}
        checked={!manual}
        onChange={(auto) => {
          setManual(!auto);
          setManualTimezone(!auto);
          if (auto && current !== device) void updateProfile({ timezone: device });
        }}
      />
      {manual && (
        <Select<string>
          label={tr('prof.timezone')}
          value={current}
          options={[...new Set([current, ...zones])].map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))}
          onChange={(z) => void updateProfile({ timezone: z })}
        />
      )}
    </>
  );
}

function VoicePicker({ lang }: { lang: Lang }) {
  const [voices, setVoices] = useState<Array<{ uri: string; name: string }>>([]);
  const [sel, setSel] = useState(savedVoice(lang) ?? '');
  useEffect(() => {
    void tts.voices(lang).then(setVoices);
    setSel(savedVoice(lang) ?? '');
  }, [lang]);
  if (!tts.available()) return null;
  return (
    <div class="voice-picker">
      <Select<string>
        label={`${tr('prof.voice_name')} · ${LANG_NAMES[lang]}`}
        value={sel}
        options={[{ value: '', label: tr('prof.voice_default') }, ...voices.map((v) => ({ value: v.uri, label: v.name }))]}
        onChange={(v) => {
          setSel(v);
          saveVoice(lang, v || null);
        }}
      />
      <Button small icon="speaker" onClick={() => void tts.speak(tr('prof.voice_test'), lang, { voiceURI: sel || null })}>
        {tr('prof.voice_preview')}
      </Button>
    </div>
  );
}

function PushControl() {
  const [status, setStatus] = useState<PushStatus>(pushStatus());
  const [busy, setBusy] = useState(false);
  const lang = useStore((s) => s.profile?.ui_lang ?? 'en');
  const label =
    status === 'granted' ? tr('prof.notif_enabled') : status === 'denied' ? tr('prof.notif_blocked') : status === 'unsupported' ? tr('prof.notif_unsupported') : status === 'ios_needs_install' ? tr('prof.notif_ios') : '';
  return (
    <div class="push-control">
      <div class="row">
        <div class="row-text">
          <span class="row-label">{tr('prof.notif_on')}</span>
          {label && <p class="hint">{label}</p>}
        </div>
        {status === 'default' && (
          <Button
            small
            variant="primary"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setStatus(await enablePush(lang));
              } catch {
                toastError(tr('common.error'));
              }
              setBusy(false);
            }}
          >
            {tr('prof.notif_enable')}
          </Button>
        )}
        {status === 'granted' && (
          <Button small variant="ghost" onClick={async () => {
            await disablePushOnThisDevice();
            toast(tr('common.saved'));
          }}>
            {tr('common.off')}
          </Button>
        )}
      </div>
      {status === 'granted' && (
        <Button
          small
          icon="bell"
          onClick={async () => {
            try {
              await enablePush(lang);
              const r = await api<{ sent: number }>('/v1/push/test', { method: 'POST' });
              toast(r.sent ? tr('prof.notif_test_sent') : tr('prof.notif_test_none'));
            } catch {
              toastError(tr('common.error'));
            }
          }}
        >
          {tr('prof.notif_test')}
        </Button>
      )}
    </div>
  );
}

// kept between visits and prefetched after start-up, so the list shows instantly
let memoryCache: MemoryItem[] | null = null;
export function prefetchMemory() {
  return api<{ items: MemoryItem[] }>('/v1/memory')
    .then((r) => (memoryCache = Array.isArray(r.items) ? r.items : []))
    .catch(() => memoryCache);
}

function MemoryList() {
  const [items, setItemsState] = useState<MemoryItem[] | null>(memoryCache);
  const setItems = (v: MemoryItem[]) => {
    memoryCache = v;
    setItemsState(v);
  };
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const load = () =>
    api<{ items: MemoryItem[] }>('/v1/memory')
      .then((r) => setItems(Array.isArray(r.items) ? r.items : []))
      .catch(() => setItems(memoryCache ?? []));
  useEffect(() => void load(), []);

  if (items === null) return <p class="muted">…</p>;
  return (
    <>
      {items.length === 0 ? (
        <p class="muted">{tr('prof.memory_empty')}</p>
      ) : (
        <ul class="memory-list">
          {items.map((m) => (
            <li key={m.id}>
              {editing === m.id ? (
                <form
                  class="memory-edit"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await api(`/v1/memory/${m.id}`, { method: 'PATCH', body: { value } });
                      setEditing(null);
                      void load();
                    } catch {
                      toastError(tr('err.save_failed'));
                    }
                  }}
                >
                  <Input label={m.key.replace(/_/g, ' ')} value={value} onValue={setValue} maxLength={300} />
                  <div class="actions-row">
                    <Button small onClick={() => setEditing(null)}>
                      {tr('common.cancel')}
                    </Button>
                    <Button small variant="primary" type="submit">
                      {tr('common.save')}
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <span class="memory-text">{m.value}</span>
                  <span class="memory-actions">
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label={`${tr('common.edit')}: ${m.value}`}
                      onClick={() => {
                        setEditing(m.id);
                        setValue(m.value);
                      }}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label={`${tr('common.delete')}: ${m.value}`}
                      onClick={async () => {
                        await api(`/v1/memory/${m.id}`, { method: 'DELETE' }).catch(() => toastError(tr('err.save_failed')));
                        void load();
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <Button small variant="danger" icon="trash" onClick={() => setConfirmAll(true)}>
          {tr('prof.memory_delete_all')}
        </Button>
      )}
      <Confirm
        open={confirmAll}
        title={tr('prof.memory_delete_all')}
        body={tr('prof.memory_delete_all_confirm')}
        confirm={tr('common.delete')}
        cancel={tr('common.cancel')}
        danger
        onCancel={() => setConfirmAll(false)}
        onConfirm={async () => {
          setConfirmAll(false);
          await api('/v1/memory', { method: 'DELETE' }).catch(() => toastError(tr('err.save_failed')));
          void load();
        }}
      />
    </>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(currentTheme());
  return (
    <Segmented<Theme>
      label={tr('prof.appearance')}
      value={theme}
      options={[
        { value: 'system', label: tr('prof.theme_system') },
        { value: 'light', label: tr('prof.theme_light') },
        { value: 'dark', label: tr('prof.theme_dark') },
      ]}
      onChange={(t) => {
        setTheme(t);
        applyTheme(t);
      }}
    />
  );
}

function PrivacyControls() {
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        icon="list"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const data = await api('/v1/export');
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `nora-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          } catch {
            toastError(tr('common.error'));
          }
          setBusy(false);
        }}
      >
        {tr('prof.export')}
      </Button>
      <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>
        {tr('prof.delete_account')}
      </Button>
      <Confirm
        open={confirm}
        title={tr('prof.delete_account')}
        body={tr('prof.delete_account_body')}
        confirm={tr('prof.delete_account')}
        cancel={tr('common.cancel')}
        danger
        confirmDisabled={typed !== 'DELETE'}
        onCancel={() => {
          setConfirm(false);
          setTyped('');
        }}
        onConfirm={async () => {
          try {
            await api('/v1/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
            try {
              localStorage.clear();
            } catch {
              /* ignore */
            }
            await signOut();
          } catch {
            toastError(tr('common.error'));
          }
        }}
      >
        <Input label={tr('prof.delete_account_type')} value={typed} onValue={setTyped} autocomplete="off" />
      </Confirm>
    </>
  );
}
