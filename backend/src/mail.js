// ---------------------------------------------------------------------------
//  Outbound mail. Three transport modes, picked in this order:
//
//    1. Brevo HTTP API   if BREVO_API_KEY is set.
//       Uses https://api.brevo.com/v3/smtp/email (port 443, JSON, ~200ms).
//       Recommended on PaaS where outbound SMTP is unreliable.
//
//    2. SMTP via nodemailer   if SMTP_HOST / SMTP_USER / SMTP_PASS are set.
//       Standard fallback for environments that prefer SMTP.
//
//    3. Console logger        otherwise (dev mode, no creds).
//
//  All sends are fire-and-forget: the caller does NOT await the network
//  call. The user-creation / password-reset HTTP request returns
//  immediately and the email goes out in the background. If the send fails
//  the error is logged with a [mail] prefix so it shows up in `Logs`, but
//  the HTTP request never blocks on SMTP/TLS handshakes or timeouts.
//
//  Required env:
//    APP_URL         e.g. https://ecgportal.dev  (no trailing /)
//    SMTP_FROM       e.g. 'SPD Tracker <no-reply@ecgportal.dev>'
//
//  For Brevo HTTP API mode:
//    BREVO_API_KEY   long base64 string from https://app.brevo.com/settings/keys/api
//
//  For SMTP mode (legacy / alternative):
//    SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
// ---------------------------------------------------------------------------
const nodemailer = require('nodemailer');

const FROM_RAW = process.env.SMTP_FROM || 'SPD Tracker <no-reply@ecgportal.dev>';
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

// Parse "Name <email>" into { name, email }; fall back to plain address.
function parseFrom(raw) {
  const m = raw.match(/^\s*(.+?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, ''), email: m[2] };
  return { name: undefined, email: raw.trim() };
}
const FROM = parseFrom(FROM_RAW);

// --- Mode selection ---------------------------------------------------------
function brevoConfigured() {
  return !!process.env.BREVO_API_KEY;
}
function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let mode = 'console';
if (brevoConfigured()) mode = 'brevo-http';
else if (smtpConfigured()) mode = 'smtp';

let smtpTransporter = null;
function getSmtpTransport() {
  if (smtpTransporter) return smtpTransporter;
  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Short timeouts so a hung connection doesn't pile up requests.
    connectionTimeout: 8000,
    socketTimeout: 8000,
  });
  return smtpTransporter;
}

// Startup announcement so the operator can confirm which mode is active.
if (mode === 'brevo-http') {
  console.log('[mail] mode=brevo-http (using Brevo HTTP API on port 443)');
} else if (mode === 'smtp') {
  console.log(`[mail] mode=smtp host=${process.env.SMTP_HOST} port=${process.env.SMTP_PORT || 587}`);
} else if (process.env.NODE_ENV === 'production') {
  console.error('[mail] mode=console - no Brevo or SMTP creds configured. Mail will be logged only.');
} else {
  console.log('[mail] mode=console (dev). Mail will be logged to this terminal.');
}

// --- Low-level send ---------------------------------------------------------
async function sendViaBrevo({ to, subject, text }) {
  const body = {
    sender: FROM,
    to: [{ email: to }],
    subject,
    textContent: text,
  };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify(body),
    // Even though HTTPS rarely hangs, we don't want a stuck call to leak.
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

async function sendViaSmtp({ to, subject, text }) {
  return getSmtpTransport().sendMail({
    from: FROM_RAW,
    to,
    subject,
    text,
  });
}

function sendViaConsole({ to, subject, text }) {
  console.log('\n──────────── [mail] outgoing ────────────');
  console.log(`To:      ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(text);
  console.log('────────────────────────────────────────\n');
  return Promise.resolve({ messageId: 'dev-' + Date.now() });
}

// Dispatcher. Fire-and-forget at the public API level — see send() below.
async function doSend(msg) {
  if (mode === 'brevo-http') return sendViaBrevo(msg);
  if (mode === 'smtp') return sendViaSmtp(msg);
  return sendViaConsole(msg);
}

// Public send: NEVER throws, NEVER blocks the caller. Logs success/failure.
// Returns immediately (synchronously, conceptually) so HTTP handlers don't
// stall on email delivery.
function send(msg) {
  // setImmediate keeps this off the request's event-loop tick.
  setImmediate(() => {
    doSend(msg)
      .then(() => {
        console.log(`[mail] sent ok via ${mode} -> ${msg.to} (${msg.subject})`);
      })
      .catch((err) => {
        console.error(`[mail] FAILED via ${mode} -> ${msg.to}: ${err.message}`);
      });
  });
}

// --- Template helpers -------------------------------------------------------
function url(path) {
  if (!path.startsWith('/')) path = '/' + path;
  return APP_URL + path;
}

function sendInvite({ to, name, token, invitedByName }) {
  const link = url(`/accept-invite?token=${encodeURIComponent(token)}`);
  send({
    to,
    subject: 'You have been invited to the Safari Park Project tracker',
    text: [
      `Hi ${name || 'there'},`,
      '',
      `${invitedByName || 'A super-admin'} has invited you to the Safari Park Project Authority Engagement Tracker.`,
      '',
      'Click the link below to set your password and sign in. The link is valid for 72 hours and can only be used once.',
      '',
      link,
      '',
      'If you weren\'t expecting this invitation, ignore this email — nothing has been created until you click the link.',
      '',
      '— SPD Tracker',
    ].join('\n'),
  });
}

function sendPasswordReset({ to, name, token }) {
  const link = url(`/reset-password?token=${encodeURIComponent(token)}`);
  send({
    to,
    subject: 'Reset your SPD Tracker password',
    text: [
      `Hi ${name || 'there'},`,
      '',
      'A password reset was requested for your SPD Tracker account. Click the link below to set a new password. The link is valid for one hour and can only be used once.',
      '',
      link,
      '',
      'If you did not request this, you can ignore this email — your existing password still works.',
      '',
      '— SPD Tracker',
    ].join('\n'),
  });
}

function describe() {
  return { mode, from: FROM_RAW, app_url: APP_URL };
}

module.exports = { sendInvite, sendPasswordReset, describe };
