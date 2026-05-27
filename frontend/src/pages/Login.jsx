// ---------------------------------------------------------------------------
//  Login.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { ErrorBanner } from '../components/ui.jsx';

export default function Login() {
  const { signIn } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark">Safari Park Project</div>
        <div className="login-title">Authority Engagement Tracker</div>
        <div className="login-sub">Sign in to continue.</div>

        <ErrorBanner message={error} />

        <div className="field">
          <label className="field-label" htmlFor="email">
            Email
          </label>
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
          <label className="field-label" htmlFor="password">
            Password
          </label>
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
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
