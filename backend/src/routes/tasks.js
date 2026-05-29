// ---------------------------------------------------------------------------
//  Tasks — actionable follow-up items polymorphic to any record.
//
//    GET    /api/tasks                          list with filters
//             ?parent_type=&parent_id=          scope to one record
//             ?assignee_id= | ?mine=true        scope to a user
//             ?status=open,done                 subset
//             ?overdue=true                     due_date < today, open only
//    POST   /api/tasks  { parent_type, parent_id, title, ... }
//    PATCH  /api/tasks/:id { title?, description?, assignee_id?, due_date?, status? }
//    DELETE /api/tasks/:id   soft delete
//
//  Permissions:
//    create / edit fields / delete  →  editor+ (admin or super_admin)
//    flip status to 'done'          →  also assignee (so reviewers assigned
//                                       a follow-up can tick it themselves)
//    list / read                    →  any authed user
// ---------------------------------------------------------------------------
const express = require('express');
const { query } = require('../db');
const { wrap, httpError } = require('../helpers');
const { requireEditor } = require('../auth');
const { logAudit } = require('../audit');

const PARENTS = new Set(['communication', 'sub_division', 'meeting', 'authority']);

const router = express.Router();

function shape(row) {
  return {
    id: row.id,
    parent_type: row.parent_type,
    parent_id: row.parent_id,
    title: row.title,
    description: row.description,
    status: row.status,
    due_date: row.due_date,
    created_at: row.created_at,
    completed_at: row.completed_at,
    is_overdue:
      row.status === 'open' && row.due_date &&
      new Date(row.due_date).getTime() < new Date(new Date().toISOString().slice(0, 10)).getTime(),
    assignee: row.assignee_id
      ? { id: row.assignee_id, name: row.assignee_name, email: row.assignee_email }
      : null,
    created_by: row.created_by
      ? { id: row.created_by, name: row.creator_name, email: row.creator_email }
      : null,
  };
}

const BASE_SELECT = `
  SELECT t.*,
         a.name AS assignee_name, a.email AS assignee_email,
         c.name AS creator_name,  c.email AS creator_email
  FROM tasks t
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users c ON c.id = t.created_by
`;

router.get(
  '/',
  wrap(async (req, res) => {
    const where = ['t.deleted_at IS NULL'];
    const args = [];
    const add = (sql, ...vals) => {
      let n = args.length;
      const placed = sql.replace(/\?/g, () => '$' + (++n));
      vals.forEach((v) => args.push(v));
      where.push(placed);
    };

    if (req.query.parent_type && req.query.parent_id) {
      if (!PARENTS.has(req.query.parent_type)) throw httpError(400, 'Invalid parent_type.');
      add('t.parent_type = ?', req.query.parent_type);
      add('t.parent_id = ?', Number(req.query.parent_id));
    }
    if (req.query.assignee_id) add('t.assignee_id = ?', Number(req.query.assignee_id));
    if (req.query.mine === 'true') add('t.assignee_id = ?', req.user.id);
    if (req.query.status) {
      const set = String(req.query.status).split(',').map((s) => s.trim()).filter(Boolean);
      const placeholders = set.map((s) => { args.push(s); return '$' + args.length; });
      if (placeholders.length) where.push('t.status IN (' + placeholders.join(',') + ')');
    }
    if (req.query.overdue === 'true') {
      where.push("(t.status = 'open' AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)");
    }

    const { rows } = await query(
      `${BASE_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY
         CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
         t.due_date NULLS LAST,
         t.id DESC`,
      args
    );
    res.json({ tasks: rows.map(shape) });
  })
);

