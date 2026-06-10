// ---------------------------------------------------------------------------
//  Authorities  -  the parent register.
// ---------------------------------------------------------------------------
const express = require('express');
const { query, withTransaction } = require('../db');
const { wrap, httpError, suggestCode } = require('../helpers');
const { requireEditor } = require('../auth');
const { logAudit } = require('../audit');
const { softDeleteAuthority, newGroupId } = require('../softDelete');
const { renumberCommunications, renumberMeetings } = require('../renumberComms');

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
    await logAudit({
      actor_id: req.user.id,
      event: 'data.authority.created',
      target_type: 'authority',
      target_id: created.rows[0].id,
      payload: { code: created.rows[0].code, name: created.rows[0].name },
      req,
    });
    res.status(201).json(created.rows[0]);
  })
);

// PUT /api/authorities/:id  -  update editable fields (code included).
router.put(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const cur = await query('SELECT id, code FROM authorities WHERE id = $1', [id]);
    if (!cur.rows[0]) throw httpError(404, 'Authority not found.');

    // The code is editable. When it changes, validate uniqueness and re-derive
    // the sub_reference of every sub-division under this authority so the
    // references stay consistent (e.g. KM-S01 -> NEW-S01).
    const newCode = (b.code || '').trim().toUpperCase();
    const codeChanged = !!newCode && newCode !== cur.rows[0].code;
    if (codeChanged) {
      const clash = await query(
        'SELECT 1 FROM authorities WHERE code = $1 AND id <> $2', [newCode, id]
      );
      if (clash.rows[0]) throw httpError(409, `The code "${newCode}" is already in use.`);
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE authorities SET
           code = COALESCE($2, code),
           name = COALESCE($3, name),
           category = COALESCE($4, category),
           influence_level = $5,
           decision_authority = $6,
           engagement_strategy = $7,
           notes = $8,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          codeChanged ? newCode : null,
          b.name ? b.name.trim() : null,
          b.category || null,
          b.influence_level || null,
          b.decision_authority || null,
          b.engagement_strategy || null,
          b.notes || null,
        ]
      );
      if (codeChanged) {
        await client.query(
          `UPDATE sub_divisions
              SET sub_reference = $1 || '-S' || lpad(seq_no::text, 2, '0'),
                  updated_at = now()
            WHERE authority_id = $2`,
          [newCode, id]
        );
      }
    });

    const updated = await query('SELECT * FROM v_authority WHERE id = $1', [id]);
    await logAudit({
      actor_id: req.user.id,
      event: 'data.authority.updated',
      target_type: 'authority',
      target_id: id,
      payload: { code: updated.rows[0].code, name: updated.rows[0].name },
      req,
    });
    res.json(updated.rows[0]);
  })
);

// DELETE /api/authorities/:id  -  removes the authority and everything under it.
// DELETE soft-deletes the authority and cascades the same deletion_group_id
// down through sub-divisions, meetings, communications and documents so the
// whole sub-tree can be restored atomically from Trash later.
router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    let snapshot = null;
    let group = null;
    await withTransaction(async (client) => {
      const found = await client.query(
        'SELECT id, code, name FROM authorities WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      if (!found.rows[0]) throw httpError(404, 'Authority not found.');
      snapshot = found.rows[0];
      group = newGroupId();
      await softDeleteAuthority(client, group, req.user.id, id);
      // The cascade soft-deletes this authority's communications and meetings;
      // re-flow both so the active registers stay clean chronological sequences.
      await renumberCommunications(client);
      await renumberMeetings(client);
    });
    await logAudit({
      actor_id: req.user.id,
      event: 'data.authority.deleted',
      target_type: 'authority',
      target_id: id,
      payload: { code: snapshot.code, name: snapshot.name, deletion_group_id: group },
      req,
    });
    res.json({ ok: true });
  })
);

module.exports = router;
