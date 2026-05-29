// ---------------------------------------------------------------------------
//  Login. Two-step: password first, then MFA code (TOTP or backup) for
//  enrolled accounts. Accounts not yet enrolled skip step 2 and are sent
//  straight to /app/mfa-setup by the AppShell gate.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store.jsx';
import { ErrorBanner } from '../components/ui.jsx';

export default function Login() {
  const { t } = useTranslation();
  const { signInPasswordStep, signInMfaStep } = useStore();
  const navigate = useNavigate();

  // Phase: 'password' | 'mfa'
  const [phase, setPhase] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // MFA-step state
  const [challengeToken, setChallengeToken] = useState('');
  const [emailHint, setEmailHint] = useState('');
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);

  async function submitPassword(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await signInPasswordStep(email.trim(), password);
      if (res.mfa_required) {
        setChallengeToken(res.challenge_token);
        setEmailHint(res.email_hint || email.trim());
        setCode('');
        setUseBackup(false);
        setPhase('mfa');
      } else {
        navigate('/app', { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signInMfaStep(challengeToken, code.trim(), useBackup);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message || 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setPhase('password');
    setChallengeToken('');
    setEmailHint('');
    setCode('');
    setError('');
    setUseBackup(false);
  }

  if (phase === 'mfa') {
    return (
      <div className="login-wrap">
        <form className="login-card" onSubmit={submitMfa}>
          <div className="login-mark">Safari Park Project</div>
          <div className="login-title">{t('login.mfaTitle')}</div>
          <div className="login-sub">
            {useBackup
              ? t('login.mfaPromptBackup', { email: emailHint })
              : t('login.mfaPromptCode', { email: emailHint })}
          </div>
          <ErrorBanner message={error} />

          <div className="field">
            <label className="field-label">
              {useBackup ? t('login.mfaBackupLabel') : t('login.mfaCodeLabel')}
            </label>
            <input
              className="input mfa-code-input"
              type="text"
              inputMode={useBackup ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={useBackup ? 'XXXX-XXXX' : '123 456'}
              autoFocus
              required
            />
          </div>

          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
            disabled={busy}
          >
            {busy ? t('login.mfaVerifying') : t('login.mfaVerify')}
          </button>

          <div className="mfa-secondary">
            <button
              type="button"
              className="link-btn"
              onClick={() => { setUseBackup((v) => !v); setCode(''); }}
            >
              {useBackup ? t('login.mfaUseTotp') : t('login.mfaUseBackup')}
            </button>
            <button type="button" className="link-btn" onClick={startOver}>
              {t('login.mfaStartOver')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submitPassword}>
        <div className="login-mark">Safari Park Project</div>
        <div className="login-title">{t('login.title')}</div>
        <div className="login-sub">{t('login.subtitle')}</div>

        <ErrorBanner message={error} />

        <div className="field">
          <label className="field-label" htmlFor="email">{t('login.emailLabel')}</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="password">{t('login.passwordLabel')}</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
          disabled={busy}
        >
          {busy ? t('login.submitting') : t('login.submit')}
        </button>
        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          <Link to="/forgot-password">{t('login.forgotPassword')}</Link>
        </div>
      </form>
    </div>
  );
}
