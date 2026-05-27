// ---------------------------------------------------------------------------
//  Communications  -  one row per event. The comm_code (C-0001) is assigned
//  by the server. An Inbound row may link to the Outbound row it answers.
// ---------------------------------------------------------------------------
const express = require('express');
const { query, withTransaction } = require('../db');
const { wrap, httpError, ref } = require('../helpers');
const { requireEditor } = require('../auth');

const router = express.Router();

// GET /api/communications  -  whole log, optionally filtered.
//   ?sub_division_id=  ?direction=  ?overdue=true  ?q=
router.get(
  '/',
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.sub_division_id) {
      params.push(Number(req.query.sub_division_id));
      where.push(`sub_division_id = $${params.length}`);
    }
    if (req.query.direction) {
      params.push(req.query.direction);
      where.push(`direction = $${params.length}`);
    }
    if (req.query.overdue === 'true') {
      where.push('is_overdue = TRUE');
    }
    if (req.query.q) {
      params.push(`%${req.query.q.toLowerCase()}%`);
      const p = `$${params.length}`;
      where.push(
        `(lower(summary) LIKE ${p} OR lower(comm_code) LIKE ${p}
          OR lower(submission_reference) LIKE ${p}
          OR lower(sub_division_name) LIKE ${p})`
      );
    }
    const sql =
      'SELECT * FROM v_communication' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY comm_date DESC, id DESC';
    const { rows } = await query(sql, params);
    res.json(rows);
  })
);

// GET /api/communications/:id  -  one event with its attached documents.
router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = await query('SELECT * FROM v_communication WHERE id = $1', [id]);
    if (!row.rows[0]) throw httpError(404, 'Communication not found.');
    const docs = await query(
      `SELECT id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at
         FROM documents WHERE parent_type = 'communication' AND parent_id = $1
        ORDER BY uploaded_at`,
      [id]
    );
    res.json({ ...row.rows[0], documents: docs.rows });
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

      const seqRow = await client.query(
        `SELECT COALESCE(MAX(CAST(substring(comm_code from 3) AS INTEGER)), 0) + 1 AS next
           FROM communications`
      );
      const code = ref('C', seqRow.rows[0].next, 4);

      const ins = await client.query(
        `INSERT INTO communications
           (comm_code, sub_division_id, comm_date, direction, purpose, mode,
            submission_reference, in_response_to, summary, reply_needed,
            acc_link, logged_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
          b.summary || null,
          b.reply_needed === true,
          b.acc_link || null,
          (req.user && req.user.name) || b.logged_by || null,
        ]
      );
      return ins.rows[0].id;
    });

    const row = await query('SELECT * FROM v_communication WHERE id = $1', [created]);
    res.status(201).json(row.rows[0]);
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
      ]
    );
    const row = await query('SELECT * FROM v_communication WHERE id = $1', [id]);
    res.json(row.rows[0]);
  })
);

// DELETE /api/communications/:id
router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const found = await query('SELECT id FROM communications WHERE id = $1', [id]);
    if (!found.rows[0]) throw httpError(404, 'Communication not found.');
    await query('DELETE FROM communications WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

module.exports = router;
