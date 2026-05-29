// ---------------------------------------------------------------------------
//  Restore. Shells out to pg_restore to load a .dump file into the database
//  pointed at by DATABASE_URL. Destructive — every existing row in every
//  table referenced by the dump is dropped first (--clean --if-exists), so
//  the script refuses to run without an explicit --force argument.
//
//  Usage:  npm run restore -- <path-to-dump> --force
// ---------------------------------------------------------------------------
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const dumpPath = argv.find((a) => !a.startsWith('--'));

  if (!dumpPath) {
    console.error('Usage: npm run restore -- <path-to-dump> --force');
    process.exit(1);
  }
  if (!fs.existsSync(dumpPath)) {
    console.error(`[restore] file not found: ${dumpPath}`);
    process.exit(1);
  }
  if (!force) {
    console.error('[restore] Refusing to run without --force. This wipes existing data first.');
    console.error('         Re-run with:  npm run restore -- ' + dumpPath + ' --force');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[restore] DATABASE_URL is not set. Refusing to run.');
    process.exit(1);
  }

  console.log(`[restore] restoring ${path.resolve(dumpPath)}`);
  const args = [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--dbname=' + url,
    dumpPath,
  ];

  await new Promise((resolve, reject) => {
    const child = spawn('pg_restore', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          'pg_restore not found on PATH. Install Postgres client tools and try again.'
        ));
        return;
      }
      reject(err);
    });
    child.on('exit', (code) => {
      // pg_restore returns 1 on warnings (e.g. dropping nonexistent objects);
      // accept that case explicitly because --if-exists is doing its job.
      if (code === 0 || code === 1) resolve();
      else reject(new Error(`pg_restore exited with code ${code}`));
    });
  });

  console.log('[restore] done.');
}

main().catch((err) => {
  console.error('[restore] failed:', err.message);
  process.exit(1);
});
