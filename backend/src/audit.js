// ---------------------------------------------------------------------------
//  Audit log. Single helper used by every route that mutates state or
//  records an auth event. Writes never block the response — a failed insert
//  is logged but doesn't bubble up as a 500.
//
//  Event types are flat dotted strings:
//    login.success            login.failed             login.locked
//    password.forgot_requested password.reset_used     password.changed
//    invite.sent              invite.accepted
//    user.created             user.role_changed        user.disabled
//    user.deleted             user.force_reset
//    mfa.enrolled             mfa.cleared              mfa.verified
//    data.<table>.<action>    e.g. data.authority.created
// ---------------------------------------------------------------------------
const { query } = require('./db');
const { publish } = require('./eventBus');

function ipFrom(req) {
  if (!req) return null;
  return (
    req.headers?.['x-forwarded-for']?.split(',')[0].trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    null
  );
}

async function logAudit({
  actor_id = null,
  event,
  target_type = null,
  target_id = null,
  payload = null,
  req = null,
}) {
  // Fan out to the SSE bus so any "live read-only view" clients can
  // invalidate their list caches the moment the change lands. Auth-token
  // and password events are skipped — they're not useful to live viewers
  // and may leak email patterns to other connections.
  if (event && (event.startsWith('data.') || event.startsWith('user.') || event.startsWith('mfa.cleared'))) {
    try { publish(event, { target_type, target_id, actor_id }); } catch { /* ignore */ }
  }
  try {
    await query(
      `INSERT INTO audit_events
         (actor_id, event_type, target_type, target_id, payload, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        actor_id,
        event,
        target_type,
        target_id,
        payload ? JSON.stringify(payload) : null,
        ipFrom(req),
        req?.headers?.['user-agent']?.slice(0, 500) || null,
      ]
    );
  } catch (err) {
    console.error('[audit] insert failed:', err.message, { event, actor_id });
  }
}

module.exports = { logAudit };
