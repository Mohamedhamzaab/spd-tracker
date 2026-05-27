// ---------------------------------------------------------------------------
//  Authorities  -  the parent register.
// ---------------------------------------------------------------------------
const express = require('express');
const { query, withTransaction } = require('../db');
const { wrap, httpError, suggestCode } = require('../helpers');
const { requireEditor } = require('../auth');

const router = express.Router();

const CATEGORIES = [
  'Government Ministry',
  'Statutory or Regulatory Authority',
  'Utility Provider',
  'Service Provider',
  'Certification Body',
  'Adjacent Operator',
];

// GET /api/authorities  -  full register with rolled-up counts.
router.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT * FROM v_authority ORDER BY name'
    );
    res.json(rows);
  })
);

// GET /api/authorities/suggest-code?name=...  -  abbreviation suggestion.
router.get(
  '/suggest-code',
  wrap(async (req, res) => {
    res.json({ code: suggestCode(req.query.name || '') });
  })
);

// GET /api/authorities/:id  -  one authority plus its sub-divisions.
router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const authority = await query('SELECT * FROM v_authority WHERE id = $1', [id]);
    if (!authority.rows[0]) throw httpError(404, 'Authority not found.');

    const subs = await query(
      'SELECT * FROM v_sub_division WHERE authority_id = $1 ORDER BY seq_no',
      [id]
    );
    res.json({ ...authority.rows[0], sub_divisions: subs.rows });
  })
);

// POST /api/authorities  -  create. Code is suggested if not supplied.
router.post(
  '/',
  requireEditor,
  wrap(async (req, res) => {
    const b = req.body || {};
    const name = (b.name || '').trim();
    if (!name) throw httpError(400, 'An authority name is required.');
    if (!b.category || !CATEGORIES.includes(b.category)) {
      throw httpError(400, 'A valid category is required.');
    }

    let code = (b.code || '').trim().toUpperCase();
    if (!code) code = suggestCode(name);
    if (!code) throw httpError(400, 'Could not determine an authority code.');

    const clash = await query('SELECT 1 FROM authorities WHERE code = $1', [code]);
    if (clash.rows[0]) {
      throw httpError(409, `The code "${code}" is already in use.`);
    }

    const { rows } = await query(
      `INSERT INTO authorities
         (code, name, category, influence_level, decision_authority,
          engagement_strategy, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        code,
        name,
        b.category,
        b.influence_level || null,
        b.decision_authority || null,
        b.engagement_strategy || null,
        b.notes || null,
      ]
    );
    const created = await query('SELECT * FROM v_authority WHERE id = $1', [
      rows[0].id,
    ]);
    res.status(201).json(created.rows[0]);
  })
);

// PUT /api/authorities/:id  -  update editable fields.
router.put(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const exists = await query('SELECT id FROM authorities WHERE id = $1', [id]);
    if (!exists.rows[0]) throw httpError(404, 'Authority not found.');

    await query(
      `UPDATE authorities SET
         name = COALESCE($2, name),
         category = COALESCE($3, category),
         influence_level = $4,
         decision_authority = $5,
         engagement_strategy = $6,
         notes = $7,
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        b.name ? b.name.trim() : null,
        b.category || null,
        b.influence_level || null,
        b.decision_authority || null,
        b.engagement_strategy || null,
        b.notes || null,
      ]
    );
    const updated = await query('SELECT * FROM v_authority WHERE id = $1', [id]);
    res.json(updated.rows[0]);
  })
);

// DELETE /api/authorities/:id  -  removes the authority and everything under it.
router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await withTransaction(async (client) => {
      const found = await client.query('SELECT id FROM authorities WHERE id = $1', [id]);
      if (!found.rows[0]) throw httpError(404, 'Authority not found.');
      await client.query('DELETE FROM authorities WHERE id = $1', [id]);
    });
    res.json({ ok: true });
  })
);

module.exports = router;
