// ---------------------------------------------------------------------------
//  Saved views — named filter presets per user, scoped to a list page
//  (communications, sub_divisions, meetings).
//
//    GET    /api/views                         list all the caller's views
//    GET    /api/views?target=communications   filtered by target
//    POST   /api/views                         create
//    PATCH  /api/views/:id                     rename / replace params /
//                                              toggle is_default
//    DELETE /api/views/:id
// ---------------------------------------------------------------------------
const express = require('express');
const { query } = require('../db');
const { wrap, httpError } = require('../helpers');

const TARGETS = new Set(['communications', 'sub_divisions', 'meetings']);

const router = express.Router();

function shape(row) {
  return {
    id: row.id,
    target: row.target,
    name: row.name,
    params: row.params || {},
    is_default: !!row.is_default,
    created_at: row.created_at,
  };
}

router.get(
  '/',
  wrap(async (req, res) => {
    const where = ['user_id = $1'];
    const args = [req.user.id];
    if (req.query.target) {
      if (!TARGETS.has(req.query.target)) throw httpError(400, 'Unknown target.');
      where.push('target = $2');
      args.push(req.query.target);
    }
    const { rows } = await query(
      `SELECT * FROM saved_views WHERE ${where.join(' AND ')}
       ORDER BY target, lower(name)`,
      args
    );
    res.json({ views: rows.map(shape) });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const target = String(req.body.target || '');
    const params = req.body.params && typeof req.body.params === 'object' ? req.body.params : {};
    if (!name) throw httpError(400, 'Name is required.');
    if (!TARGETS.has(target)) throw httpError(400, 'Target must be communications, sub_divisions, or meetings.');

    const clash = await query(
      'SELECT id FROM saved_views WHERE user_id = $1 AND target = $2 AND name = $3',
      [req.user.id, target, name]
    );
    if (clash.rows[0]) throw httpError(409, 'You already have a view with that name.');

    // Setting is_default also clears any existing default for that target.
    const isDefault = req.body.is_default === true;
    if (isDefault) {
      await query(
        'UPDATE saved_views SET is_default = FALSE WHERE user_id = $1 AND target = $2',
        [req.user.id, target]
      );
    }
    const { rows } = await query(
      `INSERT INTO saved_views (user_id, target, name, params, is_default)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING *`,
      [req.user.id, target, name, JSON.stringify(params), isDefault]
    );
    res.status(201).json({ view: shape(rows[0]) });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    const current = (await query(
      'SELECT * FROM saved_views WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    )).rows[0];
    if (!current) throw httpError(404, 'View not found.');

    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.params !== undefined) patch.params = req.body.params;
    if (req.body.is_default !== undefined) patch.is_default = req.body.is_default === true;

    if (patch.name === '') throw httpError(400, 'Name cannot be empty.');
    if (patch.is_default === true) {
      await query(
        'UPDATE saved_views SET is_default = FALSE WHERE user_id = $1 AND target = $2',
        [req.user.id, current.target]
      );
    }

    const sets = [];
    const args = [];
    if (patch.name !== undefined) { sets.push('name = $' + (args.length + 1)); args.push(patch.name); }
    if (patch.params !== undefined) {
      sets.push('params = $' + (args.length + 1) + '::jsonb');
      args.push(JSON.stringify(patch.params));
    }
    if (patch.is_default !== undefined) { sets.push('is_default = $' + (args.length + 1)); args.push(patch.is_default); }
    if (!sets.length) return res.json({ view: shape(current) });

    args.push(id, req.user.id);
    const { rows } = await query(
      `UPDATE saved_views SET ${sets.join(', ')}
       WHERE id = $${args.length - 1} AND user_id = $${args.length}
       RETURNING *`,
      args
    );
    res.json({ view: shape(rows[0]) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    const r = await query(
      'DELETE FROM saved_views WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (!r.rows[0]) throw httpError(404, 'View not found.');
    res.json({ ok: true });
  })
);

module.exports = router;
