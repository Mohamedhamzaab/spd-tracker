// ---------------------------------------------------------------------------
//  Stakeholder Engagement — the matrix, the assessment and the action register
//  that replaced the hand-maintained workbook.
//
//  GET    /api/engagement/summary            counts for the header strip
//  GET    /api/engagement/matrix             ratings per stakeholder + quadrant
//  PATCH  /api/engagement/matrix/:subId      set a stakeholder's ratings
//  GET    /api/engagement/actions            the register, filtered
//  GET    /api/engagement/actions/:id        one action + its timeline
//  POST   /api/engagement/actions            raise an action
//  PUT    /api/engagement/actions/:id        edit one
//  DELETE /api/engagement/actions/:id        soft-delete one
//  POST   /api/engagement/actions/:id/progress   add a timeline entry
//  DELETE /api/engagement/progress/:id       remove a timeline entry
//  POST   /api/engagement/actions/:id/resolve    cancel or supersede
//  GET    /api/engagement/sources            registered records for the picker
//  GET    /api/engagement/orgs               the Action By vocabulary
//
//  Reads are open to every signed-in role; every write requires an admin.
//  The evidence rules are enforced by CHECK constraints in the database — the
//  handlers below translate a violation into a message worth reading.
// ---------------------------------------------------------------------------
const express = require('express');
const { query, withTransaction } = require('../db');
const { wrap, httpError } = require('../helpers');
const { requireEditor } = require('../auth');
const { logAudit } = require('../audit');
const { newGroupId } = require('../softDelete');

const router = express.Router();

const LADDER = ['Unaware', 'Resistant', 'Neutral', 'Supportive', 'Leading'];
const HL = ['H', 'L'];
const PRIORITY = ['A', 'B', 'C', 'D'];
const SOURCE_TYPES = ['meeting', 'communication', 'qdrs', 'external'];
const MILESTONES = [
  'Upon Approval of MP', 'Upon Approval of CD', 'Upon Approval of SD',
  'Upon Submission of MP', 'During Concept Design Stage', 'SD Stage',
];

// A source is either a registered record or an external reference — never
// a bare claim. Mirrors engagement_actions_source_check.
function readSource(b, { required = true } = {}) {
  const type = b.source_type || null;
  if (!type) {
    if (required) throw httpError(400, 'Choose where this came from.');
    return { type: null, id: null, ref: null };
  }
  if (!SOURCE_TYPES.includes(type)) throw httpError(400, 'Unknown source type.');
  if (type === 'external') {
    const ref = (b.source_ref_external || '').trim();
    if (!ref) {
      throw httpError(400, 'An external source needs a reference — a letter or document number.');
    }
    return { type, id: null, ref };
  }
  const id = Number(b.source_id);
  if (!id) throw httpError(400, 'Pick the meeting, communication or QDRS record this came from.');
  return { type, id, ref: null };
}

// Confirm the chosen record actually exists, so the register can never point
// at something that was never logged.
async function assertSourceExists(client, type, id) {
  if (!type || type === 'external') return;
  const table = { meeting: 'meetings', communication: 'communications', qdrs: 'qdrs_records' }[type];
  const { rows } = await client.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id]
  );
  if (!rows[0]) throw httpError(400, 'That record no longer exists in the register.');
}

async function loadAction(id) {
  const { rows } = await query('SELECT * FROM v_engagement_action WHERE id = $1', [id]);
  if (!rows[0]) throw httpError(404, 'Action not found.');
  return rows[0];
}

// Attach the org tags every list needs, in one round trip.
async function orgsByAction(ids) {
  if (!ids.length) return {};
  const { rows } = await query(
    `SELECT ao.action_id, o.id, o.name
       FROM engagement_action_orgs ao
       JOIN engagement_orgs o ON o.id = ao.org_id
      WHERE ao.action_id = ANY($1::int[])
      ORDER BY o.name`,
    [ids]
  );
  const map = {};
  for (const r of rows) (map[r.action_id] ||= []).push({ id: r.id, name: r.name });
  return map;
}

