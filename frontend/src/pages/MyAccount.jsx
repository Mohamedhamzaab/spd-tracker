// ---------------------------------------------------------------------------
//  My Account. Read-only profile + entry points for changing password and
//  managing MFA backup codes.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { Section, Loading, fmtDate, Pill, Modal, useToast } from '../components/ui.jsx';

const ROLE_LABEL = {
  super_admin: 'Super-admin',
  admin: 'Admin',
  reviewer: 'Reviewer',
};
const ROLE_TONE = {
  super_admin: 'navy',
  admin: 'green',
  reviewer: 'grey',
};

export default function MyAccount() {
  const { user, onBackupCodesRegenerated } = useStore();
  const toast = useToast();
  const [meta, setMeta] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [newCodes, setNewCodes] = useState(null);

  async function reload() {
    try {
      const me = await api.me();
      setMeta(me);
    } catch {
      setMeta({ user });
    }
  }
  useEffect(() => { reload(); }, [user]);

  async function regenerate() {
    setRegenerating(true);
    try {
      const res = await api.mfaRegenerateBackup();
      setNewCodes(res.backup_codes);
      onBackupCodesRegenerated(res.backup_codes);
      toast('Backup codes regenerated.');
      reload();
    } catch (err) {
      toast(err.message || 'Failed to regenerate codes.');
    } finally {
      setRegenerating(false);
    }
  }

  if (!meta) return <Loading label="Loading your account" />;

  const remaining = meta.backup_codes_remaining || 0;
  const mfaEnrolled = !!meta.mfa_enrolled;
  const tone = remaining === 0 ? 'red' : remaining <= 2 ? 'amber' : 'green';

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Account</div>
          <div className="page-title">My account</div>
        </div>
      </div>

      <div className="page stack-lg">
        <div className="card card-pad">
          <Section title="Profile" />
          <div className="detail-grid">
            <div className="detail-item">
              <div className="dl">Name</div>
              <div className="dv">{user.name}</div>
            </div>
            <div className="detail-item">
              <div className="dl">Email</div>
              <div className="dv mono">{user.email}</div>
            </div>
            <div className="detail-item">
              <div className="dl">Role</div>
              <div className="dv">
                <Pill tone={ROLE_TONE[user.role] || 'grey'}>
                  {ROLE_LABEL[user.role] || user.role}
                </Pill>
              </div>
            </div>
            <div className="detail-item">
              <div className="dl">Organisation</div>
              <div className="dv">{user.organisation || '—'}</div>
            </div>
            <div className="detail-item">
              <div className="dl">Last sign-in</div>
              <div className="dv">{meta.last_login_at ? fmtDate(meta.last_login_at) : '—'}</div>
            </div>
            <div className="detail-item">
              <div className="dl">MFA</div>
              <div className="dv">
                {mfaEnrolled ? (
                  <Pill tone="green">Enrolled {meta.mfa_enrolled_at ? `· ${fmtDate(meta.mfa_enrolled_at)}` : ''}</Pill>
                ) : (
                  <Pill tone="amber">Not enrolled</Pill>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <Section title="Password" />
          <Link to="/app/change-password" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
            Change password
          </Link>
        </div>

        <div className="card card-pad">
          <Section title="Two-factor authentication" />
          {!mfaEnrolled ? (
            <>
              <p className="cell-sub" style={{ marginBottom: 12 }}>
                MFA is required on every account.
              </p>
              <Link to="/app/mfa-setup" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                Set up MFA
              </Link>
            </>
          ) : (
            <>
              <div className="mfa-summary">
                <div>
                  <div className="dl">Backup codes remaining</div>
                  <div className="dv">
                    <Pill tone={tone}>{remaining} of 8</Pill>
                  </div>
                </div>
                <button
                  className="btn"
                  onClick={regenerate}
                  disabled={regenerating}
                >
                  {regenerating ? 'Generating…' : 'Regenerate backup codes'}
                </button>
              </div>
              <p className="cell-sub" style={{ marginTop: 12 }}>
                Regenerating replaces all eight codes. Old codes stop working immediately.
              </p>
            </>
          )}
        </div>
      </div>

      {newCodes && (
        <Modal
          title="New backup codes"
          sub="Save these somewhere safe. They won't be shown again."
          onClose={() => setNewCodes(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setNewCodes(null)}>
              I have saved them
            </button>
          }
        >
          <ul className="mfa-codes">
            {newCodes.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </Modal>
      )}
    </>
  );
}
