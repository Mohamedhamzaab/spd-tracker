// ---------------------------------------------------------------------------
//  Users — super-admin only. List every account, invite new ones, change
//  role, disable, force a password reset, clear MFA, or delete.
//  Invitation emails arrive in milestone 2b; for now the API returns a
//  temporary password the super-admin shares manually.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Section,
  Empty,
  ErrorBanner,
  Loading,
  Modal,
  Pill,
  ConfirmDialog,
  useToast,
  fmtDate,
  useTableSort,
  SortableTH,
} from '../components/ui.jsx';

const ROLE_RANK = { super_admin: 0, admin: 1, reviewer: 2 };

function userStatusRank(u) {
  if (u.is_disabled) return 2;             // Disabled
  if (!u.has_password) return 1;           // Invite pending
  return 0;                                // Active
}

const USER_COLS = {
  name:          { value: (u) => u.name },
  email:         { value: (u) => u.email },
  role:          { value: (u) => ROLE_RANK[u.role] ?? 99, type: 'number' },
  organisation:  { value: (u) => u.organisation || '' },
  mfa_enrolled:  { value: (u) => (u.mfa_enrolled ? 0 : 1), type: 'number' },
  last_login_at: { value: (u) => u.last_login_at, type: 'date', defaultDir: 'desc' },
  status:        { value: (u) => userStatusRank(u), type: 'number' },
};

function describeMail(m) {
  if (!m) return '';
  // brevo-http and smtp both mean the email was actually dispatched.
  if (m.mode === 'brevo-http' || m.mode === 'smtp') return 'Invitation email sent.';
  // console mode = dev / no creds: link only in server logs.
  return 'Invitation logged to the backend console (no email transport configured).';
}

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

