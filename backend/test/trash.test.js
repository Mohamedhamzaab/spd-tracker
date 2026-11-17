// Restoring something whose parent is still in Trash is refused, unless the
// parent comes back in the same batch. LOCAL database only, rolled back.
const test = require('node:test');
const assert = require('node:assert');
const { pool } = require('../src/db');
const { trashedParent } = require('../src/softDelete');

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '@localhost/');
test.after(() => pool.end());

test('a letter under a trashed sub-division names that sub-division', { skip: !local && 'DATABASE_URL is not local' }, async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const sd = (await c.query(
      'SELECT id, sub_reference FROM sub_divisions WHERE deleted_at IS NULL LIMIT 1')).rows[0];
    const comm = (await c.query(
      `INSERT INTO communications (comm_code, sub_division_id, comm_date, direction, deleted_at, deletion_group_id)
       VALUES ('C-9980', $1, '2026-01-01', 'Outbound', now(), 'aaaaaaaa-0000-4000-8000-000000000001') RETURNING id`,
      [sd.id])).rows[0].id;
    const letterGroup = 'aaaaaaaa-0000-4000-8000-000000000001';

    assert.strictEqual(await trashedParent(c, 'communication', comm, letterGroup), null, 'parent live: restore is fine');

    await c.query(`UPDATE sub_divisions SET deleted_at = now(),
                     deletion_group_id = 'aaaaaaaa-0000-4000-8000-000000000002' WHERE id = $1`, [sd.id]);
    assert.strictEqual(await trashedParent(c, 'communication', comm, letterGroup), `sub-division ${sd.sub_reference}`);

    await c.query('UPDATE communications SET deletion_group_id = $1 WHERE id = $2',
      ['aaaaaaaa-0000-4000-8000-000000000002', comm]);
    assert.strictEqual(await trashedParent(c, 'communication', comm, 'aaaaaaaa-0000-4000-8000-000000000002'), null,
      'deleted in the same batch: both come back together');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