// --- summary strip ----------------------------------------------------------
router.get(
  '/summary',
  wrap(async (_req, res) => {
    const a = await query(
      `SELECT
         count(*)                                            AS total,
         count(*) FILTER (WHERE status = 'Pending')          AS pending,
         count(*) FILTER (WHERE status = 'Open/Ongoing')     AS ongoing,
         count(*) FILTER (WHERE status = 'Closed')           AS closed,
         count(*) FILTER (WHERE status = 'Cancelled')        AS cancelled,
         count(*) FILTER (WHERE status = 'Superseded')       AS superseded,
         count(*) FILTER (WHERE is_overdue)                  AS overdue,
         count(*) FILTER (WHERE has_external_evidence
                            AND status <> 'Closed')          AS unreferenced,
         count(*) FILTER (WHERE is_critical
                            AND status IN ('Pending','Open/Ongoing')) AS critical_open
       FROM v_engagement_action`
    );
    const m = await query(
      `SELECT
         count(*) FILTER (WHERE is_critical)                       AS critical,
         count(*) FILTER (WHERE gap_status LIKE 'Gap:%')           AS with_gap,
         count(*) FILTER (WHERE gap_status = '✓ Aligned')          AS aligned,
         count(*) FILTER (WHERE influence IS NULL
                             OR involvement IS NULL)               AS unrated
       FROM v_engagement_matrix`
    );
    res.json({ actions: a.rows[0], matrix: m.rows[0] });
  })
);

// --- the matrix -------------------------------------------------------------
router.get(
  '/matrix',
  wrap(async (_req, res) => {
    const { rows } = await query(
      `SELECT * FROM v_engagement_matrix ORDER BY authority_name, seq_no`
    );
    const quadrant = await query(
      `SELECT action_priority, count(*)::int AS n
         FROM v_engagement_matrix
        WHERE action_priority IS NOT NULL
        GROUP BY action_priority`
    );
    res.json({
      rows,
      quadrant: Object.fromEntries(quadrant.rows.map((r) => [r.action_priority, r.n])),
      lists: { ladder: LADDER, hl: HL, priority: PRIORITY },
    });
  })
);

