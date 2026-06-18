// ---------------------------------------------------------------------------
//  QDRS records — the Qatar Design Review System (Ashghal / PWA) log. One row
//  per "data received" event, linked to the sub-authority (sub_division) it
//  came from. qdrs_code (Q-0001) is server-assigned and re-flowed by date,
//  exactly like communications. Documents attach via parent_type='qdrs'.
// ---------------------------------------------------------------------------
const express = require('express');
const { query, withTransaction } = require('../db');
const { wrap, httpError, ref } = require('../helpers');
const { requireEditor } = require('../auth');
const { logAudit } = require('../audit');
const { softDeleteQdrs, newGroupId } = require('../softDelete');
const { renumberQdrs } = require('../renumberComms');

const router = express.Router();

// GET /api/qdrs  -  whole log, optionally filtered.
//   ?sub_division_id=  ?authority_id=  ?category=
//   ?from=YYYY-MM-DD   ?to=YYYY-MM-DD
//   ?q=search (code / reference / summary / sub-division / authority)
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
    if (req.query.category) add('category = ?', req.query.category);
    if (req.query.from) add('qdrs_date >= ?::date', req.query.from);
    if (req.query.to) add('qdrs_date <= ?::date', req.query.to);

    if (req.query.q) {
      const q = String(req.query.q).trim();
      if (q.length < 3) {
        params.push('%' + q.toLowerCase() + '%');
        const p = '$' + params.length;
        where.push(`(lower(qdrs_code) LIKE ${p}
                     OR lower(coalesce(reference,'')) LIKE ${p}
                     OR lower(sub_division_name) LIKE ${p}
                     OR lower(authority_name) LIKE ${p})`);
      } else {
        params.push(q);
        const p = '$' + params.length;
        where.push(`(
          id IN (SELECT id FROM qdrs_records WHERE search_tsv @@ websearch_to_tsquery('english', ${p}))
          OR lower(sub_division_name) ILIKE '%' || lower(${p}) || '%'
          OR lower(authority_name) ILIKE '%' || lower(${p}) || '%'
        )`);
      }
    }

    const sql =
      'SELECT * FROM v_qdrs' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY qdrs_code ASC';
    const { rows } = await query(sql, params);
    res.json(rows);
  })
);

// GET /api/qdrs/:id  -  one record with its attached documents.
router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = await query('SELECT * FROM v_qdrs WHERE id = $1', [id]);
    if (!row.rows[0]) throw httpError(404, 'QDRS record not found.');
    const docs = await query(
      `SELECT id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at
         FROM documents
        WHERE parent_type = 'qdrs' AND parent_id = $1 AND deleted_at IS NULL
        ORDER BY uploaded_at`,
      [id]
    );
    res.json({ ...row.rows[0], documents: docs.rows });
  })
);

