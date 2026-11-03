// ---------------------------------------------------------------------------
//  Communications  -  one row per event. The comm_code (C-0001) is assigned
//  by the server. An Inbound row may link to the Outbound row it answers.
// ---------------------------------------------------------------------------
const express = require('express');
const { query, withTransaction } = require('../db');
const { wrap, httpError, ref, ORIGINATORS } = require('../helpers');
const { requireEditor } = require('../auth');
const { logAudit } = require('../audit');
const { softDeleteCommunication, newGroupId } = require('../softDelete');
const { renumberCommunications } = require('../renumberComms');

const router = express.Router();

// Every live communication connected to one row through "in response to" or
// "related to" links, in either direction: the whole conversation, however
// it branches. Ordered oldest first.
const THREAD_SQL = `
  WITH RECURSIVE edges AS (
    SELECT id AS a, in_response_to AS b FROM communications
     WHERE in_response_to IS NOT NULL AND deleted_at IS NULL
    UNION ALL
    SELECT id, related_to FROM communications
     WHERE related_to IS NOT NULL AND deleted_at IS NULL
  ), links AS (
    SELECT a, b FROM edges UNION SELECT b, a FROM edges
  ), thread(id) AS (
    SELECT $1::int
    UNION
    SELECT l.b FROM links l JOIN thread t ON l.a = t.id
  )
  SELECT v.* FROM v_communication v JOIN thread t ON t.id = v.id
  ORDER BY v.comm_date, v.comm_code`;

// Status keys used by the list filter → the computed reply_status.
const STATUS_KEYS = {
  overdue: 'Overdue',
  awaiting: 'Awaiting reply',
  replied: 'Reply received',
  due: 'Our reply due',
  responded: 'We replied',
  none: 'No reply needed',
  logged: 'No reply needed', // older saved views
};

