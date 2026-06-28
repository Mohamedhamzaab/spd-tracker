// ---------------------------------------------------------------------------
//  Meetings  -  the meeting_code (M-001) is assigned by the server. Attendees,
//  outcomes and actions are not held here; they live in the MoM.
// ---------------------------------------------------------------------------
const express = require('express');
const { query, withTransaction } = require('../db');
const { wrap, httpError, ref } = require('../helpers');
const { requireEditor } = require('../auth');
const { logAudit } = require('../audit');
const { softDeleteMeeting, newGroupId } = require('../softDelete');
const { renumberMeetings } = require('../renumberComms');

const router = express.Router();

// GET /api/meetings  -  whole register, optionally filtered.
//   ?authority_id=
//   ?from=YYYY-MM-DD  ?to=YYYY-MM-DD
//   ?q=natural language search (Postgres websearch_to_tsquery)
router.get(
  '/',
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.authority_id) {
      params.push(Number(req.query.authority_id));
      where.push(`m.authority_id = $${params.length}`);
    }
    if (req.query.from) {
      params.push(req.query.from);
      where.push(`m.meeting_date >= $${params.length}::date`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      where.push(`m.meeting_date <= $${params.length}::date`);
    }
    if (['pending', 'draft', 'final'].includes(req.query.mom_status)) {
      params.push(req.query.mom_status);
      where.push(`m.mom_status = $${params.length}`);
    }
    if (req.query.q) {
      const q = String(req.query.q).trim();
      if (q.length < 3) {
        params.push('%' + q.toLowerCase() + '%');
        const p = '$' + params.length;
        where.push(`(lower(m.meeting_code) LIKE ${p}
                     OR lower(m.mom_reference) LIKE ${p}
                     OR lower(a.name) LIKE ${p})`);
      } else {
        params.push(q);
        const p = '$' + params.length;
        where.push(`(m.search_tsv @@ websearch_to_tsquery('english', ${p})
                     OR lower(a.name) ILIKE '%' || lower(${p}) || '%')`);
      }
    }
    // Filter soft-deleted meetings out of the main list. The Trash page
    // queries the base table directly when it wants to see them.
    where.push('m.deleted_at IS NULL');
    const sql =
      `SELECT m.*, a.code AS authority_code, a.name AS authority_name,
              sd.sub_reference AS primary_sub_reference,
              sd.name AS primary_sub_name,
              (SELECT count(*) FROM documents d
                 WHERE d.parent_type = 'meeting' AND d.parent_id = m.id
                   AND d.deleted_at IS NULL) AS document_count
         FROM meetings m
         JOIN authorities a ON a.id = m.authority_id AND a.deleted_at IS NULL
         LEFT JOIN sub_divisions sd ON sd.id = m.primary_sub_id` +
      ' WHERE ' + where.join(' AND ') +
      " ORDER BY m.meeting_date DESC, coalesce(m.meeting_time, '00:00:00') DESC, m.id DESC";
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
        WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [id]
    );
    if (!rows[0]) throw httpError(404, 'Meeting not found.');
    const docs = await query(
      `SELECT id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at
         FROM documents
        WHERE parent_type = 'meeting' AND parent_id = $1
          AND deleted_at IS NULL
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

      const momStatus = ['pending', 'draft', 'final'].includes(b.mom_status) ? b.mom_status : 'pending';
      const ins = await client.query(
        `INSERT INTO meetings
           (meeting_code, authority_id, primary_sub_id, other_sub_divisions,
            meeting_date, meeting_time, purpose, mode, location, mom_reference,
            mom_link, mom_status, attendees)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          code,
          authorityId,
          primarySubId,
          b.other_sub_divisions || null,
          b.meeting_date,
          b.meeting_time || null,
          b.purpose || null,
          b.mode || null,
          b.location || null,
          b.mom_reference || null,
          b.mom_link || null,
          momStatus,
          b.attendees || null,
        ]
      );
      const newId = ins.rows[0].id;
      // Re-flow codes so the register stays a clean chronological sequence
      // (earliest meeting_date = M-001, no gaps), even after past deletions.
      await renumberMeetings(client);
      return newId;
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
    await logAudit({
      actor_id: req.user.id,
      event: 'data.meeting.created',
      target_type: 'meeting',
      target_id: rows[0].id,
      payload: {
        meeting_code: rows[0].meeting_code,
        authority_code: rows[0].authority_code,
      },
      req,
    });
    res.status(201).json(rows[0]);
  })
);

// POST /api/meetings/bulk-delete  { ids: [..] }
// Soft-delete several meetings at once (into Trash), then re-flow the codes so
// the active register stays a clean chronological sequence.
router.post(
  '/bulk-delete',
  requireEditor,
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids)
      ? [...new Set(req.body.ids.map(Number).filter(Boolean))]
      : [];
    if (!ids.length) throw httpError(400, 'No meetings selected.');

    const deleted = [];
    await withTransaction(async (client) => {
      for (const id of ids) {
        const found = await client.query(
          'SELECT id, meeting_code FROM meetings WHERE id = $1 AND deleted_at IS NULL',
          [id]
        );
        if (!found.rows[0]) continue;
        const group = newGroupId();
        await softDeleteMeeting(client, group, req.user.id, id);
        deleted.push({ id, meeting_code: found.rows[0].meeting_code, group });
      }
      if (deleted.length) await renumberMeetings(client);
    });

    for (const d of deleted) {
      await logAudit({
        actor_id: req.user.id,
        event: 'data.meeting.deleted',
        target_type: 'meeting',
        target_id: d.id,
        payload: { meeting_code: d.meeting_code, deletion_group_id: d.group, bulk: true },
        req,
      });
    }
    res.json({ ok: true, deleted: deleted.length });
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

    const momStatus = ['pending', 'draft', 'final'].includes(b.mom_status) ? b.mom_status : null;
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
         meeting_time = $12,
         mom_status = COALESCE($13, mom_status),
         attendees = $14,
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
        b.meeting_time || null,
        momStatus,
        b.attendees || null,
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
    await logAudit({
      actor_id: req.user.id,
      event: 'data.meeting.updated',
      target_type: 'meeting',
      target_id: id,
      payload: {
        meeting_code: rows[0].meeting_code,
        authority_code: rows[0].authority_code,
      },
      req,
    });
    res.json(rows[0]);
  })
);

// DELETE /api/meetings/:id
router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    let snapshot = null;
    let group = null;
    await withTransaction(async (client) => {
      const found = await client.query(
        'SELECT id, meeting_code FROM meetings WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      if (!found.rows[0]) throw httpError(404, 'Meeting not found.');
      snapshot = found.rows[0];
      group = newGroupId();
      await softDeleteMeeting(client, group, req.user.id, id);
      // Re-flow the codes so the active list stays chronological with no gaps.
      await renumberMeetings(client);
    });
    await logAudit({
      actor_id: req.user.id,
      event: 'data.meeting.deleted',
      target_type: 'meeting',
      target_id: id,
      payload: { meeting_code: snapshot.meeting_code, deletion_group_id: group },
      req,
    });
    res.json({ ok: true });
  })
);

module.exports = router;
