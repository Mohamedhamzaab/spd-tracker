// ---------------------------------------------------------------------------
//  Sub-divisions  -  each belongs to one authority. The sequence number and
//  the sub_reference (KM-S01) are assigned by the server, never by the client.
// ---------------------------------------------------------------------------
const express = require('express');
const { query, withTransaction } = require('../db');
const { wrap, httpError, ref } = require('../helpers');
const { requireEditor } = require('../auth');

const router = express.Router();

// GET /api/sub-divisions  -  whole register, optionally filtered.
//   ?authority_id=  ?status=  ?q=
router.get(
  '/',
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.authority_id) {
      params.push(Number(req.query.authority_id));
      where.push(`authority_id = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      where.push(`engagement_status = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${req.query.q.toLowerCase()}%`);
      where.push(
        `(lower(name) LIKE $${params.length} OR lower(sub_reference) LIKE $${params.length}
          OR lower(authority_name) LIKE $${params.length})`
      );
    }
    const sql =
      'SELECT * FROM v_sub_division' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY authority_code, seq_no';
    const { rows } = await query(sql, params);
    res.json(rows);
  })
);

// GET /api/sub-divisions/:id  -  one sub-division plus its communication thread.
router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const sub = await query('SELECT * FROM v_sub_division WHERE id = $1', [id]);
    if (!sub.rows[0]) throw httpError(404, 'Sub-division not found.');

    const comms = await query(
      `SELECT * FROM v_communication
        WHERE sub_division_id = $1
        ORDER BY comm_date DESC, id DESC`,
      [id]
    );
    res.json({ ...sub.rows[0], communications: comms.rows });
  })
);

// POST /api/sub-divisions  -  create under a parent authority.
router.post(
  '/',
  requireEditor,
  wrap(async (req, res) => {
    const b = req.body || {};
    const authorityId = Number(b.authority_id);
    const name = (b.name || '').trim();
    if (!authorityId) throw httpError(400, 'A parent authority is required.');
    if (!name) throw httpError(400, 'A sub-division name is required.');

    const created = await withTransaction(async (client) => {
      const auth = await client.query('SELECT code FROM authorities WHERE id = $1', [
        authorityId,
      ]);
      if (!auth.rows[0]) throw httpError(404, 'Parent authority not found.');

      const seqRow = await client.query(
        'SELECT COALESCE(MAX(seq_no), 0) + 1 AS next FROM sub_divisions WHERE authority_id = $1',
        [authorityId]
      );
      const seq = seqRow.rows[0].next;
      const subReference = ref(`${auth.rows[0].code}-S`, seq, 2).replace('-S-', '-S');
      const finalRef = `${auth.rows[0].code}-S${String(seq).padStart(2, '0')}`;

      const ins = await client.query(
        `INSERT INTO sub_divisions
           (authority_id, seq_no, sub_reference, name, discipline,
            primary_objective, target_stage, date_identified,
            primary_contact, designation, contact_details,
            data_collection_status, consultation_status, noc_status,
            outcome_secured)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          authorityId,
          seq,
          finalRef,
          name,
          b.discipline || null,
          b.primary_objective || null,
          b.target_stage || null,
          b.date_identified || null,
          b.primary_contact || null,
          b.designation || null,
          b.contact_details || null,
          b.data_collection_status || 'Not Started',
          b.consultation_status || 'Not Started',
          b.noc_status || 'Not Started',
          b.outcome_secured === true,
        ]
      );
      return ins.rows[0].id;
    });

    const row = await query('SELECT * FROM v_sub_division WHERE id = $1', [created]);
    res.status(201).json(row.rows[0]);
  })
);

// PUT /api/sub-divisions/:id  -  update editable fields.
router.put(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const exists = await query('SELECT id FROM sub_divisions WHERE id = $1', [id]);
    if (!exists.rows[0]) throw httpError(404, 'Sub-division not found.');

    await query(
      `UPDATE sub_divisions SET
         name = COALESCE($2, name),
         discipline = $3,
         primary_objective = $4,
         target_stage = $5,
         date_identified = $6,
         primary_contact = $7,
         designation = $8,
         contact_details = $9,
         data_collection_status = COALESCE($10, data_collection_status),
         consultation_status = COALESCE($11, consultation_status),
         noc_status = COALESCE($12, noc_status),
         outcome_secured = COALESCE($13, outcome_secured),
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        b.name ? b.name.trim() : null,
        b.discipline || null,
        b.primary_objective || null,
        b.target_stage || null,
        b.date_identified || null,
        b.primary_contact || null,
        b.designation || null,
        b.contact_details || null,
        b.data_collection_status || null,
        b.consultation_status || null,
        b.noc_status || null,
        typeof b.outcome_secured === 'boolean' ? b.outcome_secured : null,
      ]
    );
    const row = await query('SELECT * FROM v_sub_division WHERE id = $1', [id]);
    res.json(row.rows[0]);
  })
);

// DELETE /api/sub-divisions/:id
router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const found = await query('SELECT id FROM sub_divisions WHERE id = $1', [id]);
    if (!found.rows[0]) throw httpError(404, 'Sub-division not found.');
    await query('DELETE FROM sub_divisions WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

module.exports = router;
