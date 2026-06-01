// ---------------------------------------------------------------------------
//  Database connection pool.
//  Exposes query() for one-off statements and withTransaction() for grouped
//  writes that must succeed or fail together.
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

// One project timezone so the database's CURRENT_DATE / date_trunc and the
// in-process cron schedules all agree (otherwise "due tomorrow" reminders and
// the weekly digest can misfire by a day on a UTC host). Override with APP_TZ.
const APP_TZ = process.env.APP_TZ || 'Asia/Qatar';

// Hosted Postgres providers (Render, Heroku, Supabase, Neon, ...) require
// TLS. Enable it whenever the connection string points at a non-localhost
// host, or whenever PGSSL=true is set explicitly.
function needsSsl(url) {
  if (process.env.PGSSL === 'true') return true;
  if (process.env.PGSSL === 'false') return false;
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host !== 'localhost' && host !== '127.0.0.1';
  } catch {
    return false;
  }
}

const sslOption = needsSsl(process.env.DATABASE_URL)
  ? { ssl: { rejectUnauthorized: false } }
  : {};

// Pin every connection's session timezone at startup (via the connection
// `options`, not a follow-up query) so CURRENT_DATE / date_trunc match the
// cron schedules — race-free, applied before the first query runs.
const tzOption = { options: `-c timezone=${APP_TZ}` };

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ...tzOption, ...sslOption })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'spd_tracker',
      user: process.env.PGUSER || 'spd_user',
      password: process.env.PGPASSWORD || '',
      ...tzOption,
      ...sslOption,
    });

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction, APP_TZ };