router.patch(
  '/matrix/:subId',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.subId);
    const b = req.body || {};
    const check = (v, allowed, label) => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      if (!allowed.includes(v)) throw httpError(400, `${label} must be one of: ${allowed.join(', ')}.`);
      return v;
    };
    const patch = {
      influence: check(b.influence, HL, 'Influence'),
      involvement: check(b.involvement, HL, 'Involvement'),
      engagement_current: check(b.engagement_current, LADDER, 'Current engagement'),
      engagement_desired: check(b.engagement_desired, LADDER, 'Desired engagement'),
      communication_priority: check(b.communication_priority, PRIORITY, 'Communication priority'),
      gap_remarks: b.gap_remarks === undefined ? undefined : (b.gap_remarks || null),
      gap_action_by: b.gap_action_by === undefined ? undefined : (b.gap_action_by || null),
    };
    const sets = [];
    const args = [id];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      args.push(v);
      sets.push(`${k} = $${args.length}`);
    }
    if (!sets.length) throw httpError(400, 'Nothing to update.');
    const { rowCount } = await query(
      `UPDATE sub_divisions SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      args
    );
    if (!rowCount) throw httpError(404, 'Sub-division not found.');
    const { rows } = await query('SELECT * FROM v_engagement_matrix WHERE sub_division_id = $1', [id]);
    await logAudit({
      actor_id: req.user.id,
      event: 'data.engagement.rating_updated',
      target_type: 'sub_division',
      target_id: id,
      payload: { sub_reference: rows[0]?.sub_reference, fields: Object.keys(patch).filter((k) => patch[k] !== undefined) },
      req,
    });
    res.json(rows[0]);
  })
);

// --- the register -----------------------------------------------------------
router.get(
  '/actions',
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', '$' + params.length)); };

    if (req.query.status) {
      const set = String(req.query.status).split(',').map((s) => s.trim()).filter(Boolean);
      if (set.length) add('status = ANY(?::text[])', set);
    }
    if (req.query.sub_division_id) add('sub_division_id = ?', Number(req.query.sub_division_id));
    if (req.query.authority_id)    add('authority_id = ?', Number(req.query.authority_id));
    if (req.query.milestone)       add('due_milestone = ?', req.query.milestone);
    if (req.query.overdue === 'true')      where.push('is_overdue');
    if (req.query.critical === 'true')     where.push('is_critical');
    if (req.query.unreferenced === 'true') where.push('has_external_evidence');
    if (req.query.org_id) {
      add(`id IN (SELECT action_id FROM engagement_action_orgs WHERE org_id = ?)`,
        Number(req.query.org_id));
    }
    if (req.query.q) {
      // One parameter, referenced by all three comparisons.
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      const p = '$' + params.length;
      where.push(
        `(lower(description) LIKE ${p}
          OR lower(coalesce(source_ref_external, '')) LIKE ${p}
          OR lower(sub_division_name) LIKE ${p}
          OR lower(authority_name) LIKE ${p})`
      );
    }

    const sql =
      'SELECT * FROM v_engagement_action' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY authority_no, sub_reference, action_no';
    const { rows } = await query(sql, params);
    const orgs = await orgsByAction(rows.map((r) => r.id));
    res.json(rows.map((r) => ({ ...r, orgs: orgs[r.id] || [] })));
  })
);

router.get(
  '/actions/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const action = await loadAction(id);
    const timeline = await query(
      `SELECT p.*, u.name AS created_by_name,
              m.meeting_code, m.mom_reference,
              c.comm_code, c.submission_reference,
              q.qdrs_code, q.reference AS qdrs_reference
         FROM engagement_action_progress p
         LEFT JOIN users u ON u.id = p.created_by
         LEFT JOIN meetings       m ON p.source_type = 'meeting'       AND m.id = p.source_id
         LEFT JOIN communications c ON p.source_type = 'communication' AND c.id = p.source_id
         LEFT JOIN qdrs_records   q ON p.source_type = 'qdrs'          AND q.id = p.source_id
        WHERE p.action_id = $1 AND p.deleted_at IS NULL
        ORDER BY p.entry_date DESC, p.id DESC`,
      [id]
    );
    const orgs = await orgsByAction([id]);
    const links = await query(
      `SELECT sd.id, sd.sub_reference, sd.name
         FROM engagement_action_links l
         JOIN sub_divisions sd ON sd.id = l.sub_division_id AND sd.deleted_at IS NULL
        WHERE l.action_id = $1 ORDER BY sd.sub_reference`,
      [id]
    );
    res.json({
      ...action,
      orgs: orgs[id] || [],
      related: links.rows,
      timeline: timeline.rows,
    });
  })
);

// Replace an action's org tags and related stakeholders inside one transaction.
async function setTags(client, actionId, orgIds, relatedIds) {
  if (Array.isArray(orgIds)) {
    await client.query('DELETE FROM engagement_action_orgs WHERE action_id = $1', [actionId]);
    for (const oid of [...new Set(orgIds.map(Number).filter(Boolean))]) {
      await client.query(
        `INSERT INTO engagement_action_orgs (action_id, org_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [actionId, oid]
      );
    }
  }
  if (Array.isArray(relatedIds)) {
    await client.query('DELETE FROM engagement_action_links WHERE action_id = $1', [actionId]);
    for (const sid of [...new Set(relatedIds.map(Number).filter(Boolean))]) {
      await client.query(
        `INSERT INTO engagement_action_links (action_id, sub_division_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [actionId, sid]
      );
    }
  }
}

router.post(
  '/actions',
  requireEditor,
  wrap(async (req, res) => {
    const b = req.body || {};
    const subId = Number(b.sub_division_id);
    const description = (b.description || '').trim();
    if (!subId) throw httpError(400, 'Choose the stakeholder this action belongs to.');
    if (!description) throw httpError(400, 'Describe the action.');
    if (!b.recorded_date) throw httpError(400, 'A date is required.');
    if (b.due_milestone && !MILESTONES.includes(b.due_milestone)) {
      throw httpError(400, 'Unknown milestone.');
    }
    const src = readSource(b);

    const created = await withTransaction(async (client) => {
      const sub = await client.query(
        'SELECT id FROM sub_divisions WHERE id = $1 AND deleted_at IS NULL', [subId]
      );
      if (!sub.rows[0]) throw httpError(404, 'Stakeholder not found.');
      await assertSourceExists(client, src.type, src.id);
      const { rows } = await client.query(
        `INSERT INTO engagement_actions
           (sub_division_id, description, source_type, source_id, source_ref_external,
            recorded_date, notes, due_milestone, due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [subId, description, src.type, src.id, src.ref, b.recorded_date,
         b.notes || null, b.due_milestone || null, b.due_date || null, req.user.id]
      );
      const id = rows[0].id;
      await setTags(client, id, b.org_ids, b.related_sub_division_ids);
      return id;
    });

    const action = await loadAction(created);
    await logAudit({
      actor_id: req.user.id,
      event: 'data.engagement.action_created',
      target_type: 'engagement_action',
      target_id: created,
      payload: { action_code: action.action_code, sub_reference: action.sub_reference },
      req,
    });
    res.status(201).json(action);
  })
);

