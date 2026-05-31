// ---------------------------------------------------------------------------
//  Trash — soft-deleted records, restorable by the super-admin.
//
//  GET    /api/trash                     summary + list grouped by type
//  POST   /api/trash/:type/:id/restore   restore this row + every sibling
//                                        that was deleted in the same group
//  DELETE /api/trash/:type/:id           permanent purge — hard DELETE; the
//                                        existing FK CASCADE removes the
//                                        rest of the sub-tree
//
//  super-admin only.
// ---------------------------------------------------------------------------
const express = require('express');
const { query, withTransaction } = require('../db');
const { wrap, httpError } = require('../helpers');
const { requireSuperAdmin } = require('../auth');
const { restoreGroup } = require('../softDelete');
const { renumberCommunications } = require('../renumberComms');
const { logAudit } = require('../audit');
const storage = require('../storage');

const TABLE = {
  authority: 'authorities',
  sub_division: 'sub_divisions',
  communication: 'communications',
  meeting: 'meetings',
  document: 'documents',
};

const router = express.Router();
router.use(requireSuperAdmin);

// --- GET /api/trash ---------------------------------------------------------
router.get(
  '/',
  wrap(async (_req, res) => {
    const trashed = {};

    trashed.authorities = (await query(
      `SELECT a.id, a.code, a.name, a.deleted_at, a.deleted_by, a.deletion_group_id,
              u.email AS deleted_by_email
       FROM authorities a
       LEFT JOIN users u ON u.id = a.deleted_by
       WHERE a.deleted_at IS NOT NULL
       ORDER BY a.deleted_at DESC, a.id DESC`
    )).rows;

    trashed.sub_divisions = (await query(
      `SELECT s.id, s.sub_reference, s.name, s.authority_id,
              a.code AS authority_code, a.name AS authority_name,
              s.deleted_at, s.deleted_by, s.deletion_group_id,
              u.email AS deleted_by_email
       FROM sub_divisions s
       JOIN authorities a ON a.id = s.authority_id
       LEFT JOIN users u ON u.id = s.deleted_by
       WHERE s.deleted_at IS NOT NULL
       ORDER BY s.deleted_at DESC, s.id DESC`
    )).rows;

    trashed.communications = (await query(
      `SELECT c.id, c.comm_code, c.direction, c.comm_date,
              c.sub_division_id, sd.sub_reference,
              c.deleted_at, c.deleted_by, c.deletion_group_id,
              u.email AS deleted_by_email
       FROM communications c
       JOIN sub_divisions sd ON sd.id = c.sub_division_id
       LEFT JOIN users u ON u.id = c.deleted_by
       WHERE c.deleted_at IS NOT NULL
       ORDER BY c.deleted_at DESC, c.id DESC`
    )).rows;

    trashed.meetings = (await query(
      `SELECT m.id, m.meeting_code, m.meeting_date, m.authority_id,
              a.code AS authority_code, a.name AS authority_name,
              m.deleted_at, m.deleted_by, m.deletion_group_id,
              u.email AS deleted_by_email
       FROM meetings m
       JOIN authorities a ON a.id = m.authority_id
       LEFT JOIN users u ON u.id = m.deleted_by
       WHERE m.deleted_at IS NOT NULL
       ORDER BY m.deleted_at DESC, m.id DESC`
    )).rows;

    trashed.documents = (await query(
      `SELECT d.id, d.original_name, d.parent_type, d.parent_id, d.size_bytes,
              d.deleted_at, d.deleted_by, d.deletion_group_id,
              u.email AS deleted_by_email
       FROM documents d
       LEFT JOIN users u ON u.id = d.deleted_by
       WHERE d.deleted_at IS NOT NULL
       ORDER BY d.deleted_at DESC, d.id DESC`
    )).rows;

    const total =
      trashed.authorities.length +
      trashed.sub_divisions.length +
      trashed.communications.length +
      trashed.meetings.length +
      trashed.documents.length;

    res.json({ total, ...trashed });
  })
);

