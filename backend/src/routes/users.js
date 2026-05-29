// ---------------------------------------------------------------------------
//  Users — account management surface, super-admin only.
//
//  GET    /api/users                 list every account
//  POST   /api/users                 invite a new account (emails an
//                                    invite link; user sets their own
//                                    password via /accept-invite)
//  POST   /api/users/:id/resend-invite reissue the invite link
//  PATCH  /api/users/:id             change role / organisation / name /
//                                    is_disabled
//  POST   /api/users/:id/force-reset bump token_version (kicks user out of
//                                    every device) and email a reset link
//  POST   /api/users/:id/clear-mfa   wipe TOTP enrollment
//  DELETE /api/users/:id             delete account (refused if last
//                                    super_admin or self)
// ---------------------------------------------------------------------------
const express = require('express');
const { query } = require('../db');
const { wrap, httpError } = require('../helpers');
const { requireSuperAdmin } = require('../auth');
const tokens = require('../tokens');
const mail = require('../mail');
const { logAudit } = require('../audit');

const ROLES = new Set(['super_admin', 'admin', 'reviewer']);

const router = express.Router();
router.use(requireSuperAdmin);

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    organisation: u.organisation,
    is_disabled: u.is_disabled,
    has_password: !!u.password_hash,
    mfa_enrolled: !!u.mfa_enrolled_at,
    invited_at: u.invited_at,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
  };
}

// Guard against operations that would erase the only active super-admin.
async function assertNotLastSuperAdmin(targetId, message) {
  const others = await query(
    `SELECT COUNT(*)::int AS n FROM users
     WHERE role = 'super_admin' AND is_disabled = FALSE AND id <> $1`,
    [targetId]
  );
  if (others.rows[0].n === 0) {
    throw httpError(400, message);
  }
}

router.get(
  '/',
  wrap(async (_req, res) => {
    const { rows } = await query(
      `SELECT id, name, email, role, organisation, is_disabled,
              password_hash, mfa_enrolled_at, invited_at, last_login_at, created_at
       FROM users
       ORDER BY role, name`
    );
    res.json({ users: rows.map(publicUser) });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const role = (req.body.role || '').trim();
    const organisation = (req.body.organisation || '').trim() || null;
    if (!name || !email) throw httpError(400, 'Name and email are required.');
    if (!ROLES.has(role)) throw httpError(400, 'Role must be super_admin, admin, or reviewer.');

    const exists = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows[0]) throw httpError(409, 'A user with that email already exists.');

    // Invite-pending account: no password yet.
    const { rows } = await query(
      `INSERT INTO users
         (name, email, role, organisation,
          password_must_change, invited_by, invited_at)
       VALUES ($1,$2,$3,$4, TRUE, $5, now())
       RETURNING id, name, email, role, organisation, is_disabled,
                 password_hash, mfa_enrolled_at, invited_at, last_login_at, created_at`,
      [name, email, role, organisation, req.user.id]
    );
    const created = rows[0];

    const token = await tokens.issue(created.id, 'invite');
    try {
      await mail.sendInvite({
        to: created.email,
        name: created.name,
        token,
        invitedByName: req.user.name,
      });
    } catch (err) {
      console.error('[users] invite mail failed:', err.message);
    }

    await logAudit({
      actor_id: req.user.id,
      event: 'invite.sent',
      target_type: 'user',
      target_id: created.id,
      payload: { email: created.email, role: created.role },
      req,
    });

    res.status(201).json({
      user: publicUser(created),
      mail: mail.describe(),
    });
  })
);

