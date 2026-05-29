// ---------------------------------------------------------------------------
//  Change password. Used for the routine "I want a new password" flow, and
//  also as the gate that the must-change-password redirect sends users to.
//  On success, adopts the fresh token the API mints so the user stays
//  signed in without re-entering credentials.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { ErrorBanner } from '../components/ui.jsx';
import PasswordStrength, { passwordPolicyError } from '../components/PasswordStrength.jsx';

export default function ChangePassword() {
  const { mustChangePassword, onPasswordChanged } = useStore();
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!current) { setError('Enter your current password.'); return; }
    const policyErr = passwordPolicyError(pw);
    if (policyErr) { setError(policyErr); return; }
    if (pw === current) { setError('New password must differ from the current one.'); return; }
    if (pw !== confirm) { setError('New passwords do not match.'); return; }
    setBusy(true);
    try {
      const res = await api.changePassword(current, pw);
      await onPasswordChanged(res.token);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not change password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page stack-lg">
      <div className="topbar">
        <div>
          <div className="page-crumb">Account</div>
          <div className="page-title">
            {mustChangePassword ? 'Set a new password to continue' : 'Change password'}
          </div>
        </div>
      </div>

      <form onSubmit={submit} className="card card-pad" style={{ maxWidth: 540 }}>
        {mustChangePassword && (
          <div className="info-banner" style={{ marginBottom: 14 }}>
            Your administrator has asked you to change your password before continuing.
          </div>
        )}
        <ErrorBanner message={error} />

        <div className="field">
          <label className="field-label">Current password</label>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
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
        <button className="btn btn-primary" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
