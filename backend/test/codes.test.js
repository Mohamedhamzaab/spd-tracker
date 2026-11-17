// Record codes are given once and never move. Runs against the LOCAL database
// only, inside transactions that roll back:  npm test
const test = require('node:test');
const assert = require('node:assert');
const { pool } = require('../src/db');
const { nextCode } = require('../src/helpers');

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '@localhost/');
const opts = { skip: !local && 'DATABASE_URL is not local' };
test.after(() => pool.end());

async function inRollback(work) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); return await work(c); } finally { await c.query('ROLLBACK'); c.release(); }
}

test('an action keeps its code when an earlier one is deleted or a back-dated one is added', opts, () =>
  inRollback(async (c) => {
    const sid = (await c.query('SELECT sub_division_id FROM v_engagement_action LIMIT 1')).rows[0].sub_division_id;
    // Same numbering as POST /api/engagement/actions.
    const raise = async (date) => (await c.query(
      `INSERT INTO engagement_actions (sub_division_id, description, source_type, source_ref_external, recorded_date, action_no)
       VALUES ($1, 'test', 'external', 'TEST', $2,
               (SELECT COALESCE(max(action_no), 0) + 1 FROM engagement_actions WHERE sub_division_id = $1))
       RETURNING id`, [sid, date])).rows[0].id;
    const code = async (id) => (await c.query('SELECT action_code FROM v_engagement_action WHERE id = $1', [id])).rows[0]?.action_code;

    const first = await raise('2026-01-01');
    const second = await raise('2026-02-01');
    const before = await code(second);
    await c.query('UPDATE engagement_actions SET deleted_at = now() WHERE id = $1', [first]);
    const backdated = await raise('2020-01-01');
    assert.strictEqual(await code(second), before);
    assert.ok(Number((await code(backdated)).split('.').pop()) > Number(before.split('.').pop()));
  }));

// Joined directly, the numbering view (window functions) re-ran for every row
// and took the action list past 20 s on production. The local data gets a fast
// plan either way, so timing can't catch it here: check the rule itself.
test('views read the numbering view once, through MATERIALIZED', () => {
  const sql = require('fs').readFileSync(require('path').join(__dirname, '../src/schema.sql'), 'utf8')
    .replace(/--.*$/gm, '');
  const uses = sql.match(/\b(FROM|JOIN)\s+v_engagement_numbering\b/g) || [];
  const materialized = sql.match(/AS MATERIALIZED \(SELECT \* FROM v_engagement_numbering\)/g) || [];
  assert.ok(uses.length > 0);
  assert.strictEqual(uses.length, materialized.length, 'a view joins v_engagement_numbering without MATERIALIZED');
});

test('every live action is in the register with its own code', opts, async () => {
  const { rows } = await pool.query('SELECT action_code FROM v_engagement_action');
  const live = (await pool.query(
    `SELECT count(*)::int AS n FROM engagement_actions ea
       JOIN sub_divisions sd ON sd.id = ea.sub_division_id AND sd.deleted_at IS NULL
       JOIN authorities a ON a.id = sd.authority_id AND a.deleted_at IS NULL
      WHERE ea.deleted_at IS NULL`)).rows[0].n;
  assert.strictEqual(rows.length, live, 'no live action is dropped from the register');
  assert.ok(rows.every((r) => r.action_code), 'every action has a code');
  assert.strictEqual(new Set(rows.map((r) => r.action_code)).size, rows.length, 'no two actions share a code');
});

test('a new letter never takes a trashed letter\'s code, and two saves take turns', opts, async () => {
  const held = await pool.connect();
  const other = await pool.connect();
  try {
    await held.query('BEGIN');
    const sid = (await held.query('SELECT id FROM sub_divisions LIMIT 1')).rows[0].id;
    await held.query(
      `INSERT INTO communications (comm_code, sub_division_id, comm_date, direction, deleted_at)
       VALUES ('C-9990', $1, '2026-01-01', 'Outbound', now())`, [sid]);
    assert.strictEqual(await nextCode(held, 'communications', 'comm_code', 'C', 4), 'C-9991');

    await other.query('BEGIN');
    let done = false;
    const waiting = nextCode(other, 'communications', 'comm_code', 'C', 4).then((v) => { done = true; return v; });
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(done, false, 'the second save waits for the first');
    await held.query('ROLLBACK');
    assert.notStrictEqual(await waiting, undefined);
  } finally {
    await held.query('ROLLBACK').catch(() => {});
    await other.query('ROLLBACK');
    held.release(); other.release();
  }
});