router.post(
  '/:id/resend-invite',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    const { rows } = await query('SELECT id, name, email, password_hash FROM users WHERE id = $1', [id]);
    const u = rows[0];
    if (!u) throw httpError(404, 'User not found.');
    if (u.password_hash) throw httpError(400, 'This user has already accepted their invitation.');

    const token = await tokens.issue(u.id, 'invite');
    try {
      await mail.sendInvite({
        to: u.email,
        name: u.name,
        token,
        invitedByName: req.user.name,
      });
    } catch (err) {
      console.error('[users] resend invite mail failed:', err.message);
    }
    await logAudit({
      actor_id: req.user.id,
      event: 'invite.sent',
      target_type: 'user',
      target_id: u.id,
      payload: { email: u.email, resend: true },
      req,
    });
    res.json({ ok: true });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');

    const current = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (!current.rows[0]) throw httpError(404, 'User not found.');
    const u = current.rows[0];

    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.organisation !== undefined)
      patch.organisation = String(req.body.organisation).trim() || null;
    if (req.body.role !== undefined) {
      if (!ROLES.has(req.body.role)) throw httpError(400, 'Invalid role.');
      patch.role = req.body.role;
    }
    if (req.body.is_disabled !== undefined) {
      patch.is_disabled = !!req.body.is_disabled;
    }

    // Don't allow super-admins to disable or downgrade themselves out of
    // existence.
    if (u.role === 'super_admin' &&
        ((patch.role && patch.role !== 'super_admin') || patch.is_disabled === true)) {
      await assertNotLastSuperAdmin(
        id,
        'Cannot downgrade or disable the only active super-admin.'
      );
    }
    if (id === req.user.id && patch.is_disabled === true) {
      throw httpError(400, 'Cannot disable your own account.');
    }

    if (Object.keys(patch).length === 0) {
      return res.json({ user: publicUser(u) });
    }

    const sets = [];
    const args = [];
    Object.entries(patch).forEach(([k, v], i) => {
      sets.push(`${k} = $${i + 1}`);
      args.push(v);
    });
    args.push(id);

    if (patch.is_disabled === true || patch.role !== undefined) {
      sets.push(`token_version = token_version + 1`);
    }

    const { rows } = await query(
      `UPDATE users SET ${sets.join(', ')}
       WHERE id = $${args.length}
       RETURNING id, name, email, role, organisation, is_disabled,
                 password_hash, mfa_enrolled_at, invited_at, last_login_at, created_at`,
      args
    );

    // Audit the meaningful state changes.
    if (patch.role !== undefined && patch.role !== u.role) {
      await logAudit({
        actor_id: req.user.id,
        event: 'user.role_changed',
        target_type: 'user',
        target_id: id,
        payload: { from: u.role, to: patch.role },
        req,
      });
    }
    if (patch.is_disabled !== undefined && patch.is_disabled !== u.is_disabled) {
      await logAudit({
        actor_id: req.user.id,
        event: patch.is_disabled ? 'user.disabled' : 'user.enabled',
        target_type: 'user',
        target_id: id,
        req,
      });
    }

    res.json({ user: publicUser(rows[0]) });
  })
);

router.post(
  '/:id/force-reset',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    if (id === req.user.id) {
      throw httpError(400, 'Use Change Password to reset your own account.');
    }
    const { rows } = await query('SELECT id, name, email FROM users WHERE id = $1', [id]);
    const u = rows[0];
    if (!u) throw httpError(404, 'User not found.');

    await query(
      `UPDATE users
       SET password_must_change = TRUE,
           token_version = token_version + 1,
           failed_login_count = 0,
           locked_until = NULL
       WHERE id = $1`,
      [id]
    );

    const token = await tokens.issue(id, 'reset');
    try {
      await mail.sendPasswordReset({ to: u.email, name: u.name, token });
    } catch (err) {
      console.error('[users] force-reset mail failed:', err.message);
    }

    await logAudit({
      actor_id: req.user.id,
      event: 'user.force_reset',
      target_type: 'user',
      target_id: id,
      req,
    });

    res.json({ ok: true });
  })
);

router.post(
  '/:id/clear-mfa',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    const { rows } = await query(
      `UPDATE users
       SET mfa_secret_enc = NULL,
           mfa_enrolled_at = NULL,
           mfa_backup_codes = NULL,
           token_version = token_version + 1
       WHERE id = $1
       RETURNING id`,
      [id]
    );
    if (!rows[0]) throw httpError(404, 'User not found.');
    await logAudit({
      actor_id: req.user.id,
      event: 'mfa.cleared',
      target_type: 'user',
      target_id: id,
      req,
    });
    res.json({ ok: true });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    if (id === req.user.id) throw httpError(400, 'Cannot delete your own account.');

    const target = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (!target.rows[0]) throw httpError(404, 'User not found.');

    if (target.rows[0].role === 'super_admin') {
      await assertNotLastSuperAdmin(id, 'Cannot delete the only active super-admin.');
    }

    await query('DELETE FROM users WHERE id = $1', [id]);
    await logAudit({
      actor_id: req.user.id,
      event: 'user.deleted',
      target_type: 'user',
      target_id: id,
      payload: { email: target.rows[0].email },
      req,
    });
    res.json({ ok: true });
  })
);

module.exports = router;
