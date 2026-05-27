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

const { router: authRouter, requireAuth } = require('./auth');
const authorities = require('./routes/authorities');
const subdivisions = require('./routes/subdivisions');
const communications = require('./routes/communications');
const meetings = require('./routes/meetings');
const documents = require('./routes/documents');
const dashboard = require('./routes/dashboard');
const { router: lists } = require('./routes/lists');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Simple request log.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    console.log(
      `${new Date().toISOString()}  ${req.method} ${req.originalUrl}  ${res.statusCode}  ${Date.now() - started}ms`
    );
  });
  next();
});

// Health check, useful for deployment monitoring.
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Authentication is open; everything else under /api needs a valid token.
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.use('/api/authorities', authorities);
app.use('/api/sub-divisions', subdivisions);
app.use('/api/communications', communications);
app.use('/api/meetings', meetings);
app.use('/api/documents', documents);
app.use('/api/dashboard', dashboard);
app.use('/api/lists', lists);

// Serve the built front end if it has been built.
const clientDir = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get(/^\/(?!api).*/, (req, res) => {
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
  if (status >= 500) console.error('Server error:', err);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`SPD Tracker API listening on port ${PORT}`);
});

module.exports = app;
