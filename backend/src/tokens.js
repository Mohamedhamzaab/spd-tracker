// ---------------------------------------------------------------------------
//  Single-use auth tokens (invite + password reset).
//
//  The plaintext token is 32 random bytes encoded as URL-safe base64. Only
//  the SHA-256 hash is written to auth_tokens; the plaintext is emailed
//  once and never persisted.
//
//  - issue()  generates a fresh token and persists its hash
//  - verify() checks a token presented by the user and marks it used (atomic)
//  - revoke() clears outstanding tokens of a kind for a user, so a fresh
//    invite/reset invalidates older ones
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const { query } = require('./db');

const INVITE_TTL_HOURS = 72;
const RESET_TTL_HOURS = 1;

function generate() {
  return crypto.randomBytes(32).toString('base64url');
}

function hash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issue(userId, kind) {
  if (kind !== 'invite' && kind !== 'reset') {
    throw new Error('Unknown token kind: ' + kind);
  }
  // Revoke any outstanding token of the same kind for this user so the
  // newest link is the only one that can be redeemed.
  await query(
    `UPDATE auth_tokens SET used_at = now()
     WHERE user_id = $1 AND kind = $2 AND used_at IS NULL`,
    [userId, kind]
  );
  const token = generate();
  const ttlHours = kind === 'invite' ? INVITE_TTL_HOURS : RESET_TTL_HOURS;
  await query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
    [userId, kind, hash(token), String(ttlHours)]
  );
  return token;
}

// Returns { user_id } when the token is valid and unused, otherwise null.
// Marks the token used as part of the same call — single-use semantics.
async function consume(token, kind) {
  if (!token) return null;
  const tokenHash = hash(token);
  const { rows } = await query(
    `UPDATE auth_tokens
     SET used_at = now()
     WHERE token_hash = $1
       AND kind = $2
       AND used_at IS NULL
       AND expires_at > now()
     RETURNING user_id`,
    [tokenHash, kind]
  );
  return rows[0] || null;
}

module.exports = { issue, consume, INVITE_TTL_HOURS, RESET_TTL_HOURS };