router.put(
  '/actions/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    await loadAction(id);
    if (b.due_milestone && !MILESTONES.includes(b.due_milestone)) {
      throw httpError(400, 'Unknown milestone.');
    }
    const src = b.source_type ? readSource(b) : null;

    await withTransaction(async (client) => {
      if (src) await assertSourceExists(client, src.type, src.id);
      await client.query(
        `UPDATE engagement_actions SET
           description   = COALESCE($2, description),
           recorded_date = COALESCE($3, recorded_date),
           notes         = $4,
           due_milestone = $5,
           due_date      = $6,
           source_type         = COALESCE($7, source_type),
           source_id           = CASE WHEN $7::text IS NULL THEN source_id ELSE $8 END,
           source_ref_external = CASE WHEN $7::text IS NULL THEN source_ref_external ELSE $9 END,
           updated_at    = now()
         WHERE id = $1`,
        [id, b.description ? b.description.trim() : null, b.recorded_date || null,
         b.notes || null, b.due_milestone || null, b.due_date || null,
         src ? src.type : null, src ? src.id : null, src ? src.ref : null]
      );
      await setTags(client, id, b.org_ids, b.related_sub_division_ids);
    });

    const action = await loadAction(id);
    await logAudit({
      actor_id: req.user.id,
      event: 'data.engagement.action_updated',
      target_type: 'engagement_action',
      target_id: id,
      payload: { action_code: action.action_code },
      req,
    });
    res.json(action);
  })
);

router.delete(
  '/actions/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const action = await loadAction(id);
    const group = newGroupId();
    await query(
      `UPDATE engagement_actions
          SET deleted_at = now(), deleted_by = $2, deletion_group_id = $3
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, req.user.id, group]
    );
    await logAudit({
      actor_id: req.user.id,
      event: 'data.engagement.action_deleted',
      target_type: 'engagement_action',
      target_id: id,
      payload: { action_code: action.action_code, deletion_group_id: group },
      req,
    });
    res.json({ ok: true });
  })
);

// --- the timeline -----------------------------------------------------------
router.post(
  '/actions/:id/progress',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const kind = b.kind === 'closure' ? 'closure' : 'progress';
    const note = (b.note || '').trim();
    if (!note) throw httpError(400, kind === 'closure' ? 'Say how it was closed.' : 'Say what was done.');
    if (!b.entry_date) throw httpError(400, 'A date is required.');

    const action = await loadAction(id);
    if (action.resolution) {
      throw httpError(400, `This action is ${action.status.toLowerCase()} and no longer takes entries.`);
    }
    // Closure has to cite something; progress may stand as a plain note.
    const src = readSource(b, { required: kind === 'closure' });

    await withTransaction(async (client) => {
      await assertSourceExists(client, src.type, src.id);
      await client.query(
        `INSERT INTO engagement_action_progress
           (action_id, kind, entry_date, note, source_type, source_id,
            source_ref_external, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, kind, b.entry_date, note, src.type, src.id, src.ref, req.user.id]
      );
    });

    const fresh = await loadAction(id);
    await logAudit({
      actor_id: req.user.id,
      event: kind === 'closure'
        ? 'data.engagement.action_closed'
        : 'data.engagement.progress_added',
      target_type: 'engagement_action',
      target_id: id,
      payload: { action_code: fresh.action_code, status: fresh.status },
      req,
    });
    res.status(201).json(fresh);
  })
);

router.delete(
  '/progress/:id',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    // Soft, so a mis-click can be undone. /progress/:id/restore brings it back.
    const { rows } = await query(
      `UPDATE engagement_action_progress
          SET deleted_at = now(), deleted_by = $2
        WHERE id = $1 AND deleted_at IS NULL
      RETURNING action_id, kind`,
      [id, req.user.id]
    );
    if (!rows[0]) throw httpError(404, 'Entry not found.');
    await logAudit({
      actor_id: req.user.id,
      event: 'data.engagement.progress_removed',
      target_type: 'engagement_action',
      target_id: rows[0].action_id,
      payload: { kind: rows[0].kind },
      req,
    });
    res.json({ ok: true, action: await loadAction(rows[0].action_id) });
  })
);

