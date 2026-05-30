// ---------------------------------------------------------------------------
//  Weekly digest. A summary email sent to every active user every Monday
//  at 08:00 server time.
//
//  Composition (all-up engagement view — the same data the read-only viewers
//  watch live):
//    - KPIs:                  authorities, sub-divisions, comms, overdue
//    - Overdue items:         every outbound comm flagged is_overdue
//    - Last 7 days:           communications and meetings logged this week
//    - Engagement ladder:     how many sub-divs sit at each stage
//
//  Idempotent: an audit_events row of type "digest.sent" written for each
//  user. The job skips users who already received this week's send.
// ---------------------------------------------------------------------------
const cron = require('node-cron');
const { query } = require('./db');
const { logAudit } = require('./audit');
const mail = require('./mail');

const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

// --- data builders ----------------------------------------------------------
async function buildDigestData() {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const totals = (await query(
    `SELECT
       (SELECT COUNT(*) FROM v_authority)              AS authorities,
       (SELECT COUNT(*) FROM v_sub_division)           AS sub_divisions,
       (SELECT COUNT(*) FROM v_communication)          AS communications,
       (SELECT COUNT(*) FROM v_communication WHERE is_overdue) AS overdue,
       (SELECT COUNT(*) FROM v_communication
          WHERE comm_date > $1::date)                  AS comms_this_week`,
    [since.toISOString().slice(0, 10)]
  )).rows[0];

  const overdue = (await query(
    `SELECT comm_code, comm_date, authority_code, sub_reference, summary
       FROM v_communication
       WHERE is_overdue = TRUE
       ORDER BY comm_date ASC
       LIMIT 50`
  )).rows;

  const recentComms = (await query(
    `SELECT comm_code, comm_date, direction, authority_code, sub_reference, summary
       FROM v_communication
       WHERE comm_date > $1::date
       ORDER BY comm_date DESC, id DESC
       LIMIT 50`,
    [since.toISOString().slice(0, 10)]
  )).rows;

  const recentMeetings = (await query(
    `SELECT m.meeting_code, m.meeting_date, a.code AS authority_code,
            a.name AS authority_name, m.purpose
       FROM meetings m
       JOIN authorities a ON a.id = m.authority_id
       WHERE m.deleted_at IS NULL AND a.deleted_at IS NULL
         AND m.meeting_date > $1::date
       ORDER BY m.meeting_date DESC
       LIMIT 25`,
    [since.toISOString().slice(0, 10)]
  )).rows;

  const ladder = (await query(
    `SELECT engagement_status, COUNT(*)::int AS n
       FROM v_sub_division GROUP BY engagement_status`
  )).rows;

  return { totals, overdue, recentComms, recentMeetings, ladder, since };
}

// --- HTML composer ----------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()]} ${String(dt.getFullYear()).slice(2)}`;
}