export default function Users() {
  const { user: me } = useStore();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [settingPw, setSettingPw] = useState(null);

  async function reload() {
    setError('');
    try {
      const data = await api.users();
      setRows(data.users);
    } catch (err) {
      setError(err.message || 'Failed to load users.');
    }
  }
  useEffect(() => {
    reload();
  }, []);

  async function onInvite(values) {
    try {
      const data = await api.createUser(values);
      setShowInvite(false);
      reload();
      if (data.email_sent) {
        toast(`${data.user.email} invited. ${describeMail(data.mail)}`);
      } else if (data.mail && data.mail.mode === 'console') {
        toast(`${data.user.email} created. ${describeMail(data.mail)}`);
      } else {
        // Account created, but the email bounced/was rejected. Make it loud.
        setError(
          `${data.user.email} was created (invite-pending), but the invitation email could NOT be delivered`
          + (data.email_error ? `: ${data.email_error}` : '.')
          + ' Check the address, or use "Resend invite". Corporate domains often need ecgportal.dev authenticated (SPF/DKIM/DMARC).'
        );
      }
    } catch (err) {
      throw new Error(err.message || 'Invite failed.');
    }
  }

  async function onResendInvite(id) {
    setError('');
    try {
      const r = await api.resendInvite(id);
      if (r.email_sent) toast('Invitation resent.');
      else setError(
        'The invitation email could NOT be delivered'
        + (r.email_error ? `: ${r.email_error}` : '.')
        + ' The address may be rejecting mail from ecgportal.dev (SPF/DKIM/DMARC not yet set).'
      );
    } catch (err) {
      setError(err.message || 'Failed to resend invitation.');
    }
  }

  async function onEditSave(id, values) {
    try {
      await api.updateUser(id, values);
      toast('User updated.');
      setEditing(null);
      reload();
    } catch (err) {
      throw new Error(err.message || 'Update failed.');
    }
  }

  async function onForceReset(id) {
    try {
      await api.forceResetUser(id);
      toast('Reset triggered. Existing sessions revoked.');
      reload();
    } catch (err) {
      setError(err.message || 'Failed.');
    }
  }

  async function onClearMfa(id) {
    try {
      await api.clearUserMfa(id);
      toast('MFA cleared.');
      reload();
    } catch (err) {
      setError(err.message || 'Failed.');
    }
  }

  async function onDelete(id) {
    try {
      await api.deleteUser(id);
      toast('User deleted.');
      setConfirming(null);
      reload();
    } catch (err) {
      setError(err.message || 'Delete failed.');
      setConfirming(null);
    }
  }

  const { sorted, sortKey, sortDir, onSort } = useTableSort(rows || [], USER_COLS, {
    defaultKey: 'role',
    defaultDir: 'asc',
  });

  if (!rows) return <Loading label="Loading users" />;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Account management</div>
          <div className="page-title">Users</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowInvite(true)}>
          Invite user
        </button>
      </div>

      <div className="page stack-lg">
        <ErrorBanner message={error} />

        <Section title="All accounts" note={`${rows.length} total`} />
        {rows.length === 0 ? (
          <Empty title="No accounts yet" sub="Invite the first user above." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortableTH id="name"          sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Name</SortableTH>
                  <SortableTH id="email"         sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Email</SortableTH>
                  <SortableTH id="role"          sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Role</SortableTH>
                  <SortableTH id="organisation"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Organisation</SortableTH>
                  <SortableTH id="mfa_enrolled"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>MFA</SortableTH>
                  <SortableTH id="last_login_at" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Last sign-in</SortableTH>
                  <SortableTH id="status"        sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Status</SortableTH>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => {
                  const isSelf = u.id === me.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="cell-strong">{u.name}</div>
                        {isSelf && <div className="cell-sub">You</div>}
                      </td>
                      <td className="mono">{u.email}</td>
                      <td>
                        <Pill tone={ROLE_TONE[u.role] || 'grey'}>
                          {ROLE_LABEL[u.role] || u.role}
                        </Pill>
                      </td>
                      <td>{u.organisation || '—'}</td>
                      <td>
                        {u.mfa_exempt ? (
                          <Pill tone="grey">Exempt</Pill>
                        ) : u.mfa_enrolled ? (
                          <Pill tone="green">Enrolled</Pill>
                        ) : (
                          <Pill tone="amber">Not enrolled</Pill>
                        )}
                      </td>
                      <td>{u.last_login_at ? fmtDate(u.last_login_at) : '—'}</td>
                      <td>
                        {u.is_disabled ? (
                          <Pill tone="red">Disabled</Pill>
                        ) : !u.has_password ? (
                          <Pill tone="amber">Invite pending</Pill>
                        ) : (
                          <Pill tone="grey">Active</Pill>
                        )}
                      </td>
                      <td className="num">
                        <div className="row-actions">
                          <button className="btn btn-ghost" onClick={() => setEditing(u)}>
                            Edit
                          </button>
                          {!u.has_password && (
                            <button className="btn btn-ghost" onClick={() => onResendInvite(u.id)}>
                              Resend invite
                            </button>
                          )}
                          <button
                            className="btn btn-ghost"
                            onClick={() => setSettingPw(u)}
                            disabled={isSelf}
                            title={isSelf ? 'Use Change Password on your own account'
                              : 'Generate a temporary password to hand over (no email)'}
                          >
                            Set password
                          </button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => onForceReset(u.id)}
                            disabled={isSelf}
                            title={isSelf ? 'Use Change Password on your own account' : ''}
                          >
                            Force reset
                          </button>
                          {u.mfa_enrolled && (
                            <button className="btn btn-ghost" onClick={() => onClearMfa(u.id)}>
                              Clear MFA
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-danger"
                            onClick={() => setConfirming(u)}
                            disabled={isSelf}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} onSubmit={onInvite} />
      )}
      {editing && (
        <EditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSubmit={(v) => onEditSave(editing.id, v)}
        />
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete user?"
          message={`This permanently removes ${confirming.name} (${confirming.email}).`}
          confirmLabel="Delete"
          onClose={() => setConfirming(null)}
          onConfirm={() => onDelete(confirming.id)}
        />
      )}
      {settingPw && (
        <SetPasswordModal
          user={settingPw}
          onClose={() => setSettingPw(null)}
          onDone={() => { setSettingPw(null); reload(); }}
        />
      )}
    </>
  );
}