// Put a removed timeline entry back.
router.post(
  '/progress/:id/restore',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query(
      `UPDATE engagement_action_progress
          SET deleted_at = NULL, deleted_by = NULL
        WHERE id = $1 AND deleted_at IS NOT NULL
      RETURNING action_id`,
      [id]
    );
    if (!rows[0]) throw httpError(404, 'That entry is not in the removed list.');
    await logAudit({
      actor_id: req.user.id,
      event: 'data.engagement.progress_restored',
      target_type: 'engagement_action',
      target_id: rows[0].action_id,
      req,
    });
    res.json({ ok: true, action: await loadAction(rows[0].action_id) });
  })
);

// Put a removed action back into the register.
router.post(
  '/actions/:id/restore',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query(
      `UPDATE engagement_actions
          SET deleted_at = NULL, deleted_by = NULL, deletion_group_id = NULL,
              updated_at = now()
        WHERE id = $1 AND deleted_at IS NOT NULL
      RETURNING id`,
      [id]
    );
    if (!rows[0]) throw httpError(404, 'That action is not in the removed list.');
    const action = await loadAction(id);
    await logAudit({
      actor_id: req.user.id,
      event: 'data.engagement.action_restored',
      target_type: 'engagement_action',
      target_id: id,
      payload: { action_code: action.action_code },
      req,
    });
    res.json(action);
  })
);

// Everything removed, so it can be found and put back. Reads the base table,
// since the view deliberately hides deleted rows.
router.get(
  '/removed',
  wrap(async (_req, res) => {
    const actions = await query(
      `SELECT a.id, a.description, a.recorded_date, a.deleted_at,
              sd.sub_reference, sd.name AS sub_division_name,
              au.code AS authority_code, au.name AS authority_name,
              u.name AS deleted_by_name
         FROM engagement_actions a
         JOIN sub_divisions sd ON sd.id = a.sub_division_id
         JOIN authorities au ON au.id = sd.authority_id
         LEFT JOIN users u ON u.id = a.deleted_by
        WHERE a.deleted_at IS NOT NULL
        ORDER BY a.deleted_at DESC`
    );
    const entries = await query(
      `SELECT p.id, p.action_id, p.kind, p.entry_date, p.note, p.deleted_at,
              u.name AS deleted_by_name, a.description AS action_description
         FROM engagement_action_progress p
         JOIN engagement_actions a ON a.id = p.action_id
         LEFT JOIN users u ON u.id = p.deleted_by
        WHERE p.deleted_at IS NOT NULL
        ORDER BY p.deleted_at DESC`
    );
    res.json({ actions: actions.rows, entries: entries.rows });
  })
);

// --- cancel / supersede / reopen -------------------------------------------
router.post(
  '/actions/:id/resolve',
  requireEditor,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    await loadAction(id);

    if (b.resolution === null || b.resolution === '') {
      await query(
        `UPDATE engagement_actions
            SET resolution = NULL, cancel_reason = NULL, superseded_by_id = NULL,
                superseded_ref_external = NULL, updated_at = now()
          WHERE id = $1`, [id]
      );
      const fresh = await loadAction(id);
      await logAudit({
        actor_id: req.user.id, event: 'data.engagement.action_reopened',
        target_type: 'engagement_action', target_id: id,
        payload: { action_code: fresh.action_code }, req,
      });
      return res.json(fresh);
    }

    if (b.resolution === 'cancelled') {
      const reason = (b.cancel_reason || '').trim();
      if (!reason) throw httpError(400, 'Cancelling needs a reason.');
      await query(
        `UPDATE engagement_actions
            SET resolution = 'cancelled', cancel_reason = $2,
                superseded_by_id = NULL, superseded_ref_external = NULL, updated_at = now()
          WHERE id = $1`, [id, reason]
      );
    } else if (b.resolution === 'superseded') {
      const byId = b.superseded_by_id ? Number(b.superseded_by_id) : null;
      const ref = (b.superseded_ref_external || '').trim();
      if (!byId && !ref) {
        throw httpError(400, 'Name the action that replaces this one, or give its reference.');
      }
      if (byId) {
        if (byId === id) throw httpError(400, 'An action cannot supersede itself.');
        const found = await query(
          'SELECT 1 FROM engagement_actions WHERE id = $1 AND deleted_at IS NULL', [byId]
        );
        if (!found.rows[0]) throw httpError(400, 'That replacement action does not exist.');
      }
      await query(
        `UPDATE engagement_actions
            SET resolution = 'superseded', superseded_by_id = $2,
                superseded_ref_external = $3, cancel_reason = NULL, updated_at = now()
          WHERE id = $1`, [id, byId, ref || null]
      );
    } else {
      throw httpError(400, 'Resolution must be cancelled, superseded, or cleared.');
    }

    const fresh = await loadAction(id);
    await logAudit({
      actor_id: req.user.id,
      event: `data.engagement.action_${b.resolution}`,
      target_type: 'engagement_action',
      target_id: id,
      payload: { action_code: fresh.action_code },
      req,
    });
    res.json(fresh);
  })
);