// GET /api/communications  -  whole log, optionally filtered.
//   ?sub_division_id=
//   ?authority_id=
//   ?direction=Outbound|Inbound
//   ?originator=ECG|SPD|EGIS
//   ?overdue=true
//   ?from=YYYY-MM-DD  ?to=YYYY-MM-DD
//   ?status=overdue,awaiting,replied,due,responded,none  (subset, comma-separated)
//   ?thread=C-0041  the whole conversation that letter belongs to
//   ?q=natural language search (Postgres websearch_to_tsquery)
//
// Status keys map onto v_communication.reply_status (see STATUS_KEYS).
router.get(
  '/',
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    const add = (sql, ...vals) => {
      let n = params.length;
      const placed = sql.replace(/\?/g, () => '$' + (++n));
      vals.forEach((v) => params.push(v));
      where.push(placed);
    };

    if (req.query.sub_division_id) add('sub_division_id = ?', Number(req.query.sub_division_id));
    if (req.query.authority_id) add('authority_id = ?', Number(req.query.authority_id));
    if (req.query.direction) add('direction = ?', req.query.direction);
    if (req.query.originator) add('originator = ?', req.query.originator);
    if (req.query.overdue === 'true') where.push('is_overdue = TRUE');
    if (req.query.from) add('comm_date >= ?::date', req.query.from);
    if (req.query.to) add('comm_date <= ?::date', req.query.to);

    // Reply-linkage filter.
    //   linked=replies   → rows that ARE a reply to something (in_response_to set)
    //   linked=originals → rows that are NOT a reply (a standalone / outbound)
    //   linked=answered  → rows that HAVE received a reply
    //   linked=unanswered→ rows still waiting on a reply, either side
    if (req.query.linked) {
      const v = String(req.query.linked);
      if (v === 'replies') where.push('in_response_to IS NOT NULL');
      else if (v === 'originals') where.push('in_response_to IS NULL');
      else if (v === 'answered') where.push('reply_received = TRUE');
      else if (v === 'unanswered')
        where.push("reply_status IN ('Overdue', 'Awaiting reply', 'Our reply due')");
    }

    // Find everything in one thread: ?in_response_to=C-0002 returns the parent
    // plus every reply that points at it. Accepts a comm_code.
    if (req.query.in_response_to) {
      const code = String(req.query.in_response_to).trim().toUpperCase();
      add(
        '(comm_code = ? OR in_response_to_code = ?)',
        code, code
      );
    }

    // The whole conversation a letter belongs to (replies and related letters).
    if (req.query.thread) {
      const code = String(req.query.thread).trim().toUpperCase();
      const start = await query('SELECT id FROM communications WHERE comm_code = $1 AND deleted_at IS NULL', [code]);
      if (!start.rows[0]) return res.json([]);
      const { rows } = await query(THREAD_SQL, [start.rows[0].id]);
      add('id = ANY(?::int[])', rows.map((r) => r.id));
    }

    if (req.query.status) {
      const labels = [...new Set(String(req.query.status).split(',')
        .map((s) => STATUS_KEYS[s.trim()]).filter(Boolean))];
      if (labels.length) add('reply_status = ANY(?::text[])', labels);
    }

    // FTS over the base `communications` table; we still SELECT from the
    // enriched view so the result shape is unchanged.
    if (req.query.q) {
      // websearch_to_tsquery handles quotes, OR/AND/NEGATE naturally.
      // For very short queries (codes like "C-0012") fall back to ILIKE so
      // the user still finds the row.
      const q = String(req.query.q).trim();
      if (q.length < 3) {
        params.push('%' + q.toLowerCase() + '%');
        where.push(`(lower(comm_code) LIKE $${params.length}
                     OR lower(coalesce(in_response_to_code,'')) LIKE $${params.length}
                     OR lower(submission_reference) LIKE $${params.length}
                     OR lower(sub_division_name) LIKE $${params.length}
                     OR lower(authority_name) LIKE $${params.length})`);
      } else {
        params.push(q);
        const p = '$' + params.length;
        where.push(`(
          id IN (SELECT id FROM communications WHERE search_tsv @@ websearch_to_tsquery('english', ${p}))
          OR lower(sub_division_name) ILIKE '%' || lower(${p}) || '%'
          OR lower(authority_name) ILIKE '%' || lower(${p}) || '%'
        )`);
      }
    }

    // Default order is by code (natural register order). The frontend can
    // re-sort client-side, but By-Code is the sane landing order.
    const sql =
      'SELECT * FROM v_communication' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY comm_code ASC';
    const { rows } = await query(sql, params);
    res.json(rows);
  })
);

// GET /api/communications/:id  -  one event with its attached documents and
// the whole conversation it belongs to (itself included).
router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = await query('SELECT * FROM v_communication WHERE id = $1', [id]);
    if (!row.rows[0]) throw httpError(404, 'Communication not found.');
    const docs = await query(
      `SELECT id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at
         FROM documents
        WHERE parent_type = 'communication' AND parent_id = $1
          AND deleted_at IS NULL
        ORDER BY uploaded_at`,
      [id]
    );
    const thread = await query(THREAD_SQL, [id]);
    res.json({ ...row.rows[0], documents: docs.rows, thread: thread.rows });
  })
);