// Two-phase modal: confirm → generate a temporary password, then reveal it once
// with a copy button and the security caveats. The password is shown only here;
// it is never emailed or stored in readable form.
function SetPasswordModal({ user, onClose, onDone }) {
  const toast = useToast();
  const [phase, setPhase] = useState('confirm'); // confirm | done
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  async function generate() {
    setErr('');
    setBusy(true);
    try {
      const r = await api.setTempPassword(user.id);
      setPassword(r.temp_password);
      setPhase('done');
    } catch (e) {
      setErr(e.message || 'Could not set a temporary password.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast('Password copied.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr('Copy failed — select the password and copy it manually.');
    }
  }

  if (phase === 'confirm') {
    return (
      <Modal
        title="Set a temporary password"
        sub={`${user.name} · ${user.email}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" onClick={generate} disabled={busy}>
              {busy ? 'Generating…' : 'Generate password'}
            </button>
          </>
        }
      >
        <ErrorBanner message={err} />
        <div className="stack" style={{ fontSize: 13, lineHeight: 1.55 }}>
          <p>This generates a one-time password you hand over yourself — no email is sent. Use it for accounts whose organisation blocks our invitation mail.</p>
          <p>On first sign-in the user must <strong>change this password</strong> and <strong>set up two-factor authentication</strong> before they can see anything. Any pending invite link is invalidated.</p>
          <p className="cell-sub">Deliver the password by phone or in person — not by email or group chat.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Temporary password ready"
      sub={`${user.name} · ${user.email}`}
      onClose={onDone}
      footer={<button className="btn btn-primary" onClick={onDone}>Done</button>}
    >
      <ErrorBanner message={err} />
      <div className="stack" style={{ fontSize: 13, lineHeight: 1.55 }}>
        <div className="field">
          <label className="field-label">Temporary password</label>
          <div className="temp-pw">
            <code className="temp-pw-value">{password}</code>
            <button className="btn btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
        <div className="info-banner">
          <strong>Shown once.</strong> Copy it now — you won't be able to see it again.
          Give it to <strong>{user.name}</strong> by phone or in person, and have them sign in to
          set their own password and two-factor authentication.
        </div>
      </div>
    </Modal>
  );
}

function InviteModal({ onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('reviewer');
  const [organisation, setOrganisation] = useState('');
  const [mfaExempt, setMfaExempt] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await onSubmit({ name, email, role, organisation, mfa_exempt: mfaExempt });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Invite a new user"
      sub="They will receive an email with a one-time link to set their password. The link expires after 72 hours."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Inviting…' : 'Invite'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        <ErrorBanner message={err} />
        <div className="field">
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field-label">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="field-label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="reviewer">Reviewer (read-only)</option>
            <option value="admin">Admin (writes data)</option>
            <option value="super_admin">Super-admin (manages accounts)</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">Organisation</label>
          <input
            className="input"
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            placeholder="ECG, Egis, Safari Park Doha, …"
          />
        </div>
        <div className="field">
          <label className="check-row">
            <input
              type="checkbox"
              checked={mfaExempt}
              onChange={(e) => setMfaExempt(e.target.checked)}
            />
            <span>Exempt from two-factor authentication</span>
          </label>
          <div className="field-help">
            For internal SPD staff only. The account signs in with just a
            username and password from the very first login — no authenticator
            app. Pair this with “Set password” for accounts whose organisation
            blocks our invitation email.
          </div>
        </div>
      </form>
    </Modal>
  );
}

function EditModal({ user, onClose, onSubmit }) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [organisation, setOrganisation] = useState(user.organisation || '');
  const [isDisabled, setIsDisabled] = useState(!!user.is_disabled);
  const [mfaExempt, setMfaExempt] = useState(!!user.mfa_exempt);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await onSubmit({ name, role, organisation, is_disabled: isDisabled, mfa_exempt: mfaExempt });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Edit ${user.email}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        <ErrorBanner message={err} />
        <div className="field">
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="reviewer">Reviewer (read-only)</option>
            <option value="admin">Admin (writes data)</option>
            <option value="super_admin">Super-admin (manages accounts)</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">Organisation</label>
          <input
            className="input"
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="check-row">
            <input
              type="checkbox"
              checked={isDisabled}
              onChange={(e) => setIsDisabled(e.target.checked)}
            />
            <span>Disabled (cannot sign in)</span>
          </label>
        </div>
        <div className="field">
          <label className="check-row">
            <input
              type="checkbox"
              checked={mfaExempt}
              onChange={(e) => setMfaExempt(e.target.checked)}
            />
            <span>Exempt from two-factor authentication</span>
          </label>
          <div className="field-help">
            For internal SPD staff only. They sign in with just their username
            and password — no authenticator app. Leaves the account protected
            by password, lockout and rate-limiting, but with no second factor.
          </div>
        </div>
      </form>
    </Modal>
  );
}