// POST /api/qdrs  -  log a new "data received" entry.
router.post(
  '/',
  requireEditor,
  wrap(async (req, res) => {
    const b = req.body || {};
    const subId = Number(b.sub_division_id);
    if (!subId) throw httpError(400, 'A sub-authority (sub-division) is required.');
    if (!b.qdrs_date) throw httpError(400, 'A date is required.');

    const created = await withTransaction(async (client) => {
      const sub = await client.query('SELECT id FROM sub_divisions WHERE id = $1', [subId]);
      if (!sub.rows[0]) throw httpError(404, 'Sub-division not found.');

      const seqRow = await client.query(
        `SELECT COALESCE(MAX(CAST(substring(qdrs_code from 3) AS INTEGER)), 0) + 1 AS next
           FROM qdrs_records`
      );
      const code = ref('Q', seqRow.rows[0].next, 4);

      const ins = await client.query(
        `INSERT INTO qdrs_records
           (qdrs_code, sub_division_id, qdrs_date, reference, category, summary, logged_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [
          code,
          subId,
          b.qdrs_date,
          b.reference || null,
          b.category || null,
          b.summary || null,
          (req.user && req.user.name) || null,
        ]
      );
      const newId = ins.rows[0].id;
      // Re-flow codes so the log stays chronological (earliest = Q-0001).
      await renumberQdrs(client);
      return newId;
    });

    const row = await query('SELECT * FROM v_qdrs WHERE id = $1', [created]);
    await logAudit({
      actor_id: req.user.id,
      event: 'data.qdrs.created',
      target_type: 'qdrs',
      target_id: row.rows[0].id,
      payload: { qdrs_code: row.rows[0].qdrs_code, sub_division: row.rows[0].sub_reference },
      req,
    });
    res.status(201).json(row.rows[0]);
  })
);

// POST /api/qdrs/bulk-delete  { ids: [..] }
router.post(
  '/bulk-delete',
  requireEditor,
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids)
      ? [...new Set(req.body.ids.map(Number).filter(Boolean))]
      : [];
    if (!ids.length) throw httpError(400, 'No QDRS records selected.');

    const deleted = [];
    await withTransaction(async (client) => {
      for (const id of ids) {
        const found = await client.query(
          'SELECT id, qdrs_code FROM qdrs_records WHERE id = $1 AND deleted_at IS NULL',
          [id]
        );
        if (!found.rows[0]) continue;
        const group = newGroupId();
        await softDeleteQdrs(client, group, req.user.id, id);
        deleted.push({ id, qdrs_code: found.rows[0].qdrs_code, group });
      }
      if (deleted.length) await renumberQdrs(client);
    });

    for (const d of deleted) {
      await logAudit({
        actor_id: req.user.id,
        event: 'data.qdrs.deleted',
        target_type: 'qdrs',
        target_id: d.id,
        payload: { qdrs_code: d.qdrs_code, deletion_group_id: d.group, bulk: true },
        req,
      });
    }
    res.json({ ok: true, deleted: deleted.length });
  })
);

// PUT /api/qdrs/:id
router.put(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const exists = await query('SELECT id FROM qdrs_records WHERE id = $1', [id]);
    if (!exists.rows[0]) throw httpError(404, 'QDRS record not found.');

    // The sub-authority may be corrected; validate it if supplied.
    if (b.sub_division_id) {
      const sub = await query('SELECT id FROM sub_divisions WHERE id = $1', [Number(b.sub_division_id)]);
      if (!sub.rows[0]) throw httpError(404, 'Sub-division not found.');
    }

    await query(
      `UPDATE qdrs_records SET
         sub_division_id = COALESCE($2, sub_division_id),
         qdrs_date = COALESCE($3, qdrs_date),
         reference = $4,
         category = $5,
         summary = $6,
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        b.sub_division_id ? Number(b.sub_division_id) : null,
        b.qdrs_date || null,
        b.reference || null,
        b.category || null,
        b.summary || null,
      ]
    );
    const row = await query('SELECT * FROM v_qdrs WHERE id = $1', [id]);
    await logAudit({
      actor_id: req.user.id,
      event: 'data.qdrs.updated',
      target_type: 'qdrs',
      target_id: id,
      payload: { qdrs_code: row.rows[0].qdrs_code },
      req,
    });
    res.json(row.rows[0]);
  })
);

// DELETE /api/qdrs/:id
router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    let snapshot = null;
    let group = null;
    await withTransaction(async (client) => {
      const found = await client.query(
        'SELECT id, qdrs_code FROM qdrs_records WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      if (!found.rows[0]) throw httpError(404, 'QDRS record not found.');
      snapshot = found.rows[0];
      group = newGroupId();
      await softDeleteQdrs(client, group, req.user.id, id);
      await renumberQdrs(client);
    });
    await logAudit({
      actor_id: req.user.id,
      event: 'data.qdrs.deleted',
      target_type: 'qdrs',
      target_id: id,
      payload: { qdrs_code: snapshot.qdrs_code, deletion_group_id: group },
      req,
    });
    res.json({ ok: true });
  })
);

module.exports = router;
