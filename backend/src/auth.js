// ---------------------------------------------------------------------------
//  Authentication.
//
//  Roles
//    super_admin  manages user accounts (invite, change role, disable, reset)
//    admin        may write data
//    reviewer     read-only
//
//  Tokens carry a token_version that matches the users row. Bumping the row
//  version (e.g. on password reset) invalidates every previously-issued JWT
//  for that user.
//
//  Endpoints under this router
//    POST   /api/auth/login            email + password → JWT
//    GET    /api/auth/me               current session
//    POST   /api/auth/forgot-password  email → triggers reset email
//    POST   /api/auth/reset-password   token + new_password
//    POST   /api/auth/accept-invite    token + new_password (first sign-in)
//    POST   /api/auth/change-password  current + new (signed-in user)
// ---------------------------------------------------------------------------
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('./db');
const { wrap, httpError } = require('./helpers');
const tokens = require('./tokens');
const mail = require('./mail');
const { logAudit } = require('./audit');
const { loginLimiter, forgotLimiter, tokenLimiter } = require('./rateLimit');
const mfa = require('./mfa');
const { encrypt, decrypt } = require('./crypto');
const trustedDevices = require('./trustedDevices');

// Per-user lockout policy.
const LOCKOUT_THRESHOLD = 5;          // wrong passwords before we lock
const LOCKOUT_MINUTES = 15;           // for how long

// Short-lived JWT issued between password verify and MFA verify.
const MFA_CHALLENGE_TTL = '5m';

// JWT secret. In production the env var is required; in dev we fall back to
// a fixed development secret with a clear warning.
const DEV_SECRET = 'insecure-development-secret';
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (process.env.NODE_ENV === 'production') {
    // Fail loudly at boot, before any token is issued or accepted.
    throw new Error('JWT_SECRET is required in production. Refusing to start.');
  }
  console.warn('[auth] JWT_SECRET not set — using a development fallback. Do NOT use in production.');
  SECRET = DEV_SECRET;
}
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LEN = 12;

// --- Password policy --------------------------------------------------------
// At least 12 characters, must mix at least three of:
// lowercase, uppercase, digit, symbol. Returns null when ok, a string when not.
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LEN) {
    return `Password must be at least ${MIN_PASSWORD_LEN} characters.`;
  }
  let classes = 0;
  if (/[a-z]/.test(pw)) classes += 1;
  if (/[A-Z]/.test(pw)) classes += 1;
  if (/[0-9]/.test(pw)) classes += 1;
  if (/[^A-Za-z0-9]/.test(pw)) classes += 1;
  if (classes < 3) {
    return 'Password must mix at least three of: lowercase, uppercase, digit, symbol.';
  }
  return null;
}

// --- Middleware -------------------------------------------------------------

// Verify the token on every request. Revalidates against the users row so
// that disabling an account, bumping token_version, or deleting the row all
// kick existing sessions on the next call.
//
// Tokens carry a `stage` claim:
//   stage = "session"        full session — issued after MFA verify (or
//                            during invite/enrollment where no MFA is set yet)
//   stage = "mfa_challenge"  intermediate, only accepted by /mfa/verify
//
// Tokens predating 2d have no stage claim; treat as "session" for back-compat.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(httpError(401, 'Sign in to continue.'));

    let payload;
    try {
      payload = jwt.verify(token, SECRET);
    } catch {
      return next(httpError(401, 'Your session has expired. Please sign in again.'));
    }

    if (payload.stage && payload.stage !== 'session') {
      return next(httpError(401, 'Finish signing in to continue.'));
    }

    const { rows } = await query(
      `SELECT id, name, email, role, organisation, token_version, is_disabled,
              password_must_change, mfa_enrolled_at, mfa_exempt
       FROM users WHERE id = $1`,
      [payload.id]
    );
    const fresh = rows[0];
    if (!fresh || fresh.is_disabled) {
      return next(httpError(401, 'Your account is no longer active.'));
    }
    if ((payload.token_version || 0) !== fresh.token_version) {
      return next(httpError(401, 'Your session was ended. Please sign in again.'));
    }

    req.user = {
      id: fresh.id,
      name: fresh.name,
      email: fresh.email,
      role: fresh.role,
      organisation: fresh.organisation,
      // Account-gate flags — read by requireClearedGates below. Kept off the
      // public user object the routes return.
      password_must_change: !!fresh.password_must_change,
      mfa_enrolled: !!fresh.mfa_enrolled_at,
      mfa_exempt: !!fresh.mfa_exempt,
    };
    next();
  } catch (err) {
    next(err);
  }
}

