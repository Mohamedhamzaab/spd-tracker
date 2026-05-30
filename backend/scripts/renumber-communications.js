// ---------------------------------------------------------------------------
//  One-time maintenance: re-assign every communication code (C-0001, C-0002…)
//  so the numbering follows the ACTIVITY DATE — the earliest comm_date becomes
//  C-0001, the next C-0002, and so on. Ties are broken by the existing row id
//  so the result is deterministic.
//
//  Why this is safe:
//    - Reply links (in_response_to) are stored by row id, NOT by code, so the
//      "C-13 is a reply to C-2" relationships are preserved — they just show
//      the new codes afterwards.
//    - Attached documents reference their parent by row id, so attachments are
//      untouched.
//    - The whole thing runs in a single transaction. If anything fails, nothing
//      changes.
//    - A two-pass update (temporary codes first) avoids tripping the UNIQUE
//      constraint while codes are being swapped around.
//
//  After this runs, new communications keep getting the next free number
//  (highest + 1), which stays in date order as long as you log things as they
//  happen.
//
//  Usage:
//    npm run renumber-comms            # DRY RUN — prints the plan, changes nothing
//    npm run renumber-comms -- --apply # actually renumber (or RENUMBER_APPLY=1)
//
//  ALWAYS take a backup first:  npm run backup
// ---------------------------------------------------------------------------
require('dotenv').config();
const { pool, query, withTransaction } = require('../src/db');

const APPLY =
  process.argv.includes('--apply') ||
  ['1', 'yes', 'true'].includes(String(process.env.RENUMBER_APPLY || '').toLowerCase());

function code(n) {
  return 'C-' + String(n).padStart(4, '0');
}

async function main() {
  // Read EVERY row (including soft-deleted) so codes stay globally unique.
  // Active rows are numbered first, strictly by activity date — so the list a
  // user actually sees reads C-0001, C-0002, … with no gaps. Trashed rows are
  // numbered after the active ones (still in date order among themselves).
  const ORDER = '(deleted_at IS NOT NULL), comm_date ASC, id ASC';
  const { rows } = await query(
    `SELECT id, comm_code, to_char(comm_date, 'YYYY-MM-DD') AS date_str, deleted_at
       FROM communications
      ORDER BY ${ORDER}`
  );

  if (rows.length === 0) {
    console.log('[renumber] No communications found — nothing to do.');
    await pool.end();
    return;
  }

  // Build the old -> new plan and show only the rows that actually move.
  const plan = rows.map((r, i) => ({
    id: r.id,
    oldCode: r.comm_code,
    newCode: code(i + 1),
    date: r.date_str || '(no date)',
    deleted: !!r.deleted_at,
  }));
  const moving = plan.filter((p) => p.oldCode !== p.newCode);

  console.log(`[renumber] ${rows.length} communication(s) total.`);
  console.log(`[renumber] ${moving.length} will change code; ${rows.length - moving.length} already correct.\n`);
  console.log('  DATE        OLD       ->  NEW' + (moving.some((p) => p.deleted) ? '      (D = in Trash)' : ''));
  console.log('  ----------  --------      --------');
  plan.forEach((p) => {
    const mark = p.oldCode === p.newCode ? '   ' : '-> ';
    const del = p.deleted ? '  (D)' : '';
    console.log(`  ${p.date}  ${p.oldCode.padEnd(8)}  ${mark}${p.newCode}${del}`);
  });

  if (!APPLY) {
    console.log('\n[renumber] DRY RUN — nothing was changed.');
    console.log('[renumber] Re-run with  --apply  (after  npm run backup ) to commit:');
    console.log('[renumber]     npm run renumber-comms -- --apply');
    await pool.end();
    return;
  }

  if (moving.length === 0) {
    console.log('\n[renumber] Codes are already in date order — nothing to apply.');
    await pool.end();
    return;
  }

  await withTransaction(async (client) => {
    // Pass 1 — park every row on a temporary, collision-proof code.
    await client.query(`UPDATE communications SET comm_code = 'TMP-' || id`);

    // Pass 2 — assign the final, date-ordered codes in one statement.
    await client.query(
      `WITH ordered AS (
         SELECT id,
                'C-' || lpad(
                  (row_number() OVER (ORDER BY ${ORDER}))::text, 4, '0'
                ) AS new_code
           FROM communications
       )
       UPDATE communications c
          SET comm_code = o.new_code
         FROM ordered o
        WHERE c.id = o.id`
    );

    // Record what happened in the audit trail (system action — no actor).
    await client.query(
      `INSERT INTO audit_events (actor_id, event_type, target_type, payload)
       VALUES (NULL, 'data.communication.renumbered', 'communication', $1::jsonb)`,
      [JSON.stringify({
        total: rows.length,
        changed: moving.length,
        mapping: moving.map((p) => ({ id: p.id, from: p.oldCode, to: p.newCode })),
      })]
    );
  });

  console.log(`\n[renumber] Done — ${moving.length} code(s) updated in date order.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('[renumber] fatal:', err.message || err);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