// POST /api/communications  -  log a new event.
router.post(
  '/',
  requireEditor,
  wrap(async (req, res) => {
    const b = req.body || {};
    const subId = Number(b.sub_division_id);
    if (!subId) throw httpError(400, 'A sub-division is required.');
    if (!b.comm_date) throw httpError(400, 'A date is required.');
    if (!['Outbound', 'Inbound'].includes(b.direction)) {
      throw httpError(400, 'Direction must be Outbound or Inbound.');
    }
    const originator = b.originator || 'ECG';
    if (!ORIGINATORS.includes(originator)) {
      throw httpError(400, 'Originator must be ECG, SPD or EGIS.');
    }

    const created = await withTransaction(async (client) => {
      const sub = await client.query('SELECT id FROM sub_divisions WHERE id = $1', [
        subId,
      ]);
      if (!sub.rows[0]) throw httpError(404, 'Sub-division not found.');

      // Resolve the "in response to" code, if given, to a row id.
      let inResponseTo = null;
      if (b.in_response_to) {
        const parent = await client.query(
          'SELECT id FROM communications WHERE comm_code = $1',
          [String(b.in_response_to).trim().toUpperCase()]
        );
        if (!parent.rows[0]) {
          throw httpError(400, `No communication found with code "${b.in_response_to}".`);
        }
        inResponseTo = parent.rows[0].id;
      }

      // Resolve the "related to" code (a non-reply link), if given.
      let relatedTo = null;
      if (b.related_to) {
        const rel = await client.query(
          'SELECT id FROM communications WHERE comm_code = $1',
          [String(b.related_to).trim().toUpperCase()]
        );
        if (!rel.rows[0]) {
          throw httpError(400, `No communication found with code "${b.related_to}".`);
        }
        relatedTo = rel.rows[0].id;
      }

      const seqRow = await client.query(
        `SELECT COALESCE(MAX(CAST(substring(comm_code from 3) AS INTEGER)), 0) + 1 AS next
           FROM communications`
      );
      const code = ref('C', seqRow.rows[0].next, 4);

      const ins = await client.query(
        `INSERT INTO communications
           (comm_code, sub_division_id, comm_date, direction, purpose, mode,
            submission_reference, in_response_to, related_to, summary, reply_needed,
            acc_link, logged_by, originator, latest_update)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          code,
          subId,
          b.comm_date,
          b.direction,
          b.purpose || null,
          b.mode || null,
          b.submission_reference || null,
          inResponseTo,
          relatedTo,
          b.summary || null,
          b.reply_needed === true,
          b.acc_link || null,
          (req.user && req.user.name) || b.logged_by || null,
          originator,
          b.latest_update || null,
        ]
      );
      const newId = ins.rows[0].id;
      // Re-flow codes so the log stays a clean chronological sequence
      // (earliest comm_date = C-0001, no gaps), even after past deletions.
      await renumberCommunications(client);
      return newId;
    });

    const row = await query('SELECT * FROM v_communication WHERE id = $1', [created]);
    await logAudit({
      actor_id: req.user.id,
      event: 'data.communication.created',
      target_type: 'communication',
      target_id: row.rows[0].id,
      payload: {
        comm_code: row.rows[0].comm_code,
        direction: row.rows[0].direction,
        originator: row.rows[0].originator,
        sub_division: row.rows[0].sub_reference,
      },
      req,
    });
    res.status(201).json(row.rows[0]);
  })
);

// POST /api/communications/bulk-delete  { ids: [..] }
// Soft-delete several communications at once (each into Trash, individually
// restorable), then re-flow the codes once so the active list stays a clean
// chronological sequence.
router.post(
  '/bulk-delete',
  requireEditor,
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids)
      ? [...new Set(req.body.ids.map(Number).filter(Boolean))]
      : [];
    if (!ids.length) throw httpError(400, 'No communications selected.');

    const deleted = [];
    await withTransaction(async (client) => {
      for (const id of ids) {
        const found = await client.query(
          'SELECT id, comm_code, direction FROM communications WHERE id = $1 AND deleted_at IS NULL',
          [id]
        );
        if (!found.rows[0]) continue; // skip missing / already-deleted
        const group = newGroupId();
        await softDeleteCommunication(client, group, req.user.id, id);
        deleted.push({ id, comm_code: found.rows[0].comm_code, direction: found.rows[0].direction, group });
      }
      if (deleted.length) await renumberCommunications(client);
    });

    for (const d of deleted) {
      await logAudit({
        actor_id: req.user.id,
        event: 'data.communication.deleted',
        target_type: 'communication',
        target_id: d.id,
        payload: { comm_code: d.comm_code, direction: d.direction, deletion_group_id: d.group, bulk: true },
        req,
      });
    }
    res.json({ ok: true, deleted: deleted.length });
  })
);

// PUT /api/communications/:id
router.put(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const exists = await query('SELECT id FROM communications WHERE id = $1', [id]);
    if (!exists.rows[0]) throw httpError(404, 'Communication not found.');
    if (b.originator && !ORIGINATORS.includes(b.originator)) {
      throw httpError(400, 'Originator must be ECG, SPD or EGIS.');
    }

    let inResponseTo;
    if (b.in_response_to !== undefined) {
      if (!b.in_response_to) {
        inResponseTo = null;
      } else {
        const parent = await query(
          'SELECT id FROM communications WHERE comm_code = $1',
          [String(b.in_response_to).trim().toUpperCase()]
        );
        if (!parent.rows[0]) {
          throw httpError(400, `No communication found with code "${b.in_response_to}".`);
        }
        if (parent.rows[0].id === id) {
          throw httpError(400, 'A communication cannot respond to itself.');
        }
        inResponseTo = parent.rows[0].id;
      }
    }

    let relatedTo;
    if (b.related_to !== undefined) {
      if (!b.related_to) {
        relatedTo = null;
      } else {
        const rel = await query(
          'SELECT id FROM communications WHERE comm_code = $1',
          [String(b.related_to).trim().toUpperCase()]
        );
        if (!rel.rows[0]) {
          throw httpError(400, `No communication found with code "${b.related_to}".`);
        }
        if (rel.rows[0].id === id) {
          throw httpError(400, 'A communication cannot be related to itself.');
        }
        relatedTo = rel.rows[0].id;
      }
    }

    await query(
      `UPDATE communications SET
         comm_date = COALESCE($2, comm_date),
         direction = COALESCE($3, direction),
         purpose = $4,
         mode = $5,
         submission_reference = $6,
         in_response_to = CASE WHEN $7::boolean THEN $8 ELSE in_response_to END,
         summary = $9,
         reply_needed = COALESCE($10, reply_needed),
         acc_link = $11,
         related_to = CASE WHEN $12::boolean THEN $13 ELSE related_to END,
         originator = COALESCE($14, originator),
         latest_update = CASE WHEN $15::boolean THEN $16 ELSE latest_update END,
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        b.comm_date || null,
        b.direction || null,
        b.purpose || null,
        b.mode || null,
        b.submission_reference || null,
        b.in_response_to !== undefined,
        inResponseTo === undefined ? null : inResponseTo,
        b.summary || null,
        typeof b.reply_needed === 'boolean' ? b.reply_needed : null,
        b.acc_link || null,
        b.related_to !== undefined,
        relatedTo === undefined ? null : relatedTo,
        b.originator || null,
        b.latest_update !== undefined,
        b.latest_update || null,
      ]
    );
    const row = await query('SELECT * FROM v_communication WHERE id = $1', [id]);
    await logAudit({
      actor_id: req.user.id,
      event: 'data.communication.updated',
      target_type: 'communication',
      target_id: id,
      payload: {
        comm_code: row.rows[0].comm_code,
        direction: row.rows[0].direction,
      },
      req,
    });
    res.json(row.rows[0]);
  })
);

// DELETE /api/communications/:id
router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    let snapshot = null;
    let group = null;
    await withTransaction(async (client) => {
      const found = await client.query(
        'SELECT id, comm_code, direction FROM communications WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      if (!found.rows[0]) throw httpError(404, 'Communication not found.');
      snapshot = found.rows[0];
      group = newGroupId();
      await softDeleteCommunication(client, group, req.user.id, id);
      // Re-flow the codes so the active list stays chronological with no gaps.
      await renumberCommunications(client);
    });
    await logAudit({
      actor_id: req.user.id,
      event: 'data.communication.deleted',
      target_type: 'communication',
      target_id: id,
      payload: {
        comm_code: snapshot.comm_code,
        direction: snapshot.direction,
        deletion_group_id: group,
      },
      req,
    });
    res.json({ ok: true });
  })
);

module.exports = router;