// Enforce the account gates server-side. The /api/auth/* router is mounted
// BEFORE the global requireAuth, so the endpoints that CLEAR these gates
// (change-password, mfa/start, mfa/confirm, me) are naturally exempt — this
// middleware only guards the data API under /api. Without it the gates were
// frontend-only: a held session token could still hit every endpoint.

function requireClearedGates(req, res, next) {
  if (!req.user) return next(httpError(401, 'Sign in to continue.'));
  if (req.user.password_must_change) {
    return next(httpError(403, 'You must change your password before continuing.'));
  }
  if (!req.user.mfa_enrolled && !req.user.mfa_exempt) {
    return next(httpError(403, 'You must finish setting up two-factor authentication before continuing.'));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(httpError(401, 'Sign in to continue.'));
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return next(httpError(403, 'This account has view-only access.'));
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user) return next(httpError(401, 'Sign in to continue.'));
  if (req.user.role !== 'super_admin') {
    return next(httpError(403, 'Only a super-admin may perform this action.'));
  }
  next();
}

const requireEditor = requireAdmin; // back-compat alias

function signSessionJwt(user) {
  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organisation: user.organisation,
    token_version: user.token_version || 0,
    stage: 'session',
  };
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function signMfaChallengeJwt(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      token_version: user.token_version || 0,
      stage: 'mfa_challenge',
    },
    SECRET,
    { expiresIn: MFA_CHALLENGE_TTL }
  );
}

// Back-compat alias for any older import.
const signJwt = signSessionJwt;

async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

// --- Router -----------------------------------------------------------------
const router = express.Router();

