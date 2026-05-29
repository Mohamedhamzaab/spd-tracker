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

async function softDeleteSubDivision(client, group, actorId, subId) {
  const live = (await client.query(
    'SELECT id FROM communications WHERE sub_division_id = $1 AND deleted_at IS NULL',
    [subId]
  )).rows;
  for (const r of live) {
    await softDeleteCommunication(client, group, actorId, r.id);
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
  const tables = ['documents', 'communications', 'meetings', 'sub_divisions', 'authorities'];
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

module.exports = {
  newGroupId,
  softDeleteAuthority,
  softDeleteSubDivision,
  softDeleteCommunication,
  softDeleteMeeting,
  softDeleteDocuments,
  restoreGroup,
};
