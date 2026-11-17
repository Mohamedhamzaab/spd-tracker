// ---------------------------------------------------------------------------
//  Soft-delete cascade helpers. Used by every DELETE handler that needs to
//  remove a record plus everything underneath it.
//
//  All cascades stamp the same deletion_group_id on every affected row so
//  the Trash page can restore the whole batch atomically.
// ---------------------------------------------------------------------------
const crypto = require('crypto');

// Returns a UUID v4 string suitable for the deletion_group_id column.
function newGroupId() {
  return crypto.randomUUID();
}

// All of these run inside `withTransaction(async (client) => { ... })` so the
// caller controls the transaction boundary.

async function softDeleteDocuments(client, group, actorId, parentType, parentId) {
  await client.query(
    `UPDATE documents
     SET deleted_at = now(),
         deleted_by = $1,
         deletion_group_id = $2
     WHERE parent_type = $3
       AND parent_id = $4
       AND deleted_at IS NULL`,
    [actorId, group, parentType, parentId]
  );
}

async function softDeleteCommunication(client, group, actorId, commId) {
  await softDeleteDocuments(client, group, actorId, 'communication', commId);
  await client.query(
    `UPDATE communications SET deleted_at = now(), deleted_by = $1, deletion_group_id = $2
     WHERE id = $3 AND deleted_at IS NULL`,
    [actorId, group, commId]
  );
}

async function softDeleteMeeting(client, group, actorId, meetingId) {
  await softDeleteDocuments(client, group, actorId, 'meeting', meetingId);
  await client.query(
    `UPDATE meetings SET deleted_at = now(), deleted_by = $1, deletion_group_id = $2
     WHERE id = $3 AND deleted_at IS NULL`,
    [actorId, group, meetingId]
  );
}

async function softDeleteQdrs(client, group, actorId, qdrsId) {
  await softDeleteDocuments(client, group, actorId, 'qdrs', qdrsId);
  await client.query(
    `UPDATE qdrs_records SET deleted_at = now(), deleted_by = $1, deletion_group_id = $2
     WHERE id = $3 AND deleted_at IS NULL`,
    [actorId, group, qdrsId]
  );
}

async function softDeleteSubDivision(client, group, actorId, subId) {
  const live = (await client.query(
    'SELECT id FROM communications WHERE sub_division_id = $1 AND deleted_at IS NULL',
    [subId]
  )).rows;
  for (const r of live) {
    await softDeleteCommunication(client, group, actorId, r.id);
  }
  const qdrs = (await client.query(
    'SELECT id FROM qdrs_records WHERE sub_division_id = $1 AND deleted_at IS NULL',
    [subId]
  )).rows;
  for (const q of qdrs) {
    await softDeleteQdrs(client, group, actorId, q.id);
  }
  await client.query(
    `UPDATE sub_divisions SET deleted_at = now(), deleted_by = $1, deletion_group_id = $2
     WHERE id = $3 AND deleted_at IS NULL`,
    [actorId, group, subId]
  );
}

async function softDeleteAuthority(client, group, actorId, authId) {
  const subs = (await client.query(
    'SELECT id FROM sub_divisions WHERE authority_id = $1 AND deleted_at IS NULL',
    [authId]
  )).rows;
  for (const s of subs) {
    await softDeleteSubDivision(client, group, actorId, s.id);
  }
  const meetings = (await client.query(
    'SELECT id FROM meetings WHERE authority_id = $1 AND deleted_at IS NULL',
    [authId]
  )).rows;
  for (const m of meetings) {
    await softDeleteMeeting(client, group, actorId, m.id);
  }
  await client.query(
    `UPDATE authorities SET deleted_at = now(), deleted_by = $1, deletion_group_id = $2
     WHERE id = $3 AND deleted_at IS NULL`,
    [actorId, group, authId]
  );
}

// Restore everything in the deletion group atomically.
async function restoreGroup(client, groupId) {
  const tables = ['documents', 'communications', 'meetings', 'qdrs_records', 'sub_divisions', 'authorities'];
  let totalRestored = 0;
  for (const t of tables) {
    const { rowCount } = await client.query(
      `UPDATE ${t}
       SET deleted_at = NULL,
           deleted_by = NULL,
           deletion_group_id = NULL
       WHERE deletion_group_id = $1 AND deleted_at IS NOT NULL`,
      [groupId]
    );
    totalRestored += rowCount;
  }
  return totalRestored;
}

// The record each kind sits under, and how a parent is named and checked.
const PARENT_OF = {
  sub_division:      `SELECT 'authority' AS type, authority_id AS id FROM sub_divisions WHERE id = $1`,
  communication:     `SELECT 'sub_division' AS type, sub_division_id AS id FROM communications WHERE id = $1`,
  qdrs:              `SELECT 'sub_division' AS type, sub_division_id AS id FROM qdrs_records WHERE id = $1`,
  meeting:           `SELECT 'authority' AS type, authority_id AS id FROM meetings WHERE id = $1`,
  document:          `SELECT parent_type AS type, parent_id AS id FROM documents WHERE id = $1`,
  engagement_action: `SELECT 'sub_division' AS type, sub_division_id AS id FROM engagement_actions WHERE id = $1`,
};
const PARENT_STATE = {
  authority:     `SELECT 'authority ' || code AS label, deleted_at, deletion_group_id FROM authorities WHERE id = $1`,
  sub_division:  `SELECT 'sub-division ' || sub_reference AS label, deleted_at, deletion_group_id FROM sub_divisions WHERE id = $1`,
  communication: `SELECT 'communication ' || comm_code AS label, deleted_at, deletion_group_id FROM communications WHERE id = $1`,
  meeting:       `SELECT 'meeting ' || meeting_code AS label, deleted_at, deletion_group_id FROM meetings WHERE id = $1`,
  qdrs:          `SELECT 'QDRS record ' || qdrs_code AS label, deleted_at, deletion_group_id FROM qdrs_records WHERE id = $1`,
};

// A record restored under a parent that is still in Trash comes back hidden:
// every list leaves out what sits under a trashed record. Returns the nearest
// such parent ("sub-division KM-S02") or null. A parent deleted in the same
// batch (same group) comes back with it, so it doesn't count.
async function trashedParent(client, type, id, group) {
  for (;;) {
    const up = PARENT_OF[type] && (await client.query(PARENT_OF[type], [id])).rows[0];
    if (!up) return null;
    ({ type, id } = up);
    const p = (await client.query(PARENT_STATE[type], [id])).rows[0];
    if (p && p.deleted_at && (!group || p.deletion_group_id !== group)) return p.label;
  }
}

module.exports = {
  trashedParent,
  newGroupId,
  softDeleteAuthority,
  softDeleteSubDivision,
  softDeleteCommunication,
  softDeleteMeeting,
  softDeleteQdrs,
  softDeleteDocuments,
  restoreGroup,
};
