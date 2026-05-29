// ---------------------------------------------------------------------------
//  Comments — threaded against any record. Soft-deletable.
//
//    GET    /api/comments?parent_type=...&parent_id=...   list (any authed)
//    POST   /api/comments  { parent_type, parent_id, body }   create
//    PATCH  /api/comments/:id { body }                        edit (author)
//    DELETE /api/comments/:id                                 author OR super-admin
//
//  Reviewers can post comments too — communication is part of the
//  collaboration surface, not just data CRUD.
// ---------------------------------------------------------------------------
const express = require('express');
const { query } = require('../db');
const { wrap, httpError } = require('../helpers');
const { logAudit } = require('../audit');

const PARENTS = new Set(['communication', 'sub_division', 'meeting', 'authority']);
const MAX_LEN = 4000;

const router = express.Router();

function shape(row) {
  return {
    id: row.id,
    parent_type: row.parent_type,
    parent_id: row.parent_id,
    body: row.body,
    created_at: row.created_at,
    edited_at: row.edited_at,
    author: row.author_id
      ? { id: row.author_id, name: row.author_name, email: row.author_email }
      : null,
  };
}

router.get(
  '/',
  wrap(async (req, res) => {
    const parent_type = req.query.parent_type;
    const parent_id = Number(req.query.parent_id);
    if (!PARENTS.has(parent_type) || !parent_id) {
      throw httpError(400, 'parent_type and parent_id are required.');
    }
    const { rows } = await query(
      `SELECT c.*, u.name AS author_name, u.email AS author_email
       FROM comments c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.parent_type = $1 AND c.parent_id = $2
         AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC, c.id ASC`,
      [parent_type, parent_id]
    );
    res.json({ comments: rows.map(shape) });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const parent_type = req.body.parent_type;
    const parent_id = Number(req.body.parent_id);
    const body = String(req.body.body || '').trim();
    if (!PARENTS.has(parent_type) || !parent_id) {
      throw httpError(400, 'parent_type and parent_id are required.');
    }
    if (!body) throw httpError(400, 'Comment body cannot be empty.');
    if (body.length > MAX_LEN) {
      throw httpError(400, `Comment is too long (max ${MAX_LEN} chars).`);
    }

    const { rows } = await query(
      `INSERT INTO comments (parent_type, parent_id, author_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [parent_type, parent_id, req.user.id, body]
    );
    const inserted = rows[0];

    // Audit + SSE — `data.comment.created` payload carries the parent so
    // the live-view client can refresh the right detail panel.
    await logAudit({
      actor_id: req.user.id,
      event: 'data.comment.created',
      target_type: 'comment',
      target_id: inserted.id,
      payload: { parent_type, parent_id },
      req,
    });

    // Re-fetch with author joined for the response.
    const out = await query(
      `SELECT c.*, u.name AS author_name, u.email AS author_email
       FROM comments c LEFT JOIN users u ON u.id = c.author_id
       WHERE c.id = $1`,
      [inserted.id]
    );
    res.status(201).json({ comment: shape(out.rows[0]) });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    const current = (await query(
      'SELECT * FROM comments WHERE id = $1 AND deleted_at IS NULL',
      [id]
    )).rows[0];
    if (!current) throw httpError(404, 'Comment not found.');
    if (current.author_id !== req.user.id) {
      throw httpError(403, 'You can only edit your own comments.');
    }
    const body = String(req.body.body || '').trim();
    if (!body) throw httpError(400, 'Comment body cannot be empty.');
    if (body.length > MAX_LEN) throw httpError(400, `Comment is too long (max ${MAX_LEN} chars).`);

    await query(
      `UPDATE comments SET body = $1, edited_at = now() WHERE id = $2`,
      [body, id]
    );
    await logAudit({
      actor_id: req.user.id,
      event: 'data.comment.updated',
      target_type: 'comment',
      target_id: id,
      payload: { parent_type: current.parent_type, parent_id: current.parent_id },
      req,
    });
    const out = await query(
      `SELECT c.*, u.name AS author_name, u.email AS author_email
       FROM comments c LEFT JOIN users u ON u.id = c.author_id
       WHERE c.id = $1`,
      [id]
    );
    res.json({ comment: shape(out.rows[0]) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    const current = (await query(
      'SELECT * FROM comments WHERE id = $1 AND deleted_at IS NULL',
      [id]
    )).rows[0];
    if (!current) throw httpError(404, 'Comment not found.');
    if (current.author_id !== req.user.id && req.user.role !== 'super_admin') {
      throw httpError(403, 'You can only delete your own comments.');
    }
    await query(
      `UPDATE comments SET deleted_at = now(), deleted_by = $1 WHERE id = $2`,
      [req.user.id, id]
    );
    await logAudit({
      actor_id: req.user.id,
      event: 'data.comment.deleted',
      target_type: 'comment',
      target_id: id,
      payload: { parent_type: current.parent_type, parent_id: current.parent_id },
      req,
    });
    res.json({ ok: true });
  })
);

module.exports = router;
