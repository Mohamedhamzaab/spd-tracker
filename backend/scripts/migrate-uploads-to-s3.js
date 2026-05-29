// ---------------------------------------------------------------------------
//  One-time migration: copy every document that still lives on local disk
//  into object storage and update its storage_backend flag.
//
//  Safe to re-run: rows already at storage_backend='s3' are skipped, and a
//  missing source file is logged and skipped (the database row stays as-is).
//
//  Usage:
//    STORAGE_BACKEND=s3 S3_BUCKET=... S3_REGION=... \
//    S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
//    [S3_ENDPOINT=...] [S3_FORCE_PATH_STYLE=true] \
//    npm run migrate-uploads
// ---------------------------------------------------------------------------
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../src/db');

async function main() {
  if ((process.env.STORAGE_BACKEND || '').toLowerCase() !== 's3') {
    console.error('[migrate] STORAGE_BACKEND must be set to "s3" to migrate.');
    console.error('         (Currently: ' + (process.env.STORAGE_BACKEND || 'unset') + ')');
    process.exit(1);
  }
  if (!process.env.S3_BUCKET) {
    console.error('[migrate] S3_BUCKET is required.');
    process.exit(1);
  }

  const storage = require('../src/storage');
  const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

  const { rows: pending } = await query(
    `SELECT id, original_name, stored_name, mime_type, size_bytes, storage_backend
     FROM documents
     WHERE storage_backend = 'disk'
     ORDER BY id`
  );
  console.log(`[migrate] ${pending.length} document(s) still on disk.`);

  let ok = 0;
  let missing = 0;
  let failed = 0;

  for (const d of pending) {
    const src = path.join(UPLOAD_DIR, d.stored_name);
    if (!fs.existsSync(src)) {
      console.warn(`[migrate] missing on disk, skipped: id=${d.id} (${d.stored_name})`);
      missing += 1;
      continue;
    }
    try {
      const buffer = await fs.promises.readFile(src);
      await storage.put({
        buffer,
        mimeType: d.mime_type || 'application/octet-stream',
        storedName: d.stored_name,
      });
      await query(
        'UPDATE documents SET storage_backend = $1 WHERE id = $2',
        ['s3', d.id]
      );
      ok += 1;
      console.log(`[migrate] uploaded id=${d.id} (${d.original_name})`);
    } catch (err) {
      failed += 1;
      console.error(`[migrate] failed id=${d.id}: ${err.message}`);
    }
  }

  console.log('-----');
  console.log(`[migrate] uploaded: ${ok}, missing: ${missing}, failed: ${failed}`);
  if (failed > 0) {
    console.error('[migrate] re-run after investigating failures.');
    await pool.end();
    process.exit(2);
  }
  if (missing > 0) {
    console.log('[migrate] some source files were missing — those rows still say "disk".');
    console.log('         Decide whether to clean them up (DELETE FROM documents WHERE ...) or');
    console.log('         leave them as historical placeholders.');
  } else {
    console.log('[migrate] all done.');
  }
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});
