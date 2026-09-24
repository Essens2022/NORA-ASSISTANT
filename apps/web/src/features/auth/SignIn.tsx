import { useState } from 'preact/hooks';
import { Button, Input } from '../../components/ui.tsx';
import { brand, feature, isConfigured } from '../../config/brand.ts';
import { DEFAULT_LOCALE, getLang, tr } from '../../i18n/index.ts';
import { deviceTimezone } from '../../services/api.ts';
import { sendCode, signInWith, verifyCode } from '../../services/auth.ts';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // Google first when it's available; email code stays one tap away
  const [step, setStep] = useState<'choice' | 'email' | 'code'>(feature('google_login') ? 'choice' : 'email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isConfigured()) {
    return (
      <div class="auth">
        <h1 class="brand big">{brand.appName}</h1>
        <p class="muted">{tr('auth.not_configured')}</p>
      </div>
    );
  }

  const request = async (e?: Event) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lang = getLang();
      await sendCode(email.trim(), { ui_lang: lang, locale: DEFAULT_LOCALE[lang], timezone: deviceTimezone() });
      setStep('code');
    } catch (err) {
      setError((err as { status?: number }).status === 429 ? tr('auth.rate_limited') : tr('common.error'));
    }
    setBusy(false);
  };

  const oauth = async (provider: 'google' | 'apple') => {
    setBusy(true);
    setError(null);
    try {
      await signInWith(provider); // navigates away to the provider
    } catch {
      setError(tr('auth.oauth_failed'));
      setBusy(false);
    }
  };

  const verify = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email.trim(), code.trim());
      // onAuthStateChange takes it from here
    } catch {
      setError(tr('auth.wrong_code'));
    }
    setBusy(false);
  };

  return (
    <div class="auth">
      <h1 class="brand big">{brand.appName}</h1>
      <p class="tagline">{tr('brand.tagline')}</p>
      <div class="auth-card">
        <h2>{tr('auth.title')}</h2>
        <p class="muted">{tr('auth.subtitle')}</p>
        {step === 'choice' ? (
          <div class="oauth">
            <button type="button" class="btn-google" disabled={busy} onClick={() => void oauth('google')}>
              <GoogleMark />
              <span>{tr('auth.google')}</span>
            </button>
            {feature('apple_login') && (
              <Button full onClick={() => void oauth('apple')}>
                {tr('auth.apple')}
              </Button>
            )}
            <button type="button" class="auth-alt" onClick={() => setStep('email')}>
              {tr('auth.email_instead')}
            </button>
          </div>
        ) : step === 'email' ? (
          <form onSubmit={request} class="form">
            <Input label={tr('auth.email')} type="email" required autocomplete="email" inputMode="email" placeholder={tr('auth.email_placeholder')} value={email} onValue={setEmail} />
            <Button variant="primary" type="submit" full busy={busy} disabled={!/^\S+@\S+\.\S+$/.test(email)}>
              {tr('auth.send_code')}
            </Button>
            {feature('google_login') && (
              <button type="button" class="auth-alt" onClick={() => setStep('choice')}>
                {tr('auth.back_to_google')}
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={verify} class="form">
            <p>{tr('auth.code_sent', { email })}</p>
            <Input
              label={tr('auth.code')}
              inputMode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6,10}"
              maxLength={10}
              value={code}
              onValue={(v) => setCode(v.replace(/\D/g, ''))}
              hint={tr('auth.link_hint')}
            />
            <Button variant="primary" type="submit" full busy={busy} disabled={code.length < 6}>
              {tr('auth.verify')}
            </Button>
            <div class="actions-row">
              <Button variant="ghost" small onClick={() => void request()}>
                {tr('auth.resend')}
              </Button>
              <Button variant="ghost" small onClick={() => setStep('email')}>
                {tr('auth.change_email')}
              </Button>
            </div>
          </form>
        )}
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Google's multi-colour "G" (brand guidelines: keep it on a white/neutral button). */
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