// POST /api/auth/login
router.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    if (!email || !password) {
      throw httpError(400, 'Enter an email and password.');
    }

    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || user.is_disabled || !user.password_hash) {
      await logAudit({
        event: 'login.failed',
        target_type: 'user',
        target_id: user?.id || null,
        payload: { email, reason: !user ? 'no_user' : user.is_disabled ? 'disabled' : 'no_password' },
        req,
      });
      throw httpError(401, 'Email or password is incorrect.');
    }

    // Short-circuit before bcrypt if the account is locked. We respond with
    // 423 Locked so the front end can render an explicit message. This does
    // leak that an email exists, but anyone hitting this branch already knew
    // the email — the rate limiter is what protects against guessing.
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minsLeft = Math.max(
        1,
        Math.ceil((new Date(user.locked_until) - new Date()) / 60000)
      );
      await logAudit({
        event: 'login.locked_attempt',
        target_type: 'user',
        target_id: user.id,
        payload: { email },
        req,
      });
      throw httpError(
        423,
        `Account temporarily locked due to repeated failed sign-ins. Try again in ${minsLeft} minute${minsLeft === 1 ? '' : 's'}, or use Forgot Password to reset.`
      );
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      // Increment failures atomically and lock when we cross the threshold.
      const { rows: bumped } = await query(
        `UPDATE users
         SET failed_login_count = failed_login_count + 1,
             locked_until = CASE
               WHEN failed_login_count + 1 >= $2
                 THEN now() + ($3 || ' minutes')::interval
               ELSE locked_until
             END
         WHERE id = $1
         RETURNING failed_login_count, locked_until`,
        [user.id, LOCKOUT_THRESHOLD, String(LOCKOUT_MINUTES)]
      );
      const justLocked = bumped[0].failed_login_count >= LOCKOUT_THRESHOLD;
      await logAudit({
        event: justLocked ? 'login.locked' : 'login.failed',
        target_type: 'user',
        target_id: user.id,
        payload: { email, reason: 'bad_password', attempts: bumped[0].failed_login_count },
        req,
      });
      if (justLocked) {
        throw httpError(
          423,
          `Account temporarily locked due to repeated failed sign-ins. Try again in ${LOCKOUT_MINUTES} minutes, or use Forgot Password to reset.`
        );
      }
      throw httpError(401, 'Email or password is incorrect.');
    }

    // Success — clear the failure counters.
    await query(
      `UPDATE users
       SET failed_login_count = 0,
           locked_until = NULL
       WHERE id = $1`,
      [user.id]
    );

    // An MFA-exempt account (internal SPD staff, approved by a super-admin)
    // never gets the second-factor step: a correct password yields a full
    // session straight away, and requireClearedGates lets it through.
    const mfaActive = !!user.mfa_enrolled_at && !user.mfa_exempt;

    // Two-step gate: if the user has finished MFA enrollment, we issue a
    // short-lived challenge token instead of a full session JWT. The full
    // session is minted by /mfa/verify once they prove the TOTP code.
    if (mfaActive) {
      // ...unless this browser is a trusted device for this user — then the
      // second factor was already proven here within the trust window, so go
      // straight to a full session.
      const trusted = await trustedDevices.findTrustedDevice(req, user.id);
      if (trusted) {
        await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
        await logAudit({
          actor_id: user.id,
          event: 'login.success_trusted_device',
          target_type: 'user',
          target_id: user.id,
          req,
        });
        const token = signSessionJwt(user);
        return res.json({
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            organisation: user.organisation,
          },
          password_must_change: !!user.password_must_change,
          mfa_enrolled: true,
          mfa_exempt: !!user.mfa_exempt,
        });
      }

      await logAudit({
        actor_id: user.id,
        event: 'login.password_ok',
        target_type: 'user',
        target_id: user.id,
        req,
      });
      const challenge_token = signMfaChallengeJwt(user);
      return res.json({
        mfa_required: true,
        challenge_token,
        email_hint: user.email,
      });
    }

    // No MFA enrolled yet — full session, but flag the client so it can
    // route the user to /app/mfa-setup. Until enrollment is confirmed the
    // session is functionally limited because every other login afterwards
    // will require the MFA step.
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await logAudit({
      actor_id: user.id,
      event: 'login.success',
      target_type: 'user',
      target_id: user.id,
      req,
    });

    const token = signSessionJwt(user);
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organisation: user.organisation,
      },
      password_must_change: !!user.password_must_change,
      mfa_enrolled: !!user.mfa_enrolled_at,
      mfa_exempt: !!user.mfa_exempt,
      // Exempt accounts skip enrolment entirely; everyone else must set it up.
      mfa_enrollment_required: !user.mfa_exempt,
    });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT id, name, email, role, organisation, password_must_change,
              mfa_enrolled_at, mfa_exempt, mfa_backup_codes, last_login_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    const u = rows[0];
    res.json({
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        organisation: u.organisation,
      },
      password_must_change: !!u.password_must_change,
      mfa_enrolled: !!u.mfa_enrolled_at,
      mfa_enrolled_at: u.mfa_enrolled_at,
      mfa_exempt: !!u.mfa_exempt,
      backup_codes_remaining: mfa.remainingBackupCodes(u.mfa_backup_codes),
      last_login_at: u.last_login_at,
    });
  })
);

// POST /api/auth/forgot-password — enumeration-safe (always 200).
router.post(
  '/forgot-password',
  forgotLimiter,
  wrap(async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) throw httpError(400, 'Enter an email address.');

    const { rows } = await query('SELECT id, name, email, is_disabled FROM users WHERE email = $1', [email]);
    const user = rows[0];

    await logAudit({
      event: 'password.forgot_requested',
      target_type: 'user',
      target_id: user?.id || null,
      payload: { email, found: !!user },
      req,
    });

    if (user && !user.is_disabled) {
      const token = await tokens.issue(user.id, 'reset');
      try {
        await mail.sendPasswordReset({ to: user.email, name: user.name, token });
      } catch (err) {
        console.error('[auth] reset mail failed:', err.message);
      }
    }
    // Always 200, regardless of whether the email existed.
    res.json({ ok: true });
  })
);

