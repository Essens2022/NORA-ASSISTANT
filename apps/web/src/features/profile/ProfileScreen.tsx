import { LANGS, type Lang, type Preferences, type SoundLevel } from '@nora/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { brand } from '../../config/brand.ts';
import { Icon } from '../../components/Icon.tsx';
import { Logo } from '../../components/Logo.tsx';
import { KitGlyph } from '../../components/NoraKitIcon.tsx';
import { Button, Confirm, Input, Sheet, Segmented, Select, Toggle } from '../../components/ui.tsx';
import { useStickyHeadHeight } from '../../hooks.ts';
import { DEFAULT_LOCALE, formatDate, formatTime, getLang, LANG_NAMES, tp, tr, trIn } from '../../i18n/index.ts';
import { api, deviceTimezone, isManualTimezone, setManualTimezone } from '../../services/api.ts';
import { signOut } from '../../services/auth.ts';
import { disablePushOnThisDevice, enablePush, isPushOptedOut, pushStatus, type PushStatus } from '../../services/push.ts';
import { saveVoice, savedVoice, tts } from '../../services/voice/tts.ts';
import { updateProfile } from '../../state/actions.ts';
import { setState, toast, useStore, toastError } from '../../state/store.ts';
import { applyTheme, currentTheme, type Theme } from '../../utils/theme.ts';
import { playChime } from '../../utils/chime.ts';

const LOCALES = ['en-US', 'en-GB', 'ro-RO', 'it-IT', 'ru-RU', 'de-DE', 'fr-FR', 'es-ES', 'pt-PT', 'pl-PL', 'uk-UA'];

const THEME_LABEL: Record<Theme, 'prof.theme_system' | 'prof.theme_light' | 'prof.theme_dark'> = {
  system: 'prof.theme_system',
  light: 'prof.theme_light',
  dark: 'prof.theme_dark',
};

