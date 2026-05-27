// ---------------------------------------------------------------------------
//  Meetings  -  the meeting_code (M-001) is assigned by the server. Attendees,
//  outcomes and actions are not held here; they live in the MoM.
// ---------------------------------------------------------------------------
const express = require('express');
const { query, withTransaction } = require('../db');
const { wrap, httpError, ref } = require('../helpers');
const { requireEditor } = require('../auth');

const router = express.Router();

// GET /api/meetings  -  whole register, optionally filtered.
//   ?authority_id=  ?q=
router.get(
  '/',
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.authority_id) {
      params.push(Number(req.query.authority_id));
      where.push(`m.authority_id = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${req.query.q.toLowerCase()}%`);
      const p = `$${params.length}`;
      where.push(
        `(lower(a.name) LIKE ${p} OR lower(m.meeting_code) LIKE ${p}
          OR lower(m.mom_reference) LIKE ${p} OR lower(m.location) LIKE ${p})`
      );
    }
    const sql =
      `SELECT m.*, a.code AS authority_code, a.name AS authority_name,
              sd.sub_reference AS primary_sub_reference,
              sd.name AS primary_sub_name,
              (SELECT count(*) FROM documents d
                 WHERE d.parent_type = 'meeting' AND d.parent_id = m.id) AS document_count
         FROM meetings m
         JOIN authorities a ON a.id = m.authority_id
         LEFT JOIN sub_divisions sd ON sd.id = m.primary_sub_id` +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY m.meeting_date DESC, m.id DESC';
    const { rows } = await query(sql, params);
    res.json(rows);
  })
);

// GET /api/meetings/:id  -  one meeting with attached documents.
router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query(
      `SELECT m.*, a.code AS authority_code, a.name AS authority_name,
              sd.sub_reference AS primary_sub_reference, sd.name AS primary_sub_name
         FROM meetings m
         JOIN authorities a ON a.id = m.authority_id
         LEFT JOIN sub_divisions sd ON sd.id = m.primary_sub_id
        WHERE m.id = $1`,
      [id]
    );
    if (!rows[0]) throw httpError(404, 'Meeting not found.');
    const docs = await query(
      `SELECT id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at
         FROM documents WHERE parent_type = 'meeting' AND parent_id = $1
        ORDER BY uploaded_at`,
      [id]
    );
    res.json({ ...rows[0], documents: docs.rows });
  })
);

// POST /api/meetings
router.post(
  '/',
  requireEditor,
  wrap(async (req, res) => {
    const b = req.body || {};
    const authorityId = Number(b.authority_id);
    if (!authorityId) throw httpError(400, 'An authority is required.');
    if (!b.meeting_date) throw httpError(400, 'A date is required.');

    const created = await withTransaction(async (client) => {
      const auth = await client.query('SELECT id FROM authorities WHERE id = $1', [
        authorityId,
      ]);
      if (!auth.rows[0]) throw httpError(404, 'Authority not found.');

      // The primary sub-division, if given, must belong to that authority.
      let primarySubId = null;
      if (b.primary_sub_id) {
        const sub = await client.query(
          'SELECT id FROM sub_divisions WHERE id = $1 AND authority_id = $2',
          [Number(b.primary_sub_id), authorityId]
        );
        if (!sub.rows[0]) {
          throw httpError(400, 'The primary sub-division does not belong to that authority.');
        }
        primarySubId = sub.rows[0].id;
      }

      const seqRow = await client.query(
        `SELECT COALESCE(MAX(CAST(substring(meeting_code from 3) AS INTEGER)), 0) + 1 AS next
           FROM meetings`
      );
      const code = ref('M', seqRow.rows[0].next, 3);

      const ins = await client.query(
        `INSERT INTO meetings
           (meeting_code, authority_id, primary_sub_id, other_sub_divisions,
            meeting_date, purpose, mode, location, mom_reference, mom_link)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          code,
          authorityId,
          primarySubId,
          b.other_sub_divisions || null,
          b.meeting_date,
          b.purpose || null,
          b.mode || null,
          b.location || null,
          b.mom_reference || null,
          b.mom_link || null,
        ]
      );
      return ins.rows[0].id;
    });

    const { rows } = await query(
      `SELECT m.*, a.code AS authority_code, a.name AS authority_name,
              sd.sub_reference AS primary_sub_reference, sd.name AS primary_sub_name
         FROM meetings m
         JOIN authorities a ON a.id = m.authority_id
         LEFT JOIN sub_divisions sd ON sd.id = m.primary_sub_id
        WHERE m.id = $1`,
      [created]
    );
    res.status(201).json(rows[0]);
  })
);

// PUT /api/meetings/:id
router.put(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const exists = await query('SELECT authority_id FROM meetings WHERE id = $1', [id]);
    if (!exists.rows[0]) throw httpError(404, 'Meeting not found.');

    let primarySubId;
    if (b.primary_sub_id !== undefined) {
      if (!b.primary_sub_id) {
        primarySubId = null;
      } else {
        const authId = b.authority_id || exists.rows[0].authority_id;
        const sub = await query(
          'SELECT id FROM sub_divisions WHERE id = $1 AND authority_id = $2',
          [Number(b.primary_sub_id), Number(authId)]
        );
        if (!sub.rows[0]) {
          throw httpError(400, 'The primary sub-division does not belong to that authority.');
        }
        primarySubId = sub.rows[0].id;
      }
    }

    await query(
      `UPDATE meetings SET
         authority_id = COALESCE($2, authority_id),
         primary_sub_id = CASE WHEN $3::boolean THEN $4 ELSE primary_sub_id END,
         other_sub_divisions = $5,
         meeting_date = COALESCE($6, meeting_date),
         purpose = $7,
         mode = $8,
         location = $9,
         mom_reference = $10,
         mom_link = $11,
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        b.authority_id ? Number(b.authority_id) : null,
        b.primary_sub_id !== undefined,
        primarySubId === undefined ? null : primarySubId,
        b.other_sub_divisions || null,
        b.meeting_date || null,
        b.purpose || null,
        b.mode || null,
        b.location || null,
        b.mom_reference || null,
        b.mom_link || null,
      ]
    );
    const { rows } = await query(
      `SELECT m.*, a.code AS authority_code, a.name AS authority_name,
              sd.sub_reference AS primary_sub_reference, sd.name AS primary_sub_name
         FROM meetings m
         JOIN authorities a ON a.id = m.authority_id
         LEFT JOIN sub_divisions sd ON sd.id = m.primary_sub_id
        WHERE m.id = $1`,
      [id]
    );
    res.json(rows[0]);
  })
);

// DELETE /api/meetings/:id
router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const found = await query('SELECT id FROM meetings WHERE id = $1', [id]);
    if (!found.rows[0]) throw httpError(404, 'Meeting not found.');
    await query('DELETE FROM meetings WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

module.exports = router;
