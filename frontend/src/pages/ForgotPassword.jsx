// ---------------------------------------------------------------------------
//  Forgot password. Always shows the same success message regardless of
//  whether the email matched a real account, so the page can't be used to
//  enumerate users.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ErrorBanner } from '../components/ui.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message || 'Failed to send reset link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-mark">Safari Park Project</div>
        <div className="login-title">Forgot password</div>
        <div className="login-sub">
          {sent
            ? 'If an account exists for that email, a reset link is on its way. The link is valid for one hour.'
            : 'Enter the email address on your account. We will send a one-hour reset link.'}
        </div>

        {sent ? (
          <div className="stack" style={{ marginTop: 12 }}>
            <Link className="btn" to="/login" style={{ width: '100%', justifyContent: 'center' }}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <ErrorBanner message={error} />
            <div className="field">
              <label className="field-label" htmlFor="email">Email</label>
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
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
              disabled={busy}
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
              <Link to="/login">Back to sign in</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
