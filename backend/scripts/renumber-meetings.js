// ---------------------------------------------------------------------------
//  One-time maintenance: re-number meeting codes (M-001, M-002…) so they
//  follow the meeting date — the earliest active meeting becomes M-001, the
//  next M-002, and so on, with no gaps. Soft-deleted meetings are pushed to
//  the end. Mirrors renumber-communications.js.
//
//  After this runs, deletes/restores keep the codes chronological
//  automatically; this just fixes any gap that predates that behaviour.
//
//  Usage:
//    npm run renumber-meetings             # DRY RUN — prints the plan
//    npm run renumber-meetings -- --apply  # actually renumber (or RENUMBER_APPLY=1)
//
//  Take a backup first if you like:  npm run backup
// ---------------------------------------------------------------------------
require('dotenv').config();
const { pool, query, withTransaction } = require('../src/db');
const { renumberMeetings } = require('../src/renumberComms');

const APPLY =
  process.argv.includes('--apply') ||
  ['1', 'yes', 'true'].includes(String(process.env.RENUMBER_APPLY || '').toLowerCase());

function code(n) {
  return 'M-' + String(n).padStart(3, '0');
}

async function main() {
  const { rows } = await query(
    `SELECT id, meeting_code, to_char(meeting_date, 'YYYY-MM-DD') AS date_str, deleted_at
       FROM meetings
      ORDER BY (deleted_at IS NOT NULL), meeting_date ASC, id ASC`
  );

  if (rows.length === 0) {
    console.log('[renumber-meetings] No meetings found — nothing to do.');
    await pool.end();
    return;
  }

  const plan = rows.map((r, i) => ({
    oldCode: r.meeting_code,
    newCode: code(i + 1),
    date: r.date_str || '(no date)',
    deleted: !!r.deleted_at,
  }));
  const moving = plan.filter((p) => p.oldCode !== p.newCode);

  console.log(`[renumber-meetings] ${rows.length} meeting(s); ${moving.length} will change code.\n`);
  console.log('  DATE        OLD       ->  NEW');
  console.log('  ----------  --------      --------');
  plan.forEach((p) => {
    const mark = p.oldCode === p.newCode ? '   ' : '-> ';
    const del = p.deleted ? '  (in Trash)' : '';
    console.log(`  ${p.date}  ${p.oldCode.padEnd(8)}  ${mark}${p.newCode}${del}`);
  });

  if (!APPLY) {
    console.log('\n[renumber-meetings] DRY RUN — nothing was changed.');
    console.log('[renumber-meetings] Re-run with --apply to commit:');
    console.log('[renumber-meetings]     npm run renumber-meetings -- --apply');
    await pool.end();
    return;
  }
  if (moving.length === 0) {
    console.log('\n[renumber-meetings] Codes are already in date order — nothing to apply.');
    await pool.end();
    return;
  }

  await withTransaction(async (client) => {
    await renumberMeetings(client);
    await client.query(
      `INSERT INTO audit_events (actor_id, event_type, target_type, payload)
       VALUES (NULL, 'data.meeting.renumbered', 'meeting', $1::jsonb)`,
      [JSON.stringify({ total: rows.length, changed: moving.length })]
    );
  });

  console.log(`\n[renumber-meetings] Done — ${moving.length} code(s) updated in date order.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('[renumber-meetings] fatal:', err.message || err);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
