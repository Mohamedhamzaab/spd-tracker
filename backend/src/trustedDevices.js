// ---------------------------------------------------------------------------
//  Trusted devices — "remember this device" so MFA is skipped for ~30 days on a
//  browser that has already passed the second factor. The browser holds a
//  random secret in an httpOnly cookie; only its SHA-256 hash is stored here,
//  bound to one user. Opt-in (a checkbox on the MFA screen), revocable from My
//  Account, and wiped when that user's password changes.
//
//  Security trade-off: a stolen device that is "trusted" skips MFA until the
//  trust expires or is revoked — but the attacker still needs the password.
//  The cookie is httpOnly + secure so it can't be read by JS or sniffed.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const { query } = require('./db');

const COOKIE = 'spd_td';
const TRUST_DAYS = Number(process.env.TRUST_DEVICE_DAYS) || 30;
const isProd = process.env.NODE_ENV === 'production';
const MAX_AGE_MS = TRUST_DAYS * 24 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Read one named cookie from the raw header (no cookie-parser dependency).
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

// Coarse, human-readable label from the user agent (display only).
function deviceLabel(req) {
  const ua = String(req.headers['user-agent'] || '');
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad|iPod|iOS/.test(ua) ? 'iOS' :
    /Linux/.test(ua) ? 'Linux' : 'device';
  return `${browser} on ${os}`;
}

function clientIp(req) {
  return (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.ip || null;
}

function cookieOpts() {
  return { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/api/auth', maxAge: MAX_AGE_MS };
}

// Called after a successful MFA verify when "trust this device" was ticked.
async function issueTrustCookie(res, req, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + MAX_AGE_MS);
  await query(
    `INSERT INTO trusted_devices (user_id, token_hash, label, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), deviceLabel(req), clientIp(req), expires]
  );
  res.cookie(COOKIE, token, cookieOpts());
}

// At login: is this browser a live trusted device for this user? Returns the
// row (and bumps last_used_at) or null. Bound to the user, so a device trusted
// for user A never skips MFA for user B.
async function findTrustedDevice(req, userId) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const { rows } = await query(
    `SELECT id FROM trusted_devices
      WHERE user_id = $1 AND token_hash = $2 AND expires_at > now()`,
    [userId, hashToken(token)]
  );
  if (!rows[0]) return null;
  await query('UPDATE trusted_devices SET last_used_at = now() WHERE id = $1', [rows[0].id]);
  return rows[0];
}

async function listDevices(req, userId) {
  const token = readCookie(req, COOKIE);
  const curHash = token ? hashToken(token) : null;
  const { rows } = await query(
    `SELECT id, label, ip,
            to_char(created_at,   'YYYY-MM-DD') AS created,
            to_char(last_used_at, 'YYYY-MM-DD') AS last_used,
            to_char(expires_at,   'YYYY-MM-DD') AS expires,
            token_hash
       FROM trusted_devices
      WHERE user_id = $1 AND expires_at > now()
      ORDER BY last_used_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id, label: r.label, ip: r.ip,
    created: r.created, last_used: r.last_used, expires: r.expires,
    current: !!curHash && r.token_hash === curHash,
  }));
}

async function revokeDevice(userId, id) {
  await query('DELETE FROM trusted_devices WHERE id = $1 AND user_id = $2', [Number(id), userId]);
}

async function clearForUser(userId) {
  await query('DELETE FROM trusted_devices WHERE user_id = $1', [userId]);
}

module.exports = {
  COOKIE, issueTrustCookie, findTrustedDevice, listDevices, revokeDevice, clearForUser,
};