export function ProfileScreen() {
  const { profile, email } = useStore((s) => ({ profile: s.profile, email: s.email }));
  const [open, setOpen] = useState<string | null>(null);
  const [headRef, headH] = useStickyHeadHeight(4);
  if (!profile) return <div class="screen" />;
  const p = profile.prefs;
  const setPref = <K extends keyof Preferences>(k: K, v: Preferences[K]) => updateProfile({ prefs: { [k]: v } as Partial<Preferences> });

  return (
    <div class="screen profile-screen">
      <div class="screen-sticky-head" ref={headRef}>
        <header class="screen-head">
          <h1>{tr('prof.title')}</h1>
        </header>
      </div>

      <div class="profile-screen-body" style={{ paddingTop: headH }}>
      <button type="button" class="prof-card" onClick={() => setOpen('account')}>
        <div class="prof-avatar" aria-hidden="true">
          <Logo size={28} />
        </div>
        <div class="prof-card-text">
          <p class="prof-name">{brand.appName}</p>
          <p class="prof-stat">{tr('prof.identity_sub')}</p>
        </div>
      </button>

      <div class="section-body prof-rows">
        <Row icon="language" color="kind-success" label={tr('prof.language')} value={LANG_NAMES[profile.ui_lang]} onClick={() => setOpen('language')} />
        <Row icon="mic" color="kind-blue" label={tr('prof.voice')} value={p.voice_replies ? tr('prof.notif_enabled') : tr('common.off')} onClick={() => setOpen('voice')} />
        <Row icon="bell" color="kind-red" label={tr('prof.notifications')} value={p.notifications ? tr('prof.notif_enabled') : tr('common.off')} onClick={() => setOpen('notifications')} />
        <Row icon="clipboard" color="kind-red" label={tr('prof.reminders')} onClick={() => setOpen('reminders')} />
        <Row icon="calendar" color="kind-success" label={tr('cal.title')} value={tr('prof.connected')} onClick={() => setState({ tab: 'calendar' })} />
        <Row icon="device" color="kind-blue" label={tr('prof.devices')} value={tr('prof.one_device')} onClick={() => setOpen('devices')} />
        <Row icon="appearance" color="kind-warning" label={tr('prof.appearance')} value={tr(THEME_LABEL[currentTheme()])} onClick={() => setOpen('appearance')} />
        <Row icon="lock" color="kind-purple" label={tr('prof.privacy')} onClick={() => setOpen('privacy')} />
        <Row icon="help" color="kind-pink" label={tr('prof.help')} href={`mailto:${brand.supportEmail}`} />
      </div>

      <p class="version muted">{tr('prof.version', { v: __APP_VERSION__ })}</p>

      <Sheet open={open === 'account'} onClose={() => setOpen(null)} title={tr('prof.account')}>
        <div class="prof-account-list">
          <NameField value={profile.display_name ?? ''} />
          <div class="prof-account-row">
            <span class="prof-account-label">{tr('prof.email')}</span>
            <span class="prof-account-value muted">{email}</span>
          </div>
          <button type="button" class="row memory-link" onClick={() => { setOpen(null); setState({ tab: 'memory' }); }}>
            <span class="row-text">
              <span class="row-label">{tr('mem.title')}</span>
            </span>
            <Icon name="chevron" size={18} class="chev" />
          </button>
          <button type="button" class="prof-account-action" onClick={() => void signOut()}>
            <Icon name="back" size={18} />
            <span>{tr('prof.logout')}</span>
          </button>
        </div>
      </Sheet>

      <Sheet open={open === 'devices'} onClose={() => setOpen(null)} title={tr('prof.devices')}>
        <div class="row">
          <span class="row-text">
            <span class="row-label">{tr('prof.this_device')}</span>
            <p class="hint">{typeof navigator === 'undefined' ? '' : navigator.userAgent.match(/Android|iPhone|iPad|Mac|Windows|Linux/)?.[0]}</p>
          </span>
          <span class="muted">{tr('prof.connected')}</span>
        </div>
      </Sheet>

      <Sheet open={open === 'language'} onClose={() => setOpen(null)} title={tr('prof.language')}>
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
      </Sheet>

      <Sheet open={open === 'voice'} onClose={() => setOpen(null)} title={tr('prof.voice')}>
        <Toggle label={tr('prof.voice_replies')} checked={p.voice_replies} onChange={(v) => void setPref('voice_replies', v)} />
        {p.voice_replies && <VoicePicker lang={profile.conv_lang ?? profile.ui_lang} />}
      </Sheet>

      <Sheet open={open === 'notifications'} onClose={() => setOpen(null)} title={tr('prof.notifications')}>
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
      </Sheet>

      <Sheet open={open === 'reminders'} onClose={() => setOpen(null)} title={tr('prof.reminders')}>
        <Select<string>
          label={tr('prof.lead')}
          value={String(p.reminder_lead_min)}
          options={[0, 5, 10, 15, 30, 60, 120].map((n) => ({ value: String(n), label: n ? tr('prof.lead_n', { n }) : tr('prof.lead_at') }))}
          onChange={(v) => void setPref('reminder_lead_min', Number(v))}
        />
        <Select<string>
          label={tr('prof.buffer')}
          value={String(p.travel_buffer_min)}
          options={[0, 10, 15, 30, 45, 60].map((n) => ({ value: String(n), label: tr('common.n_min', { n }) }))}
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
            options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: tp('prof.times', n) }))}
            onChange={(v) => void setPref('max_followups', Number(v))}
          />
        )}
        <Toggle label={tr('prof.personalization')} checked={p.personalization} onChange={(v) => void setPref('personalization', v)} hint={tr('prof.memory_hint')} />
      </Sheet>

      <Sheet open={open === 'appearance'} onClose={() => setOpen(null)} title={tr('prof.appearance')}>
        <ThemePicker />
      </Sheet>

      <Sheet open={open === 'privacy'} onClose={() => setOpen(null)} title={tr('prof.privacy')}>
        <PrivacyControls />
      </Sheet>
      </div>
    </div>
  );
}

