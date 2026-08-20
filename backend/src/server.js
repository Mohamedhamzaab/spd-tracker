// ---------------------------------------------------------------------------
//  Safari Park Project  -  Authority Engagement Tracker
//  API server. Also serves the built front end when present, so the whole
//  platform runs as a single process.
// ---------------------------------------------------------------------------
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { logger, httpLogger, initSentry, captureException } = require('./logger');
initSentry();

const { router: authRouter, requireAuth, requireClearedGates } = require('./auth');
const authorities = require('./routes/authorities');
const subdivisions = require('./routes/subdivisions');
const communications = require('./routes/communications');
const meetings = require('./routes/meetings');
const qdrs = require('./routes/qdrs');
const documents = require('./routes/documents');
const dashboard = require('./routes/dashboard');
const users = require('./routes/users');
const audit = require('./routes/audit');
const trash = require('./routes/trash');
const exportsRouter = require('./routes/exports');
const views = require('./routes/views');
const stream = require('./routes/stream');
const comments = require('./routes/comments');
const tasks = require('./routes/tasks');
const { router: lists } = require('./routes/lists');
const engagement = require('./routes/engagement');

const app = express();
// Behind Render's proxy, trust the first hop so req.ip reflects the client.
app.set('trust proxy', 1);

// Security headers. CSP is loosened in dev so Vite's HMR script + inline
// styles still work; in production we keep helmet's defaults, with one
// addition: allow same-origin in-memory blob: URLs in frames/images so the
// in-app document viewer can preview PDFs and images (the file is fetched
// authenticated and rendered from a blob, never a remote URL).
const isProd = process.env.NODE_ENV === 'production';
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            'frame-src': ["'self'", 'blob:'],
            'img-src': ["'self'", 'data:', 'blob:'],
            // The CAD viewer (dxf-viewer) fetches the converted DXF from an
            // in-memory blob: URL, so connect-src must allow blob: too.
            'connect-src': ["'self'", 'blob:'],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false, // allow R3F WebGL textures
  })
);
// In production a wildcard CORS origin is never acceptable — require an
// explicit CORS_ORIGIN. In dev, fall back to "*" for convenience.
const corsOrigin = process.env.CORS_ORIGIN || (isProd ? false : '*');
app.use(cors({ origin: corsOrigin }));
// 1 MB is plenty for our JSON payloads; uploads use multer separately.
app.use(express.json({ limit: '1mb' }));

// Structured access log via pino-http. JSON in production, pretty in dev.
app.use(httpLogger());

// Health check, useful for deployment monitoring.
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Authentication is open; everything else under /api needs a valid token.
app.use('/api/auth', authRouter);
// SSE handles its own auth (EventSource can't send headers, so it reads the
// token from a query param) — mount it BEFORE requireAuth.
app.use('/api/stream', stream);
app.use('/api', requireAuth);
// After auth, enforce the account gates (must-change-password, MFA enrollment)
// on the whole data API. The /api/auth/* router above is exempt because it is
// mounted before this point, so the gate-clearing endpoints stay reachable.
app.use('/api', requireClearedGates);
app.use('/api/authorities', authorities);
app.use('/api/sub-divisions', subdivisions);
app.use('/api/communications', communications);
app.use('/api/meetings', meetings);
app.use('/api/qdrs', qdrs);
app.use('/api/documents', documents);
app.use('/api/dashboard', dashboard);
app.use('/api/users', users);
app.use('/api/audit', audit);
app.use('/api/trash', trash);
app.use('/api/exports', exportsRouter);
app.use('/api/views', views);
app.use('/api/comments', comments);
app.use('/api/tasks', tasks);
app.use('/api/lists', lists);
app.use('/api/engagement', engagement);

// Serve the built front end if it has been built.
const clientDir = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(clientDir)) {
  // Hashed asset files (index-<hash>.js/css) are content-addressed, so they
  // can be cached forever. The HTML shell must NEVER be cached, or a browser
  // keeps running an old bundle after a deploy — which previously left an
  // exempt user stuck on the (stale) MFA-setup gate.
  app.use(express.static(clientDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/[\\/]assets[\\/]/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

// Unknown API route.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Central error handler. Multer and thrown httpErrors land here.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is larger than the upload limit.' });
  }
  const status = err.status || 500;
  if (status >= 500) {
    logger.error({ err, path: req.originalUrl, method: req.method }, 'Server error');
    captureException(err, {
      user: req.user ? { id: req.user.id, email: req.user.email, username: req.user.name, role: req.user.role } : undefined,
      request: { method: req.method, path: req.originalUrl, ip: req.ip },
    });
  }
  // Thrown httpErrors carry a safe, user-facing message. Unexpected 500s may
  // carry raw driver/internal text — return a generic message to the client
  // and keep the detail in the log/Sentry only.
  const clientMessage = status >= 500
    ? 'Something went wrong. Please try again.'
    : (err.message || 'Something went wrong.');
  res.status(status).json({ error: clientMessage });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  logger.info({ port: PORT }, `SPD Tracker API listening on port ${PORT}`);
  try {
    require('./digest').startScheduler();
  } catch (err) {
    logger.error({ err: err.message }, '[digest] failed to start scheduler');
  }
  try {
    require('./taskNotify').startScheduler();
  } catch (err) {
    logger.error({ err: err.message }, '[task-reminders] failed to start scheduler');
  }
});

module.exports = app;