// --- POST /api/trash/:type/:id/restore --------------------------------------
router.post(
  '/:type/:id/restore',
  wrap(async (req, res) => {
    const type = req.params.type;
    const id = Number(req.params.id);
    const table = TABLE[type];
    if (!table) throw httpError(400, 'Unknown record type.');
    if (!id) throw httpError(400, 'Invalid id.');

    let restored = 0;
    let snapshot = null;
    let group = null;
    await withTransaction(async (client) => {
      const r = await client.query(
        `SELECT id, deletion_group_id FROM ${table}
         WHERE id = $1 AND deleted_at IS NOT NULL`,
        [id]
      );
      if (!r.rows[0]) throw httpError(404, 'That record is not in Trash.');
      snapshot = r.rows[0];
      group = r.rows[0].deletion_group_id;

      // Does this restore bring any communications back? (Either restoring a
      // communication directly, or a group whose cascade included some.)
      let touchesComms = type === 'communication';
      if (group && !touchesComms) {
        const c = await client.query(
          'SELECT 1 FROM communications WHERE deletion_group_id = $1 LIMIT 1',
          [group]
        );
        if (c.rows[0]) touchesComms = true;
      }

      if (group) {
        restored = await restoreGroup(client, group);
      } else {
        // Standalone restore — older deletes may not carry a group id.
        await client.query(
          `UPDATE ${table}
           SET deleted_at = NULL, deleted_by = NULL, deletion_group_id = NULL
           WHERE id = $1`,
          [id]
        );
        restored = 1;
      }

      // Re-flow codes so the restored communication slots back into its date
      // position and the active list stays a clean chronological sequence.
      if (touchesComms) await renumberCommunications(client);
    });

    await logAudit({
      actor_id: req.user.id,
      event: 'data.' + type + '.restored',
      target_type: type,
      target_id: id,
      payload: { deletion_group_id: group, rows_restored: restored },
      req,
    });
    res.json({ ok: true, rows_restored: restored });
  })
);

// --- DELETE /api/trash/:type/:id  -- permanent purge ------------------------
// The original FK CASCADE handles children once we DELETE for real.
router.delete(
  '/:type/:id',
  wrap(async (req, res) => {
    const type = req.params.type;
    const id = Number(req.params.id);
    const table = TABLE[type];
    if (!table) throw httpError(400, 'Unknown record type.');
    if (!id) throw httpError(400, 'Invalid id.');

    // Gather any documents in this sub-tree so we can unlink their bytes
    // from object storage AFTER the DELETE succeeds. We collect them BEFORE
    // the DELETE because the FK cascade removes the rows. Each entry knows
    // which backend it lives on so disk-era files and S3-era files in the
    // same tree both get cleaned up correctly.
    const docs = [];
    const collect = async (parentType, parentId) => {
      const rows = (await query(
        `SELECT stored_name, storage_backend
         FROM documents WHERE parent_type = $1 AND parent_id = $2`,
        [parentType, parentId]
      )).rows;
      rows.forEach((d) => docs.push(d));
    };
    if (type === 'document') {
      const d = (await query(
        `SELECT stored_name, storage_backend
         FROM documents WHERE id = $1 AND deleted_at IS NOT NULL`,
        [id]
      )).rows[0];
      if (!d) throw httpError(404, 'That document is not in Trash.');
      docs.push(d);
    } else if (type === 'communication') {
      await collect('communication', id);
    } else if (type === 'meeting') {
      await collect('meeting', id);
    } else if (type === 'sub_division') {
      const comms = (await query(
        'SELECT id FROM communications WHERE sub_division_id = $1', [id]
      )).rows;
      for (const c of comms) await collect('communication', c.id);
    } else if (type === 'authority') {
      const subs = (await query(
        'SELECT id FROM sub_divisions WHERE authority_id = $1', [id]
      )).rows;
      for (const s of subs) {
        const comms = (await query(
          'SELECT id FROM communications WHERE sub_division_id = $1', [s.id]
        )).rows;
        for (const c of comms) await collect('communication', c.id);
      }
      const meets = (await query(
        'SELECT id FROM meetings WHERE authority_id = $1', [id]
      )).rows;
      for (const m of meets) await collect('meeting', m.id);
    }

    const r = await query(
      `DELETE FROM ${table} WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id`,
      [id]
    );
    if (!r.rows[0]) throw httpError(404, 'That record is not in Trash.');

    // documents.parent_id is a polymorphic reference (parent_type +
    // parent_id), so there is no FK CASCADE to remove the document rows
    // when the parent is purged. Issue an explicit DELETE for every
    // document we collected up-front, then unlink the bytes.
    for (const d of docs) {
      // Re-key on stored_name (unique-enough; matches what we collected).
      // For the type === 'document' case the parent DELETE above already
      // removed the row.
      if (type !== 'document') {
        await query('DELETE FROM documents WHERE stored_name = $1', [d.stored_name]);
      }
      await storage.remove({ storedName: d.stored_name, storageBackend: d.storage_backend });
    }

    await logAudit({
      actor_id: req.user.id,
      event: 'data.' + type + '.purged',
      target_type: type,
      target_id: id,
      payload: { files_unlinked: docs.length, storage_backend: storage.activeBackend() },
      req,
    });
    res.json({ ok: true });
  })
);

module.exports = router;