function Row({ icon, color, label, value, onClick, href }: { icon: string; color: string; label: string; value?: string; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span class={`kind-badge square small ${color}`} aria-hidden="true">
        <KitGlyph path={`icons/${icon}.svg`} size={16} />
      </span>
      <span class="row-text">
        <span class="row-label">{label}</span>
      </span>
      {value && <span class="prof-row-value muted">{value}</span>}
      <Icon name="chevron" size={18} class="chev" />
    </>
  );
  if (href) {
    return (
      <a class="row memory-link prof-row" href={href}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" class="row memory-link prof-row" onClick={onClick}>
      {inner}
    </button>
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
      class="prof-account-name"
      onSubmit={(e) => {
        e.preventDefault();
        save();
        (document.activeElement as HTMLElement)?.blur();
      }}
    >
      <label class="prof-account-label" for="profile-name-inline">{tr('prof.name')}</label>
      <input
        id="profile-name-inline"
        class="prof-account-inline-input"
        value={v}
        placeholder={tr('prof.name_placeholder')}
        maxLength={60}
        autocomplete="given-name"
        onInput={(e) => setV((e.target as HTMLInputElement).value)}
        onBlur={save}
      />
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
      <Button
        small
        icon="speaker"
        onClick={() => {
          // cloud TTS needs an unlocked <audio> element from *this* gesture - its own
          // speak() fetches the clip first, so by the time play() runs the tap is over
          tts.unlock();
          void tts.speak(trIn(lang, 'prof.voice_test'), lang, { voiceURI: sel || null });
        }}
      >
        {tr('prof.voice_preview')}
      </Button>
    </div>
  );
}

function PushControl() {
  const [status, setStatus] = useState<PushStatus>(pushStatus());
  // browser permission ('granted') never reverts to 'default' once given – whether this
  // device actually gets pushes is separately tracked in isPushOptedOut()
  const [optedOut, setOptedOut] = useState(isPushOptedOut());
  const [busy, setBusy] = useState(false);
  const lang = useStore((s) => s.profile?.ui_lang ?? 'en');
  const on = status === 'granted' && !optedOut;
  const label =
    status === 'denied' ? tr('prof.notif_blocked') : status === 'unsupported' ? tr('prof.notif_unsupported') : status === 'ios_needs_install' ? tr('prof.notif_ios') : on ? tr('prof.notif_enabled') : '';
  return (
    <div class="push-control">
      <div class="row">
        <div class="row-text">
          <span class="row-label">{tr('prof.notif_on')}</span>
          {label && <p class="hint">{label}</p>}
        </div>
        {!on && status !== 'denied' && status !== 'unsupported' && status !== 'ios_needs_install' && (
          <Button
            small
            variant="primary"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setStatus(await enablePush(lang));
                setOptedOut(isPushOptedOut());
              } catch {
                toastError(tr('common.error'));
              }
              setBusy(false);
            }}
          >
            {tr('prof.notif_enable')}
          </Button>
        )}
        {on && (
          <Button
            small
            variant="ghost"
            onClick={async () => {
              await disablePushOnThisDevice();
              setOptedOut(true);
              toast(tr('common.saved'));
            }}
          >
            {tr('common.off')}
          </Button>
        )}
      </div>
      {on && (
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

// Memory list moved to its own screen – see features/memory/MemoryScreen.tsx.

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
      <a class="row" href={brand.urls.privacy} target="_blank" rel="noopener">
        <span class="row-text">
          <span class="row-label">{tr('prof.privacy_policy')}</span>
        </span>
        <Icon name="chevron" size={18} class="chev" />
      </a>
      <a class="row" href={brand.urls.terms} target="_blank" rel="noopener">
        <span class="row-text">
          <span class="row-label">{tr('prof.terms')}</span>
        </span>
        <Icon name="chevron" size={18} class="chev" />
      </a>
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
