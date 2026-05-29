// ---------------------------------------------------------------------------
//  MFA enrollment. Three short stages on one page:
//    1. Scan the QR (or copy the secret) into an authenticator app
//    2. Save the 8 backup codes somewhere safe
//    3. Enter the first generated 6-digit code to finalise
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { ErrorBanner, Loading } from '../components/ui.jsx';

export default function MfaSetup() {
  const { onMfaEnrolled, mfaEnrolled } = useStore();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (mfaEnrolled) {
      // No need to enrol again.
      navigate('/app', { replace: true });
      return;
    }
    (async () => {
      try {
        const res = await api.mfaStart();
        setData(res);
      } catch (err) {
        setError(err.message || 'Could not start MFA setup.');
      }
    })();
  }, [mfaEnrolled, navigate]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setConfirmBusy(true);
    try {
      await api.mfaConfirm(code.trim());
      await onMfaEnrolled();
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message || 'Verification failed.');
    } finally {
      setConfirmBusy(false);
    }
  }

  if (!data) {
    return error ? (
      <div className="page"><ErrorBanner message={error} /></div>
    ) : <Loading label="Preparing your authenticator…" />;
  }

  return (
    <div className="page stack-lg mfa-setup">
      <div className="topbar">
        <div>
          <div className="page-crumb">Account · Security</div>
          <div className="page-title">Set up two-factor authentication</div>
        </div>
      </div>

      <div className="info-banner">
        Two-factor authentication is required on every account. Finish this once and you'll
        only enter a 6-digit code from your authenticator app on each sign-in afterwards.
      </div>

      <div className="card card-pad mfa-step">
        <div className="mfa-step-num">1</div>
        <div className="mfa-step-body">
          <div className="mfa-step-h">Add the account to your authenticator</div>
          <p className="mfa-step-d">
            Scan the QR with Google Authenticator, 1Password, Authy, or any TOTP app.
            Can't scan? Type the secret in manually.
          </p>
          <div className="mfa-qr-row">
            <img className="mfa-qr" src={data.qr_data_uri} alt="MFA QR code" />
            <div>
              <div className="cell-sub">Secret (manual entry)</div>
              <div className="mfa-secret">{data.secret_base32}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad mfa-step">
        <div className="mfa-step-num">2</div>
        <div className="mfa-step-body">
          <div className="mfa-step-h">Save your backup codes</div>
          <p className="mfa-step-d">
            Each code can be used once if you lose access to your authenticator app.
            Print them, paste them into your password manager, or otherwise store them
            offline. They will not be shown again.
          </p>
          <ul className="mfa-codes">
            {data.backup_codes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <label className="check-row" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>I have saved my backup codes somewhere safe.</span>
          </label>
        </div>
      </div>

      <form className="card card-pad mfa-step" onSubmit={submit}>
        <div className="mfa-step-num">3</div>
        <div className="mfa-step-body">
          <div className="mfa-step-h">Enter the first 6-digit code</div>
          <p className="mfa-step-d">
            Open your authenticator and type the current code. This confirms the secret
            transferred correctly.
          </p>
          <ErrorBanner message={error} />
          <div className="field" style={{ maxWidth: 220 }}>
            <input
              className="input mfa-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123 456"
              required
            />
          </div>
          <button
            className="btn btn-primary"
            disabled={confirmBusy || !acknowledged}
            title={!acknowledged ? 'Confirm you have saved your backup codes first' : ''}
          >
            {confirmBusy ? 'Verifying…' : 'Finish setup'}
          </button>
        </div>
      </form>
    </div>
  );
}
