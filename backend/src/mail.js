// ---------------------------------------------------------------------------
//  Outbound mail via nodemailer. SMTP credentials come from env. When SMTP
//  isn't configured (typical local dev), the transport falls back to a
//  console logger so flows still complete and the dev sees the link in the
//  backend log.
//
//  Required env in production:
//    SMTP_HOST       e.g. smtp.gmail.com
//    SMTP_PORT       e.g. 587
//    SMTP_SECURE     "true" for port 465, anything else = STARTTLS
//    SMTP_USER       SMTP username
//    SMTP_PASS       SMTP password / app password
//    SMTP_FROM       e.g. "SPD Tracker <no-reply@spd-tracker.com>"
//    APP_URL         e.g. https://spd-tracker.onrender.com  (no trailing /)
// ---------------------------------------------------------------------------
const nodemailer = require('nodemailer');

const FROM = process.env.SMTP_FROM || 'SPD Tracker <no-reply@spd-tracker.local>';
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

let transporter = null;
let mode = 'console';

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (transporter) return transporter;
  if (smtpConfigured()) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    mode = 'smtp';
  } else {
    if (process.env.NODE_ENV === 'production') {
      // Don't crash, but log loudly — production with no mail is a real bug.
      console.error(
        '[mail] SMTP not configured in production. Outgoing mail will be logged only.'
      );
    } else {
      console.log('[mail] SMTP not configured. Outgoing mail will be logged to this terminal.');
    }
    transporter = {
      sendMail: async ({ to, subject, text }) => {
        console.log('\n──────────── [mail] outgoing ────────────');
        console.log(`To:      ${to}`);
        console.log(`Subject: ${subject}`);
        console.log(text);
        console.log('────────────────────────────────────────\n');
        return { messageId: 'dev-' + Date.now() };
      },
    };
    mode = 'console';
  }
  return transporter;
}

function url(path) {
  if (!path.startsWith('/')) path = '/' + path;
  return APP_URL + path;
}

async function sendInvite({ to, name, token, invitedByName }) {
  const link = url(`/accept-invite?token=${encodeURIComponent(token)}`);
  await getTransport().sendMail({
    from: FROM,
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

async function sendPasswordReset({ to, name, token }) {
  const link = url(`/reset-password?token=${encodeURIComponent(token)}`);
  await getTransport().sendMail({
    from: FROM,
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
  return { mode, from: FROM, app_url: APP_URL };
}

module.exports = { sendInvite, sendPasswordReset, describe };
