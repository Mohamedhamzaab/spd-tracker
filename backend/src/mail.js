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
// Optional human inbox for replies — improves trust + lets recipients reply.
// e.g. MAIL_REPLY_TO=support@ecgportal.dev. Falls back to the From address.
const REPLY_TO = (process.env.MAIL_REPLY_TO || '').trim();

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
// Every transport accepts: { to, subject, text, html?, headers?, replyTo? }.
// Sending both text and html (multipart/alternative) reads as a normal,
// well-formed message rather than a bare link — a meaningful spam-score win.
async function sendViaBrevo({ to, subject, text, html, headers, replyTo }) {
  const body = {
    sender: FROM,
    to: [{ email: to }],
    subject,
    textContent: text,
  };
  if (html) body.htmlContent = html;
  if (replyTo) body.replyTo = { email: replyTo };
  if (headers && Object.keys(headers).length) body.headers = headers;
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

async function sendViaSmtp({ to, subject, text, html, headers, replyTo }) {
  return getSmtpTransport().sendMail({
    from: FROM_RAW,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(headers && Object.keys(headers).length ? { headers } : {}),
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
  // Default a Reply-To if one is configured and the caller didn't set one.
  if (REPLY_TO && !msg.replyTo) msg.replyTo = REPLY_TO;
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

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Branded, single-column HTML shell with a primary button. Inline styles
// only (email clients strip <style>). Indigo header to match the app.
function htmlShell({ heading, intro, ctaLabel, ctaUrl, note, footnote }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff">
    <div style="background:#4f46e5;color:#ffffff;padding:22px 32px">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.16em">SAFARI PARK PROJECT</div>
      <div style="margin-top:4px;font-size:17px;font-weight:600">Authority Engagement Tracker</div>
    </div>
    <div style="padding:28px 32px">
      <h1 style="font-size:19px;font-weight:600;margin:0 0 14px;color:#0f172a">${esc(heading)}</h1>
      <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 22px">${esc(intro)}</p>
      <a href="${ctaUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px">${esc(ctaLabel)}</a>
      <p style="font-size:12.5px;line-height:1.6;color:#64748b;margin:22px 0 0">${esc(note)}</p>
      <p style="font-size:12px;line-height:1.5;color:#94a3b8;margin:18px 0 0">Or paste this link into your browser:<br><span style="color:#4f46e5;word-break:break-all">${ctaUrl}</span></p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8">
      ${esc(footnote)}
    </div>
  </div>
</body></html>`;
}

// Invite is sent awaitably (super-admin action, not enumeration-sensitive) so
// the caller can tell the admin whether the email actually went out. Never
// throws — resolves to { ok, mode, error } so a failed send doesn't fail the
// user-creation request (the account is still created as invite-pending).
async function sendInvite({ to, name, token, invitedByName }) {
  const link = url(`/accept-invite?token=${encodeURIComponent(token)}`);
  const intro = `${invitedByName || 'A super-admin'} has invited you to the Safari Park Project Authority Engagement Tracker. Set your password to get started — the link is valid for 72 hours and can be used once.`;
  const msg = {
    to,
    subject: 'You have been invited to the Safari Park Project tracker',
    text: [
      `Hi ${name || 'there'},`,
      '',
      intro,
      '',
      link,
      '',
      "If you weren't expecting this invitation, ignore this email — nothing has been created until you click the link.",
      '',
      '— SPD Tracker',
    ].join('\n'),
    html: htmlShell({
      heading: `Hi ${name || 'there'},`,
      intro,
      ctaLabel: 'Set your password',
      ctaUrl: link,
      note: "If you weren't expecting this invitation, ignore this email — nothing has been created until you click the link.",
      footnote: 'Safari Park Project · Authority Engagement Tracker · ecgportal.dev',
    }),
  };
  if (REPLY_TO && !msg.replyTo) msg.replyTo = REPLY_TO;
  try {
    await doSend(msg);
    console.log(`[mail] invite sent ok via ${mode} -> ${to}`);
    return { ok: true, mode };
  } catch (err) {
    console.error(`[mail] invite FAILED via ${mode} -> ${to}: ${err.message}`);
    return { ok: false, mode, error: err.message };
  }
}

function sendPasswordReset({ to, name, token }) {
  const link = url(`/reset-password?token=${encodeURIComponent(token)}`);
  const intro = 'A password reset was requested for your SPD Tracker account. Set a new password using the button below — the link is valid for one hour and can be used once.';
  send({
    to,
    subject: 'Reset your SPD Tracker password',
    text: [
      `Hi ${name || 'there'},`,
      '',
      intro,
      '',
      link,
      '',
      'If you did not request this, you can ignore this email — your existing password still works.',
      '',
      '— SPD Tracker',
    ].join('\n'),
    html: htmlShell({
      heading: `Hi ${name || 'there'},`,
      intro,
      ctaLabel: 'Reset password',
      ctaUrl: link,
      note: 'If you did not request this, you can ignore this email — your existing password still works.',
      footnote: 'Safari Park Project · Authority Engagement Tracker · ecgportal.dev',
    }),
  });
}

// Task assignment — fire-and-forget (sent from inside an HTTP request, must
// not block or fail the create/update). Links to the recipient's task board.
function sendTaskAssigned({ to, name, taskTitle, assignedByName, parentLabel, dueDate }) {
  const link = url('/app/tasks');
  const due = dueDate ? ` It's due ${dueDate}.` : '';
  const intro = `${assignedByName || 'A colleague'} assigned you a task${parentLabel ? ` on ${parentLabel}` : ''}: “${taskTitle}”.${due}`;
  send({
    to,
    subject: `New task assigned to you: ${taskTitle}`,
    text: [
      `Hi ${name || 'there'},`,
      '',
      intro,
      '',
      `Open your tasks: ${link}`,
      '',
      'You can mark it done from your task list when it’s handled.',
      '',
      '— SPD Tracker',
    ].join('\n'),
    html: htmlShell({
      heading: `Hi ${name || 'there'},`,
      intro,
      ctaLabel: 'Open your tasks',
      ctaUrl: link,
      note: 'You can mark it done from your task list when it’s handled.',
      footnote: 'Safari Park Project · Authority Engagement Tracker · ecgportal.dev',
    }),
  });
}

// Task reminder — sent the day before the due date by the daily scheduler.
// Awaitable so the job can log per-recipient outcome; resolves/rejects.
function sendTaskReminder({ to, name, taskTitle, parentLabel, dueDate }) {
  const link = url('/app/tasks');
  const intro = `Reminder: your task${parentLabel ? ` on ${parentLabel}` : ''} — “${taskTitle}” — is due tomorrow${dueDate ? ` (${dueDate})` : ''}.`;
  return sendNow({
    to,
    subject: `Reminder: “${taskTitle}” is due tomorrow`,
    text: [
      `Hi ${name || 'there'},`,
      '',
      intro,
      '',
      `Open your tasks: ${link}`,
      '',
      'If it’s already handled, mark it done to stop further reminders.',
      '',
      '— SPD Tracker',
    ].join('\n'),
    html: htmlShell({
      heading: `Hi ${name || 'there'},`,
      intro,
      ctaLabel: 'Open your tasks',
      ctaUrl: link,
      note: 'If it’s already handled, mark it done to stop further reminders.',
      footnote: 'Safari Park Project · Authority Engagement Tracker · ecgportal.dev',
    }),
  });
}

function describe() {
  return { mode, from: FROM_RAW, app_url: APP_URL };
}

// Awaitable send for non-request contexts (digest scheduler / CLI), where
// we WANT to wait for the network call so a short-lived process doesn't exit
// before delivery. Resolves on success, rejects on failure.
function sendNow(msg) {
  if (REPLY_TO && !msg.replyTo) msg.replyTo = REPLY_TO;
  return doSend(msg);
}

module.exports = {
  send, sendNow, sendInvite, sendPasswordReset,
  sendTaskAssigned, sendTaskReminder,
  describe, APP_URL,
};