router.post(
  '/',
  requireEditor,
  wrap(async (req, res) => {
    const b = req.body || {};
    if (!PARENTS.has(b.parent_type)) throw httpError(400, 'Invalid parent_type.');
    const parent_id = Number(b.parent_id);
    const title = String(b.title || '').trim();
    if (!parent_id) throw httpError(400, 'parent_id is required.');
    if (!title) throw httpError(400, 'Title is required.');

    const assignee_id = b.assignee_id ? Number(b.assignee_id) : null;
    if (assignee_id) {
      const ok = await query('SELECT id FROM users WHERE id = $1 AND is_disabled = FALSE', [assignee_id]);
      if (!ok.rows[0]) throw httpError(400, 'Assignee not found.');
    }

    const { rows } = await query(
      `INSERT INTO tasks (parent_type, parent_id, title, description,
                          assignee_id, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [b.parent_type, parent_id, title, b.description || null,
       assignee_id, b.due_date || null, req.user.id]
    );
    await logAudit({
      actor_id: req.user.id,
      event: 'data.task.created',
      target_type: 'task',
      target_id: rows[0].id,
      payload: { parent_type: b.parent_type, parent_id, title, assignee_id, due_date: b.due_date || null },
      req,
    });
    const out = await query(`${BASE_SELECT} WHERE t.id = $1`, [rows[0].id]);
    res.status(201).json({ task: shape(out.rows[0]) });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    const current = (await query(
      'SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL',
      [id]
    )).rows[0];
    if (!current) throw httpError(404, 'Task not found.');

    const isEditor = req.user.role === 'admin' || req.user.role === 'super_admin';
    const isAssignee = current.assignee_id === req.user.id;
    if (!isEditor && !isAssignee) {
      throw httpError(403, 'You don\'t have permission to update this task.');
    }
    // Assignees may only flip status; everything else needs editor.
    const isStatusOnly =
      Object.keys(req.body).length === 1 && Object.prototype.hasOwnProperty.call(req.body, 'status');
    if (!isEditor && !isStatusOnly) {
      throw httpError(403, 'Only an editor can change the title, assignee or due date.');
    }

    const patch = {};
    if (req.body.title !== undefined) patch.title = String(req.body.title).trim();
    if (req.body.description !== undefined) patch.description = req.body.description || null;
    if (req.body.assignee_id !== undefined) patch.assignee_id = req.body.assignee_id ? Number(req.body.assignee_id) : null;
    if (req.body.due_date !== undefined) patch.due_date = req.body.due_date || null;
    if (req.body.status !== undefined) {
      if (!['open', 'done'].includes(req.body.status)) throw httpError(400, 'Invalid status.');
      patch.status = req.body.status;
    }
    if (patch.title === '') throw httpError(400, 'Title cannot be empty.');

    const sets = ['updated_at = now()'];
    const args = [];
    Object.entries(patch).forEach(([k, v]) => { args.push(v); sets.push(`${k} = $${args.length}`); });

    // Stamp completed_at / completed_by when the status flips to done.
    if (patch.status === 'done' && current.status !== 'done') {
      args.push(req.user.id);
      sets.push(`completed_at = now()`, `completed_by = $${args.length}`);
    } else if (patch.status === 'open' && current.status === 'done') {
      sets.push(`completed_at = NULL`, `completed_by = NULL`);
    }

    if (sets.length === 1) {
      // Only updated_at — no-op patch.
      const out = await query(`${BASE_SELECT} WHERE t.id = $1`, [id]);
      return res.json({ task: shape(out.rows[0]) });
    }

    args.push(id);
    await query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${args.length}`,
      args
    );
    await logAudit({
      actor_id: req.user.id,
      event: patch.status === 'done' && current.status !== 'done'
        ? 'data.task.completed'
        : 'data.task.updated',
      target_type: 'task',
      target_id: id,
      payload: { parent_type: current.parent_type, parent_id: current.parent_id, ...patch },
      req,
    });
    const out = await query(`${BASE_SELECT} WHERE t.id = $1`, [id]);
    res.json({ task: shape(out.rows[0]) });
  })
);

router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    const current = (await query(
      'SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL',
      [id]
    )).rows[0];
    if (!current) throw httpError(404, 'Task not found.');

    await query(
      `UPDATE tasks SET deleted_at = now(), deleted_by = $1 WHERE id = $2`,
      [req.user.id, id]
    );
    await logAudit({
      actor_id: req.user.id,
      event: 'data.task.deleted',
      target_type: 'task',
      target_id: id,
      payload: { parent_type: current.parent_type, parent_id: current.parent_id },
      req,
    });
    res.json({ ok: true });
  })
);

module.exports = router;