function digestHtml(user, data) {
  const link = (path) => `${APP_URL}${path}`;
  const kpi = (label, value) =>
    `<td style="padding:14px 18px;background:#EEF3F8;border-radius:10px;width:25%">
       <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;color:#1F4E79;text-transform:uppercase">${esc(label)}</div>
       <div style="font-size:26px;font-weight:600;color:#173A5A;margin-top:4px;letter-spacing:-0.02em">${esc(value)}</div>
     </td>`;

  const row = (cells, opts = {}) =>
    `<tr>${cells.map((c) =>
      `<td style="padding:8px 10px;border-bottom:1px solid #E8E8EB;font-size:13px;${opts.style || ''}">${c}</td>`
    ).join('')}</tr>`;

  const overdueRows = data.overdue.length
    ? data.overdue.map((r) => row([
        `<a href="${link('/app/communications')}" style="color:#1F4E79;text-decoration:none;font-family:monospace">${esc(r.comm_code)}</a>`,
        `<span style="color:#6E6E73">${esc(fmtDate(r.comm_date))}</span>`,
        `<span style="color:#1F4E79;font-weight:600">${esc(r.authority_code)}</span>`,
        esc(r.sub_reference),
        `<span style="color:#6E6E73">${esc((r.summary || '').slice(0, 120))}</span>`,
      ])).join('')
    : `<tr><td colspan="5" style="padding:16px;color:#6E6E73;font-style:italic">Nothing overdue. 🎉</td></tr>`;

  const recentRows = data.recentComms.length
    ? data.recentComms.map((r) => row([
        `<a href="${link('/app/communications')}" style="color:#1F4E79;text-decoration:none;font-family:monospace">${esc(r.comm_code)}</a>`,
        `<span style="color:#6E6E73">${esc(fmtDate(r.comm_date))}</span>`,
        `<span>${esc(r.direction)}</span>`,
        `${esc(r.authority_code)} · ${esc(r.sub_reference)}`,
        `<span style="color:#6E6E73">${esc((r.summary || '').slice(0, 100))}</span>`,
      ])).join('')
    : `<tr><td colspan="5" style="padding:16px;color:#6E6E73;font-style:italic">No new communications this week.</td></tr>`;

  const meetingRows = data.recentMeetings.length
    ? data.recentMeetings.map((r) => row([
        `<a href="${link('/app/meetings')}" style="color:#1F4E79;text-decoration:none;font-family:monospace">${esc(r.meeting_code)}</a>`,
        `<span style="color:#6E6E73">${esc(fmtDate(r.meeting_date))}</span>`,
        `<span style="color:#1F4E79;font-weight:600">${esc(r.authority_code)}</span>`,
        esc(r.authority_name),
        `<span style="color:#6E6E73">${esc(r.purpose || '')}</span>`,
      ])).join('')
    : null;

  const ladderHtml = data.ladder.map((l) =>
    `<span style="display:inline-block;padding:5px 12px;border-radius:999px;background:#EEF3F8;color:#1F4E79;font-size:12px;font-weight:600;margin:0 6px 6px 0">
       ${esc(l.engagement_status)} · ${l.n}
     </span>`
  ).join('');

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F4F6F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f">
  <div style="max-width:680px;margin:0 auto;background:#fff">
    <div style="background:#1F4E79;color:#fff;padding:28px 36px">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.16em">SAFARI PARK PROJECT · WEEKLY DIGEST</div>
      <div style="margin-top:6px;font-size:22px;font-weight:600;letter-spacing:-0.02em">Hi ${esc(user.name.split(' ')[0])}, here is the week's engagement summary.</div>
    </div>
    <div style="padding:24px 36px">
      <table style="width:100%;border-spacing:8px 0;border-collapse:separate;margin-bottom:18px">
        <tr>
          ${kpi('Authorities', data.totals.authorities)}
          ${kpi('Sub-Divisions', data.totals.sub_divisions)}
          ${kpi('Communications', data.totals.communications)}
          ${kpi('Overdue', data.totals.overdue)}
        </tr>
      </table>

      <h2 style="font-size:14px;font-weight:700;color:#1F4E79;letter-spacing:0.06em;text-transform:uppercase;margin:28px 0 10px">Engagement Ladder</h2>
      <div>${ladderHtml}</div>

      <h2 style="font-size:14px;font-weight:700;color:#1F4E79;letter-spacing:0.06em;text-transform:uppercase;margin:28px 0 10px">Overdue (${data.totals.overdue})</h2>
      <table style="width:100%;border-collapse:collapse">${overdueRows}</table>

      <h2 style="font-size:14px;font-weight:700;color:#1F4E79;letter-spacing:0.06em;text-transform:uppercase;margin:28px 0 10px">Logged this week (${data.totals.comms_this_week})</h2>
      <table style="width:100%;border-collapse:collapse">${recentRows}</table>

      ${meetingRows ? `
      <h2 style="font-size:14px;font-weight:700;color:#1F4E79;letter-spacing:0.06em;text-transform:uppercase;margin:28px 0 10px">Meetings this week</h2>
      <table style="width:100%;border-collapse:collapse">${meetingRows}</table>` : ''}

      <div style="margin-top:34px;padding-top:18px;border-top:1px solid #E8E8EB;font-size:12px;color:#6E6E73">
        <a href="${link('/app')}" style="color:#1F4E79;text-decoration:none;font-weight:600">Open the tracker →</a>
        <br>
        You're receiving this because you have an account on the SPD Tracker.
      </div>
    </div>
  </div>
</body></html>`;
}

function digestText(user, data) {
  const lines = [];
  lines.push(`Safari Park Project — Weekly digest`);
  lines.push(`Hi ${user.name.split(' ')[0]},`);
  lines.push('');
  lines.push(`KPIs:`);
  lines.push(`  Authorities:    ${data.totals.authorities}`);
  lines.push(`  Sub-Divisions:  ${data.totals.sub_divisions}`);
  lines.push(`  Communications: ${data.totals.communications}`);
  lines.push(`  Overdue:        ${data.totals.overdue}`);
  lines.push('');
  if (data.overdue.length) {
    lines.push(`Overdue (${data.overdue.length}):`);
    data.overdue.slice(0, 20).forEach((r) =>
      lines.push(`  ${r.comm_code}  ${fmtDate(r.comm_date)}  ${r.authority_code}/${r.sub_reference}  ${(r.summary || '').slice(0, 80)}`)
    );
  } else {
    lines.push('Nothing overdue. 🎉');
  }
  lines.push('');
  lines.push(`Open the tracker: ${APP_URL}/app`);
  return lines.join('\n');
}

// --- runner -----------------------------------------------------------------
const transport = require('./mail');

async function sendDigestTo(user, data) {
  await transport.describe; // ensure module loaded
  const subject = `SPD Tracker — Weekly digest (${data.totals.overdue} overdue)`;
  const html = digestHtml(user, data);
  const text = digestText(user, data);

  // We don't expose this from mail.js directly, so reach into nodemailer-via-mail
  // by composing through transport's sendMail signature.
  // mail.js exposes sendInvite / sendPasswordReset that go through the same
  // transport. Use the underlying transporter for arbitrary HTML.
  // The cleanest path is to add a helper in mail.js; until then, monkey here:
  const nodemailer = require('nodemailer');
  let send;
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    send = (opts) => t.sendMail(opts);
  } else {
    // Console fallback — same shape as mail.js's dev mode.
    send = async (opts) => {
      console.log('\n──────────── [digest] outgoing ────────────');
      console.log(`To:      ${opts.to}`);
      console.log(`Subject: ${opts.subject}`);
      console.log(opts.text);
      console.log('────────────────────────────────────────\n');
    };
  }
  await send({
    from: process.env.SMTP_FROM || 'SPD Tracker <no-reply@ecgportal.dev>',
    to: user.email,
    subject,
    text,
    html,
  });
}

async function alreadySentThisWeek(userId) {
  const r = await query(
    `SELECT 1 FROM audit_events
     WHERE event_type = 'digest.sent'
       AND target_id = $1
       AND created_at > date_trunc('week', now())
     LIMIT 1`,
    [userId]
  );
  return !!r.rows[0];
}

async function runDigest({ dryRun = false, forceUserId = null } = {}) {
  const data = await buildDigestData();

  const users = forceUserId
    ? (await query('SELECT id, name, email FROM users WHERE id = $1', [forceUserId])).rows
    : (await query(
        `SELECT id, name, email FROM users
         WHERE is_disabled = FALSE AND password_hash IS NOT NULL
         ORDER BY id`
      )).rows;

  let sent = 0;
  for (const u of users) {
    if (!forceUserId && await alreadySentThisWeek(u.id)) continue;
    if (dryRun) {
      console.log(`[digest] would send to ${u.email}`);
      continue;
    }
    try {
      await sendDigestTo(u, data);
      sent += 1;
      await logAudit({
        event: 'digest.sent',
        target_type: 'user',
        target_id: u.id,
        payload: { overdue: data.totals.overdue, comms_this_week: data.totals.comms_this_week },
      });
    } catch (err) {
      console.error('[digest] send failed for', u.email, err.message);
    }
  }
  console.log(`[digest] sent ${sent} email(s).`);
  return { sent, attempted: users.length };
}

function startScheduler() {
  if (String(process.env.DIGEST_ENABLED || '').toLowerCase() !== 'true') {
    console.log('[digest] DIGEST_ENABLED != true — scheduler is OFF.');
    return null;
  }
  // Every Monday at 08:00 server time.
  const expr = process.env.DIGEST_CRON || '0 8 * * 1';
  console.log(`[digest] scheduling cron: ${expr}`);
  return cron.schedule(expr, () => {
    runDigest().catch((err) => console.error('[digest] run failed:', err));
  });
}

module.exports = { startScheduler, runDigest, buildDigestData, digestHtml, digestText };
