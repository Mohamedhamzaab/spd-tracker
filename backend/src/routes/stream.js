// ---------------------------------------------------------------------------
//  Server-Sent Events — /api/stream.
//
//  Persistent HTTP connection that streams CRUD events to connected
//  clients. The frontend uses these as cache-invalidation signals so its
//  list pages refetch silently when upstream data changes — the "live"
//  read-only view that the Egis/Client/Safari Park Doha users get.
//
//  Auth: EventSource can't set headers, so the bearer token comes via
//  ?token=... query parameter. The token is validated identically to the
//  Authorization-header path.
// ---------------------------------------------------------------------------
const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { subscribe } = require('../eventBus');
const { httpError } = require('../helpers');

const SECRET = process.env.JWT_SECRET || 'insecure-development-secret';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const token = (req.query.token || '').trim() ||
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return next(httpError(401, 'Sign in to subscribe.'));

    let payload;
    try {
      payload = jwt.verify(token, SECRET);
    } catch {
      return next(httpError(401, 'Your session has expired.'));
    }
    if (payload.stage && payload.stage !== 'session') {
      return next(httpError(401, 'Finish signing in first.'));
    }

    // Confirm the user is still active and the token_version matches.
    const fresh = (await query(
      `SELECT id, role, is_disabled, token_version
       FROM users WHERE id = $1`,
      [payload.id]
    )).rows[0];
    if (!fresh || fresh.is_disabled) {
      return next(httpError(401, 'Your account is not active.'));
    }
    if ((payload.token_version || 0) !== fresh.token_version) {
      return next(httpError(401, 'Your session was ended.'));
    }

    // SSE headers.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders?.();

    // Greeting frame — lets the client log connection success.
    res.write(`: SPD Tracker stream open\n\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({ user_id: fresh.id })}\n\n`);

    // Keepalive comment every 25 s so proxies don't terminate the idle
    // connection.
    const heartbeat = setInterval(() => {
      try { res.write(`: ping\n\n`); } catch { /* ignore */ }
    }, 25_000);

    const unsubscribe = subscribe((evt) => {
      try {
        res.write(`event: ${evt.kind}\nid: ${evt.id}\ndata: ${JSON.stringify(evt)}\n\n`);
      } catch {
        // ignore — the next req.on('close') will clean up
      }
    });

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
