// ---------------------------------------------------------------------------
//  Manual digest runner. Use this to:
//    - preview the digest body locally before flipping DIGEST_ENABLED=true
//    - force a one-off send (e.g. start-of-week catch-up)
//    - send to a specific user (--user=...) for QA
//
//  Examples:
//    npm run digest -- --dry-run
//    npm run digest -- --user=sherif.eldaly@ecg.example
//    npm run digest                          (sends to everyone, once per week)
// ---------------------------------------------------------------------------
require('dotenv').config();
const { pool, query } = require('../src/db');
const { runDigest, buildDigestData, digestText } = require('../src/digest');

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const userFlag = argv.find((a) => a.startsWith('--user='));
  const preview = argv.includes('--preview');

  if (preview) {
    const data = await buildDigestData();
    const u = (await query('SELECT name, email FROM users LIMIT 1')).rows[0] ||
      { name: 'Preview User', email: 'preview@example.local' };
    console.log(digestText(u, data));
    await pool.end();
    return;
  }

  let forceUserId = null;
  if (userFlag) {
    const email = userFlag.slice('--user='.length).toLowerCase();
    const r = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (!r.rows[0]) {
      console.error(`[digest] no user with email ${email}`);
      await pool.end();
      process.exit(1);
    }
    forceUserId = r.rows[0].id;
  }

  const result = await runDigest({ dryRun, forceUserId });
  console.log(`[digest] dryRun=${dryRun} forceUserId=${forceUserId || 'all'} → ${JSON.stringify(result)}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[digest] fatal:', err);
  process.exit(1);
});
