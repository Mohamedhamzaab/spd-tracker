// ---------------------------------------------------------------------------
//  Init wrapper for hosted environments (Render, Railway, Fly, ...).
//
//  1. Applies the schema (idempotent).
//  2. Runs the destructive seed ONLY if the authorities table is empty,
//     so existing data is never wiped by an automatic restart.
//  3. Hands off to the server.
//
//  Usage:  node src/init.js
// ---------------------------------------------------------------------------
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const { logAudit } = require('./audit');

async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[init] Applying schema...');
  await pool.query(sql);
  console.log('[init] Schema ready.');
}

async function isAuthoritiesEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM authorities');
  return rows[0].n === 0;
}

// Emergency way back in: when NO active super-admin is left, promote the
// account named in SUPERADMIN_EMAIL (unset = off). It never overrides a role a
// super-admin set on the Users page, and every promotion is audited.
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();

async function ensureSuperAdmin() {
  if (!SUPERADMIN_EMAIL) return;
  const active = await pool.query(
    `SELECT 1 FROM users WHERE role = 'super_admin' AND is_disabled = FALSE LIMIT 1`
  );
  if (active.rows[0]) return;
  const { rows } = await pool.query(
    'SELECT id, role FROM users WHERE lower(email) = $1',
    [SUPERADMIN_EMAIL]
  );
  const u = rows[0];
  if (!u) {
    console.log(`[init] Owner ${SUPERADMIN_EMAIL} not found yet — skipping super-admin bootstrap.`);
    return;
  }
  // Promote + ensure the account can actually sign in. token_version is bumped
  // intentionally here (a role change should invalidate any stale session).
  await pool.query(
    `UPDATE users
     SET role = 'super_admin', is_disabled = FALSE,
         failed_login_count = 0, locked_until = NULL,
         token_version = token_version + 1
     WHERE id = $1`,
    [u.id]
  );
  await logAudit({
    event: 'user.role_changed',
    target_type: 'user',
    target_id: u.id,
    payload: { from: u.role, to: 'super_admin', reason: 'No active super-admin at startup (SUPERADMIN_EMAIL).' },
  });
  console.log(`[init] No active super-admin: promoted ${SUPERADMIN_EMAIL} (was ${u.role}).`);
}

async function runSeed() {
  console.log('[init] No authorities found - running first-time seed...');
  // seed.js calls pool.end() when it finishes; require it inside a child
  // process-like async boundary so it doesn't kill our pool prematurely.
  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, 'seed.js')], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`seed exited with code ${code}`))
    );
  });
}

async function main() {
  await applySchema();
  if (await isAuthoritiesEmpty()) {
    await runSeed();
  } else {
    console.log('[init] Authorities already present - skipping seed.');
  }
  await ensureSuperAdmin();
  // The engagement register is kept on the site (the master since 17 Nov 2026).
  // A new environment gets it from a backup: npm run backup / npm run restore.
  // NOTE: do NOT call pool.end() here. server.js shares the same pool
  // via db.js, and ending it would make every subsequent query fail with
  // "Cannot use a pool after calling end on the pool".

  console.log('[init] Starting API server...');
  require('./server');
}

main().catch((err) => {
  console.error('[init] Startup failed:', err);
  process.exit(1);
});