// POST /api/auth/reset-password — token + new password.
router.post(
  '/reset-password',
  tokenLimiter,
  wrap(async (req, res) => {
    const token = (req.body.token || '').trim();
    const password = req.body.password || '';
    if (!token) throw httpError(400, 'Reset token is missing.');
    const pwErr = checkPassword(password);
    if (pwErr) throw httpError(400, pwErr);

    const claim = await tokens.consume(token, 'reset');
    if (!claim) throw httpError(400, 'This reset link is invalid or has expired.');

    const hash = await hashPassword(password);
    await query(
      `UPDATE users
       SET password_hash = $1,
           password_must_change = FALSE,
           failed_login_count = 0,
           locked_until = NULL,
           token_version = token_version + 1
       WHERE id = $2`,
      [hash, claim.user_id]
    );
    // A password reset drops all trusted devices for that account.
    await trustedDevices.clearForUser(claim.user_id);

    await logAudit({
      actor_id: claim.user_id,
      event: 'password.reset_used',
      target_type: 'user',
      target_id: claim.user_id,
      req,
    });

    res.json({ ok: true });
  })
);

// POST /api/auth/accept-invite — first password set from an emailed invite.
router.post(
  '/accept-invite',
  tokenLimiter,
  wrap(async (req, res) => {
    const token = (req.body.token || '').trim();
    const password = req.body.password || '';
    if (!token) throw httpError(400, 'Invitation token is missing.');
    const pwErr = checkPassword(password);
    if (pwErr) throw httpError(400, pwErr);

    const claim = await tokens.consume(token, 'invite');
    if (!claim) throw httpError(400, 'This invitation is invalid or has expired.');

    const hash = await hashPassword(password);
    await query(
      `UPDATE users
       SET password_hash = $1,
           password_must_change = FALSE,
           failed_login_count = 0,
           locked_until = NULL,
           token_version = token_version + 1
       WHERE id = $2`,
      [hash, claim.user_id]
    );

    await logAudit({
      actor_id: claim.user_id,
      event: 'invite.accepted',
      target_type: 'user',
      target_id: claim.user_id,
      req,
    });

    res.json({ ok: true });
  })
);

