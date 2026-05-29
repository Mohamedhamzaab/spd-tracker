// ---------------------------------------------------------------------------
//  Reset password. Reads the token from the URL, validates the new password
//  client-side against the same rules as the API, then redirects to /login
//  on success.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ErrorBanner } from '../components/ui.jsx';
import PasswordStrength, { passwordPolicyError } from '../components/PasswordStrength.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    const policyErr = passwordPolicyError(pw);
    if (policyErr) { setError(policyErr); return; }
    if (pw !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await api.resetPassword(token, pw);
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 1500);
    } catch (err) {
      setError(err.message || 'Reset failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-mark">Safari Park Project</div>
          <div className="login-title">Reset link missing</div>
          <div className="login-sub">
            Use the link in your reset email, or request a new one.
          </div>
          <Link to="/forgot-password" className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark">Safari Park Project</div>
        <div className="login-title">Reset password</div>
        <div className="login-sub">Set a new password. You can sign in with it once you're done.</div>

        {done ? (
          <div className="info-banner" style={{ marginTop: 12 }}>
            Password updated. Taking you to sign in…
          </div>
        ) : (
          <>
            <ErrorBanner message={error} />
            <div className="field">
              <label className="field-label">New password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                required
              />
              <PasswordStrength password={pw} />
            </div>
            <div className="field">
              <label className="field-label">Confirm new password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
              disabled={busy}
            >
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
