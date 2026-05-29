// ---------------------------------------------------------------------------
//  Audit log — read side.
//
//  GET /api/audit                              super-admin · list with filters
//      ?event_type=...
//      ?actor_id=...
//      ?actor_email=substring
//      ?target_type=user|authority|sub_division|communication|meeting|document
//      ?target_id=...
//      ?from=YYYY-MM-DD
//      ?to=YYYY-MM-DD
//      ?q=substring (ip OR email OR payload::text)
//      ?limit=50&offset=0
//
//  GET /api/audit/event-types                  super-admin · distinct event_type
//                                              list, sorted, for the filter UI
//
//  GET /api/audit/for/:type/:id                authed · last N events for one
//                                              record, used by the per-entity
//                                              "Recent activity" panel
// ---------------------------------------------------------------------------
const express = require('express');
const { query } = require('../db');
const { wrap, httpError } = require('../helpers');
const { requireSuperAdmin } = require('../auth');

const TARGET_TYPES = new Set([
  'user', 'authority', 'sub_division', 'communication', 'meeting', 'document',
]);

const router = express.Router();

function projectEvent(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    event_type: row.event_type,
    target_type: row.target_type,
    target_id: row.target_id,
    payload: row.payload,
    ip: row.ip,
    user_agent: row.user_agent,
    actor: row.actor_id
      ? { id: row.actor_id, name: row.actor_name, email: row.actor_email }
      : null,
  };
}

const BASE_SELECT = `
  SELECT a.id, a.created_at, a.event_type, a.target_type, a.target_id,
         a.payload, a.ip, a.user_agent,
         a.actor_id, u.name AS actor_name, u.email AS actor_email
  FROM   audit_events a
  LEFT JOIN users u ON u.id = a.actor_id
`;

// --- /api/audit -- super-admin -----------------------------------------------
router.get(
  '/',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const wheres = [];
    const args = [];
    // `add(sql, ...vals)` substitutes ? placeholders in `sql` with positional
    // $N markers and appends the values to `args` in order.
    const add = (sql, ...vals) => {
      let n = args.length;
      const placed = sql.replace(/\?/g, () => '$' + (++n));
      vals.forEach((v) => args.push(v));
      wheres.push(placed);
    };

    if (req.query.event_type) add('a.event_type = ?', req.query.event_type);
    if (req.query.actor_id) add('a.actor_id = ?', Number(req.query.actor_id));
    if (req.query.target_type) {
      if (!TARGET_TYPES.has(req.query.target_type)) {
        throw httpError(400, 'Invalid target_type.');
      }
      add('a.target_type = ?', req.query.target_type);
    }
    if (req.query.target_id) add('a.target_id = ?', Number(req.query.target_id));
    if (req.query.actor_email) {
      add('u.email ILIKE ?', '%' + req.query.actor_email + '%');
    }
    if (req.query.from) add('a.created_at >= ?::timestamptz', req.query.from);
    if (req.query.to) add('a.created_at < (?::date + 1)::timestamptz', req.query.to);
    if (req.query.q) {
      const v = '%' + req.query.q + '%';
      add('(a.ip ILIKE ? OR u.email ILIKE ? OR a.payload::text ILIKE ?)', v, v, v);
    }

    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    args.push(limit, offset);
    const limitIdx = args.length - 1;
    const offsetIdx = args.length;

    const rows = (await query(
      `${BASE_SELECT} ${where} ORDER BY a.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      args
    )).rows;

    // Total count for pagination — same WHERE, no LIMIT/OFFSET.
    const countArgs = args.slice(0, args.length - 2);
    const totalRow = (await query(
      `SELECT COUNT(*)::int AS n
       FROM audit_events a
       LEFT JOIN users u ON u.id = a.actor_id
       ${where}`,
      countArgs
    )).rows[0];

    res.json({
      events: rows.map(projectEvent),
      total: totalRow.n,
      limit,
      offset,
    });
  })
);

// --- /api/audit/event-types -- super-admin ----------------------------------
router.get(
  '/event-types',
  requireSuperAdmin,
  wrap(async (_req, res) => {
    const { rows } = await query(
      `SELECT event_type, COUNT(*)::int AS n
       FROM audit_events
       GROUP BY event_type
       ORDER BY event_type`
    );
    res.json({ event_types: rows });
  })
);

// --- /api/audit/for/:type/:id -- any authed user, scoped to one record ------
router.get(
  '/for/:type/:id',
  wrap(async (req, res) => {
    const type = req.params.type;
    const id = Number(req.params.id);
    if (!TARGET_TYPES.has(type) || !id) {
      throw httpError(400, 'Invalid target.');
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const { rows } = await query(
      `${BASE_SELECT}
       WHERE a.target_type = $1 AND a.target_id = $2
       ORDER BY a.id DESC
       LIMIT $3`,
      [type, id, limit]
    );
    res.json({ events: rows.map(projectEvent) });
  })
);

module.exports = router;
