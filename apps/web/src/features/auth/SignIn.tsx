import { useState } from 'preact/hooks';
import { Button, Input } from '../../components/ui.tsx';
import { brand, feature, isConfigured } from '../../config/brand.ts';
import { DEFAULT_LOCALE, getLang, tr } from '../../i18n/index.ts';
import { deviceTimezone } from '../../services/api.ts';
import { sendCode, signInWith, verifyCode } from '../../services/auth.ts';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
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
        {step === 'email' ? (
          <form onSubmit={request} class="form">
            <Input label={tr('auth.email')} type="email" required autocomplete="email" inputMode="email" placeholder={tr('auth.email_placeholder')} value={email} onValue={setEmail} />
            <Button variant="primary" type="submit" full busy={busy} disabled={!/^\S+@\S+\.\S+$/.test(email)}>
              {tr('auth.send_code')}
            </Button>
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
        {(feature('google_login') || feature('apple_login')) && step === 'email' && (
          <div class="oauth">
            {feature('google_login') && (
              <Button full onClick={() => void signInWith('google')}>
                {tr('auth.google')}
              </Button>
            )}
            {feature('apple_login') && (
              <Button full onClick={() => void signInWith('apple')}>
                {tr('auth.apple')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
