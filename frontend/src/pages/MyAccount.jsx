// ---------------------------------------------------------------------------
//  My Account. Read-only profile + entry points for changing password and
//  managing MFA backup codes.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { Section, Loading, fmtDate, Pill, Modal, useToast } from '../components/ui.jsx';
import { setLanguage } from '../lib/i18n.js';
import { getTheme, setTheme } from '../lib/theme.js';

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
  const { t, i18n } = useTranslation();
  const { user, onBackupCodesRegenerated } = useStore();
  const toast = useToast();
  const [meta, setMeta] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [newCodes, setNewCodes] = useState(null);
  const [theme, setThemeState] = useState(getTheme());
  const [devices, setDevices] = useState([]);

  function changeTheme(next) {
    setTheme(next);
    setThemeState(next);
  }

  async function reload() {
    try {
      const me = await api.me();
      setMeta(me);
    } catch {
      setMeta({ user });
    }
    try {
      setDevices(await api.trustedDevices());
    } catch {
      setDevices([]);
    }
  }
  useEffect(() => { reload(); }, [user]);

  async function revokeDevice(id) {
    try {
      await api.revokeTrustedDevice(id);
      setDevices((ds) => ds.filter((d) => d.id !== id));
      toast('Device removed — it will require MFA next time.');
    } catch (err) {
      toast(err.message || 'Could not remove the device.');
    }
  }

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
  const mfaExempt = !!meta.mfa_exempt;
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
                {mfaExempt ? (
                  <Pill tone="grey">Exempt</Pill>
                ) : mfaEnrolled ? (
                  <Pill tone="green">Enrolled {meta.mfa_enrolled_at ? `· ${fmtDate(meta.mfa_enrolled_at)}` : ''}</Pill>
                ) : (
                  <Pill tone="amber">Not enrolled</Pill>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <Section title={t('language.label')} />
          <div className="mfa-summary">
            <div>
              <div className="dl">{t('language.label')}</div>
              <div className="dv cell-sub">
                {i18n.language === 'ar' ? t('language.ar') : t('language.en')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={'btn ' + (i18n.language === 'en' ? 'btn-primary' : '')}
                onClick={() => setLanguage('en')}
              >
                {t('language.en')}
              </button>
              <button
                className={'btn ' + (i18n.language === 'ar' ? 'btn-primary' : '')}
                onClick={() => setLanguage('ar')}
              >
                {t('language.ar')}
              </button>
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <Section title="Appearance" />
          <div className="mfa-summary">
            <div>
              <div className="dl">Theme</div>
              <div className="dv cell-sub">{theme === 'dark' ? 'Dark' : 'Light'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={'btn ' + (theme === 'light' ? 'btn-primary' : '')}
                onClick={() => changeTheme('light')}
              >
                Light
              </button>
              <button
                className={'btn ' + (theme === 'dark' ? 'btn-primary' : '')}
                onClick={() => changeTheme('dark')}
              >
                Dark
              </button>
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
          {mfaExempt ? (
            <p className="cell-sub">
              This account is exempt from two-factor authentication — you sign in
              with your username and password only. Contact a super-admin if this
              should change.
            </p>
          ) : !mfaEnrolled ? (
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

        <div className="card card-pad">
          <Section
            title="Trusted devices"
            note="Browsers that skip MFA for 30 days"
          />
          {devices.length === 0 ? (
            <p className="cell-sub">
              No trusted devices. Tick “Trust this device” on the sign-in screen to skip MFA on a browser you use regularly.
            </p>
          ) : (
            <div className="device-list">
              {devices.map((d) => (
                <div className="device-row" key={d.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="device-name">
                      {d.label || 'Device'}
                      {d.current && <Pill tone="green">This device</Pill>}
                    </div>
                    <div className="cell-sub">
                      Last used {fmtDate(d.last_used)} · expires {fmtDate(d.expires)}
                      {d.ip ? ` · ${d.ip}` : ''}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-ghost" onClick={() => revokeDevice(d.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="cell-sub" style={{ marginTop: 12 }}>
            Changing your password removes all trusted devices.
          </p>
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
