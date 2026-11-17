// The account gates hold on the server, not only in the browser: a session for
// someone who must change their password, or has not set up two-factor login,
// is refused by the data API. LOCAL database only; the test account is removed.
const test = require('node:test');
const assert = require('node:assert');
const { pool } = require('../src/db');
const { requireAuth, requireClearedGates, signSessionJwt } = require('../src/auth');

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '@localhost/');
test.after(() => pool.end());

// The two checks server.js puts in front of every /api data route. Resolves to
// the status a refused request gets, or 'through' when it reaches the route.
function throughGates(user) {
  const req = { headers: { authorization: 'Bearer ' + signSessionJwt(user) } };
  return new Promise((resolve) => requireAuth(req, {}, (err) => {
    if (err) return resolve(err.status);
    requireClearedGates(req, {}, (err2) => resolve(err2 ? err2.status : 'through'));
  }));
}

test('the data API refuses a session until the account gates are cleared', { skip: !local && 'DATABASE_URL is not local' }, async () => {
  const u = (await pool.query(
    `INSERT INTO users (name, email, role, password_must_change, mfa_exempt)
     VALUES ('Gate test', 'gate-test@example.test', 'reviewer', TRUE, FALSE) RETURNING *`)).rows[0];
  const set = (sql) => pool.query(`UPDATE users SET ${sql} WHERE id = $1`, [u.id]);
  try {
    assert.strictEqual(await throughGates(u), 403, 'must change password first');
    await set('password_must_change = FALSE');
    assert.strictEqual(await throughGates(u), 403, 'must set up two-factor login first');
    await set('mfa_enrolled_at = now()');
    assert.strictEqual(await throughGates(u), 'through');
    await set('is_disabled = TRUE');
    assert.strictEqual(await throughGates(u), 401, 'a disabled account is out at once');
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [u.id]);
  }
});

test('after a lockout runs out, one wrong password does not lock the account again', { skip: !local && 'DATABASE_URL is not local' }, async () => {
  const express = require('express');
  const bcrypt = require('bcryptjs');
  const srv = express().use(express.json()).use('/api/auth', require('../src/auth').router).listen(0);
  const u = (await pool.query(
    `INSERT INTO users (name, email, role, password_hash, failed_login_count, locked_until)
     VALUES ('Lock test', 'lock-test@example.test', 'reviewer', $1, 5, now() - interval '1 minute')
     RETURNING id`, [await bcrypt.hash('right-password', 4)])).rows[0];
  try {
    const r = await fetch(`http://localhost:${srv.address().port}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lock-test@example.test', password: 'wrong-password' }),
    });
    assert.strictEqual(r.status, 401, 'a plain "incorrect", not 423 Locked');
    const after = (await pool.query('SELECT failed_login_count, locked_until FROM users WHERE id = $1', [u.id])).rows[0];
    assert.deepStrictEqual(after, { failed_login_count: 1, locked_until: null });
  } finally {
    srv.close();
    await pool.query('DELETE FROM audit_events WHERE target_type = $1 AND target_id = $2', ['user', u.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [u.id]);
  }
});
