// ---------------------------------------------------------------------------
//  Authentication.
//  Individual logins. A successful login returns a signed token the front end
//  sends on every later request. Editors may write; viewers may only read.
// ---------------------------------------------------------------------------
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('./db');
const { wrap, httpError } = require('./helpers');

const SECRET = process.env.JWT_SECRET || 'insecure-development-secret';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

// Verify the token on an incoming request and attach req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(httpError(401, 'Sign in to continue.'));
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    next(httpError(401, 'Your session has expired. Please sign in again.'));
  }
}

// Allow the request only if the signed-in user is an editor.
function requireEditor(req, res, next) {
  if (!req.user) return next(httpError(401, 'Sign in to continue.'));
  if (req.user.role !== 'editor') {
    return next(httpError(403, 'This account has view-only access.'));
  }
  next();
}

const router = express.Router();

// POST /api/auth/login  -  exchange email and password for a token.
router.post(
  '/login',
  wrap(async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    if (!email || !password) {
      throw httpError(400, 'Enter an email and password.');
    }

    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !user.is_active) {
      throw httpError(401, 'Email or password is incorrect.');
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw httpError(401, 'Email or password is incorrect.');

    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    const payload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organisation: user.organisation,
    };
    const token = jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
    res.json({ token, user: payload });
  })
);

// GET /api/auth/me  -  who am I (used by the front end on page load).
router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    res.json({ user: req.user });
  })
);

module.exports = { router, requireAuth, requireEditor };
