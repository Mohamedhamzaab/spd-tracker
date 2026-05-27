// ---------------------------------------------------------------------------
//  Database connection pool.
//  Exposes query() for one-off statements and withTransaction() for grouped
//  writes that must succeed or fail together.
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

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

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ...sslOption })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'spd_tracker',
      user: process.env.PGUSER || 'spd_user',
      password: process.env.PGPASSWORD || '',
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

module.exports = { pool, query, withTransaction };
