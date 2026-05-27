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
