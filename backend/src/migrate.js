// ---------------------------------------------------------------------------
//  Migration  -  applies schema.sql. Safe to run more than once: every
//  statement uses IF NOT EXISTS or CREATE OR REPLACE.
//
//  Usage:  npm run migrate
// ---------------------------------------------------------------------------
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Applying database schema...');
  await pool.query(sql);
  console.log('Schema applied.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
