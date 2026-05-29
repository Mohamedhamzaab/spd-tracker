// ---------------------------------------------------------------------------
//  Backup. Shells out to pg_dump and writes a timestamped, compressed
//  custom-format dump into BACKUP_DIR (default ./backups/).
//
//  Why custom format (-Fc):
//    - smallest restorable artefact (compressed by default)
//    - selective restore is possible (pg_restore -t table_name)
//    - matches pg_restore exactly — no shell pipe needed
//
//  Usage:  npm run backup
// ---------------------------------------------------------------------------
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[backup] DATABASE_URL is not set. Refusing to run.');
    process.exit(1);
  }

  const outDir = path.resolve(process.env.BACKUP_DIR || './backups');
  fs.mkdirSync(outDir, { recursive: true });

  const filename = `spd-tracker_${nowStamp()}.dump`;
  const outPath = path.join(outDir, filename);

  console.log(`[backup] dumping → ${outPath}`);
  const args = [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file=' + outPath,
    url,
  ];

  await new Promise((resolve, reject) => {
    const child = spawn('pg_dump', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          'pg_dump not found on PATH. Install Postgres client tools (`brew install postgresql@16` or your platform equivalent) and try again.'
        ));
        return;
      }
      reject(err);
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}`));
    });
  });

  const size = fs.statSync(outPath).size;
  const mb = (size / 1024 / 1024).toFixed(2);
  console.log(`[backup] done. ${mb} MB`);
  console.log('[backup] restore with:  npm run restore -- ' + outPath + ' --force');
}

main().catch((err) => {
  console.error('[backup] failed:', err.message);
  process.exit(1);
});
