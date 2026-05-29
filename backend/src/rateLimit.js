// ---------------------------------------------------------------------------
//  Per-IP rate limiters for the auth surface. Tight on credential endpoints
//  (login, forgot), looser on token-redemption endpoints (accept-invite,
//  reset-password) because those each carry their own anti-guess token.
//
//  All limiters emit JSON 429 so the front end can render the message.
//  IP source is honoured via `app.set('trust proxy', 1)` in server.js — this
//  is required behind Render's proxy so a real attacker's IP is what gets
//  counted, not the load balancer's.
//
//  Window resets are silent (no Retry-After advice exposed): we don't want
//  to advertise the exact unlock moment.
// ---------------------------------------------------------------------------
const rateLimit = require('express-rate-limit');

function jsonHandler(message) {
  return (req, res) => {
    res.status(429).json({ error: message });
  };
}

// 5 login attempts per IP per 15 minutes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonHandler(
    'Too many sign-in attempts from this network. Try again in 15 minutes, or use Forgot Password.'
  ),
});

// 3 forgot-password requests per IP per 15 minutes. Low ceiling because
// every successful call also fires an outbound email.
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonHandler(
    'Too many reset requests from this network. Try again in 15 minutes.'
  ),
});

// 10 token-redemption attempts per IP per 15 minutes — covers
// accept-invite and reset-password. Generous because the token itself is
// 256 bits of entropy; this just blocks naive guessing scripts.
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonHandler('Too many attempts. Try again in 15 minutes.'),
});

module.exports = { loginLimiter, forgotLimiter, tokenLimiter };