// POST /api/auth/change-password — signed-in user changes their own password.
router.post(
  '/change-password',
  requireAuth,
  wrap(async (req, res) => {
    const current = req.body.current_password || '';
    const next = req.body.new_password || '';
    if (!current) throw httpError(400, 'Enter your current password.');
    const pwErr = checkPassword(next);
    if (pwErr) throw httpError(400, pwErr);
    if (current === next) {
      throw httpError(400, 'New password must differ from the current one.');
    }

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const u = rows[0];
    const ok = u?.password_hash && (await bcrypt.compare(current, u.password_hash));
    if (!ok) throw httpError(400, 'Current password is incorrect.');

    const hash = await hashPassword(next);
    await query(
      `UPDATE users
       SET password_hash = $1,
           password_must_change = FALSE,
           token_version = token_version + 1
       WHERE id = $2`,
      [hash, req.user.id]
    );
    // Changing the password drops all trusted devices — they re-do MFA next time.
    await trustedDevices.clearForUser(req.user.id);

    await logAudit({
      actor_id: req.user.id,
      event: 'password.changed',
      target_type: 'user',
      target_id: req.user.id,
      req,
    });

    // The token bump just invalidated the bearer the client is holding.
    // Mint a fresh one so they don't get bounced to /login mid-interaction.
    const { rows: refreshed } = await query(
      `SELECT id, name, email, role, organisation, token_version
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    const token = signJwt(refreshed[0]);
    res.json({ ok: true, token });
  })
);

// ---------------------------------------------------------------------------
//  MFA endpoints
// ---------------------------------------------------------------------------

// POST /api/auth/mfa/start — generate a fresh TOTP secret + backup codes,
// store them on the user (pending — mfa_enrolled_at stays NULL until the
// /confirm step). Returns the QR data URI and the plaintext backup codes
// to display ONCE. Calling start a second time overwrites the pending
// material, so partial enrollments self-clean.
router.post(
  '/mfa/start',
  requireAuth,
  wrap(async (req, res) => {
    const userRow = await query(
      'SELECT email, mfa_enrolled_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const u = userRow.rows[0];

    const secret = mfa.generateSecret();
    const backupCodes = mfa.generateBackupCodes();
    const hashedBackup = mfa.hashAll(backupCodes);
    const qr_data_uri = await mfa.qrDataUri(secret, u.email);

    await query(
      `UPDATE users
       SET mfa_secret_enc = $1,
           mfa_backup_codes = $2::jsonb,
           mfa_enrolled_at = NULL
       WHERE id = $3`,
      [encrypt(secret), JSON.stringify(hashedBackup), req.user.id]
    );

    res.json({
      secret_base32: secret,
      qr_data_uri,
      backup_codes: backupCodes,
      already_enrolled: !!u.mfa_enrolled_at,
    });
  })
);

// POST /api/auth/mfa/confirm — { code } — verify the first TOTP code and
// stamp mfa_enrolled_at. From here on every sign-in requires a code.
router.post(
  '/mfa/confirm',
  tokenLimiter, // throttle TOTP-code guessing during enrollment
  requireAuth,
  wrap(async (req, res) => {
    const code = (req.body.code || '').trim();
    if (!code) throw httpError(400, 'Enter the 6-digit code from your authenticator app.');

    const { rows } = await query(
      'SELECT mfa_secret_enc, mfa_enrolled_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const u = rows[0];
    if (!u || !u.mfa_secret_enc) {
      throw httpError(400, 'Start MFA enrollment first.');
    }
    if (u.mfa_enrolled_at) {
      // Already finalized; this endpoint is idempotent in spirit but we
      // don't want to silently accept a stale code.
      return res.json({ ok: true, already_enrolled: true });
    }

    const secret = decrypt(u.mfa_secret_enc);
    if (!mfa.verifyCode(secret, code)) {
      await logAudit({
        actor_id: req.user.id,
        event: 'mfa.confirm_failed',
        target_type: 'user',
        target_id: req.user.id,
        req,
      });
      throw httpError(400, 'That code is not valid. Try again.');
    }

    await query(
      `UPDATE users SET mfa_enrolled_at = now() WHERE id = $1`,
      [req.user.id]
    );
    await logAudit({
      actor_id: req.user.id,
      event: 'mfa.enrolled',
      target_type: 'user',
      target_id: req.user.id,
      req,
    });
    res.json({ ok: true });
  })
);

// POST /api/auth/mfa/verify — { challenge_token, code, is_backup? }
// Public route — accepts the challenge JWT from the login response and
// proves possession of the second factor. Returns a real session JWT.
router.post(
  '/mfa/verify',
  loginLimiter, // reuse the IP cap — same rate-limit window as login itself
  wrap(async (req, res) => {
    const challenge = req.body.challenge_token || '';
    const code = (req.body.code || '').trim();
    const isBackup = !!req.body.is_backup;
    if (!challenge || !code) {
      throw httpError(400, 'Enter your code to continue.');
    }

    let payload;
    try {
      payload = jwt.verify(challenge, SECRET);
    } catch {
      throw httpError(401, 'Your sign-in attempt has expired. Start again.');
    }
    if (payload.stage !== 'mfa_challenge') {
      throw httpError(401, 'Invalid challenge.');
    }

    const { rows } = await query(
      `SELECT id, name, email, role, organisation, token_version,
              is_disabled, mfa_secret_enc, mfa_enrolled_at, mfa_backup_codes
       FROM users WHERE id = $1`,
      [payload.id]
    );
    const user = rows[0];
    if (!user || user.is_disabled || !user.mfa_enrolled_at || !user.mfa_secret_enc) {
      throw httpError(401, 'Your sign-in attempt has expired. Start again.');
    }
    if ((payload.token_version || 0) !== user.token_version) {
      throw httpError(401, 'Your sign-in attempt has expired. Start again.');
    }

    let ok = false;
    let usedBackup = false;
    // Backup-code array as it stands after this verification, used at the
    // end for backup_codes_remaining without re-consuming.
    let backupArrAfter = user.mfa_backup_codes;
    if (isBackup) {
      const result = mfa.consumeBackupCode(user.mfa_backup_codes, code);
      if (result.ok) {
        ok = true;
        usedBackup = true;
        backupArrAfter = result.next;
        await query(
          'UPDATE users SET mfa_backup_codes = $1::jsonb WHERE id = $2',
          [JSON.stringify(result.next), user.id]
        );
      }
    } else {
      const secret = decrypt(user.mfa_secret_enc);
      ok = mfa.verifyCode(secret, code);
    }

    if (!ok) {
      await logAudit({
        actor_id: user.id,
        event: 'mfa.verify_failed',
        target_type: 'user',
        target_id: user.id,
        payload: { is_backup: isBackup },
        req,
      });
      throw httpError(401, 'That code is not valid.');
    }

    await query(
      `UPDATE users
       SET last_login_at = now(),
           failed_login_count = 0,
           locked_until = NULL
       WHERE id = $1`,
      [user.id]
    );

    await logAudit({
      actor_id: user.id,
      event: usedBackup ? 'mfa.backup_used' : 'mfa.verified',
      target_type: 'user',
      target_id: user.id,
      req,
    });
    await logAudit({
      actor_id: user.id,
      event: 'login.success',
      target_type: 'user',
      target_id: user.id,
      req,
    });

    // "Trust this device for 30 days" — opt-in. Remember this browser so the
    // next logins from it skip the second factor (until it expires/revoked).
    if (req.body.trust_device) {
      await trustedDevices.issueTrustCookie(res, req, user.id);
      await logAudit({
        actor_id: user.id,
        event: 'trusted_device.added',
        target_type: 'user',
        target_id: user.id,
        req,
      });
    }

    const token = signSessionJwt(user);
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organisation: user.organisation,
      },
      password_must_change: false,  // reset would have cleared this; safe default
      mfa_enrolled: true,
      backup_codes_remaining: mfa.remainingBackupCodes(backupArrAfter),
    });
  })
);

// --- Trusted devices management (signed-in user, own devices only) ----------
router.get(
  '/trusted-devices',
  requireAuth,
  wrap(async (req, res) => {
    res.json(await trustedDevices.listDevices(req, req.user.id));
  })
);
router.delete(
  '/trusted-devices/:id',
  requireAuth,
  wrap(async (req, res) => {
    await trustedDevices.revokeDevice(req.user.id, req.params.id);
    await logAudit({
      actor_id: req.user.id,
      event: 'trusted_device.revoked',
      target_type: 'user',
      target_id: req.user.id,
      payload: { device_id: Number(req.params.id) },
      req,
    });
    res.json({ ok: true });
  })
);

// POST /api/auth/mfa/regenerate-backup-codes — invalidates the old set and
// returns 8 fresh codes to display once.
router.post(
  '/mfa/regenerate-backup-codes',
  requireAuth,
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT mfa_enrolled_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0] || !rows[0].mfa_enrolled_at) {
      throw httpError(400, 'Finish MFA enrollment first.');
    }
    const codes = mfa.generateBackupCodes();
    await query(
      'UPDATE users SET mfa_backup_codes = $1::jsonb WHERE id = $2',
      [JSON.stringify(mfa.hashAll(codes)), req.user.id]
    );
    await logAudit({
      actor_id: req.user.id,
      event: 'mfa.codes_regenerated',
      target_type: 'user',
      target_id: req.user.id,
      req,
    });
    res.json({ backup_codes: codes });
  })
);

module.exports = {
  router,
  requireAuth,
  requireClearedGates,
  requireAdmin,
  requireSuperAdmin,
  requireEditor,
  signJwt,
  signSessionJwt,
  signMfaChallengeJwt,
  hashPassword,
  checkPassword,
  // Exported so stream.js shares one secret-resolution path (no dev fallback
  // divergence). Treat as read-only.
  JWT_SECRET: SECRET,
};