// --- pickers ----------------------------------------------------------------
// Registered records only: the register never accepts a typed-in source.
router.get(
  '/sources',
  wrap(async (req, res) => {
    const type = req.query.type;
    const q = `%${String(req.query.q || '').toLowerCase()}%`;
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const out = [];
    if (!type || type === 'meeting') {
      const { rows } = await query(
        `SELECT m.id, m.meeting_code AS code,
                to_char(m.meeting_date,'YYYY-MM-DD') AS on_date,
                coalesce(m.mom_reference, m.purpose, '') AS detail,
                a.code AS authority_code
           FROM meetings m JOIN authorities a ON a.id = m.authority_id
          WHERE m.deleted_at IS NULL
            AND (lower(m.meeting_code) LIKE $1 OR lower(coalesce(m.mom_reference,'')) LIKE $1
                 OR lower(coalesce(m.purpose,'')) LIKE $1 OR lower(a.name) LIKE $1)
          ORDER BY m.meeting_date DESC LIMIT $2`, [q, limit]
      );
      out.push(...rows.map((r) => ({ ...r, type: 'meeting' })));
    }
    if (!type || type === 'communication') {
      const { rows } = await query(
        `SELECT c.id, c.comm_code AS code,
                to_char(c.comm_date,'YYYY-MM-DD') AS on_date,
                coalesce(c.submission_reference, c.purpose, '') AS detail,
                a.code AS authority_code
           FROM communications c
           JOIN sub_divisions sd ON sd.id = c.sub_division_id
           JOIN authorities a ON a.id = sd.authority_id
          WHERE c.deleted_at IS NULL
            AND (lower(c.comm_code) LIKE $1 OR lower(coalesce(c.submission_reference,'')) LIKE $1
                 OR lower(coalesce(c.summary,'')) LIKE $1 OR lower(a.name) LIKE $1)
          ORDER BY c.comm_date DESC LIMIT $2`, [q, limit]
      );
      out.push(...rows.map((r) => ({ ...r, type: 'communication' })));
    }
    if (!type || type === 'qdrs') {
      const { rows } = await query(
        `SELECT q.id, q.qdrs_code AS code,
                to_char(q.qdrs_date,'YYYY-MM-DD') AS on_date,
                coalesce(q.reference, q.category, '') AS detail,
                a.code AS authority_code
           FROM qdrs_records q
           JOIN sub_divisions sd ON sd.id = q.sub_division_id
           JOIN authorities a ON a.id = sd.authority_id
          WHERE q.deleted_at IS NULL
            AND (lower(q.qdrs_code) LIKE $1 OR lower(coalesce(q.reference,'')) LIKE $1
                 OR lower(a.name) LIKE $1)
          ORDER BY q.qdrs_date DESC LIMIT $2`, [q, limit]
      );
      out.push(...rows.map((r) => ({ ...r, type: 'qdrs' })));
    }
    res.json(out);
  })
);

router.get(
  '/orgs',
  wrap(async (_req, res) => {
    const { rows } = await query(
      `SELECT id, name, is_internal FROM engagement_orgs
        WHERE is_active ORDER BY is_internal DESC, name`
    );
    res.json({ orgs: rows, milestones: MILESTONES });
  })
);

module.exports = router;
