// ---------------------------------------------------------------------------
//  Documents  -  files uploaded into the platform and attached to a
//  communication or a meeting. Files are stored on disk under UPLOAD_DIR;
//  downloads are served only to signed-in users.
// ---------------------------------------------------------------------------
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { query } = require('../db');
const { wrap, httpError } = require('../helpers');
const { requireEditor } = require('../auth');

const router = express.Router();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 25;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const stamp = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${stamp}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

const PARENT_TYPES = { communication: 'communications', meeting: 'meetings' };

// POST /api/documents/:parentType/:parentId  -  upload one or more files.
router.post(
  '/:parentType/:parentId',
  requireEditor,
  upload.array('files', 10),
  wrap(async (req, res) => {
    const { parentType, parentId } = req.params;
    if (!PARENT_TYPES[parentType]) {
      throw httpError(400, 'Documents attach to a communication or a meeting only.');
    }
    const parent = await query(
      `SELECT id FROM ${PARENT_TYPES[parentType]} WHERE id = $1`,
      [Number(parentId)]
    );
    if (!parent.rows[0]) {
      // Clean up files that were saved before we noticed the bad parent.
      (req.files || []).forEach((f) => fs.existsSync(f.path) && fs.unlinkSync(f.path));
      throw httpError(404, 'The record to attach the document to was not found.');
    }
    if (!req.files || req.files.length === 0) {
      throw httpError(400, 'No file was received.');
    }

    const saved = [];
    for (const f of req.files) {
      const { rows } = await query(
        `INSERT INTO documents
           (parent_type, parent_id, original_name, stored_name,
            mime_type, size_bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at`,
        [
          parentType,
          Number(parentId),
          f.originalname,
          f.filename,
          f.mimetype,
          f.size,
          (req.user && req.user.name) || null,
        ]
      );
      saved.push(rows[0]);
    }
    res.status(201).json(saved);
  })
);

// GET /api/documents/:id/download  -  stream a stored file (signed-in users).
router.get(
  '/:id/download',
  wrap(async (req, res) => {
    const { rows } = await query('SELECT * FROM documents WHERE id = $1', [
      Number(req.params.id),
    ]);
    const doc = rows[0];
    if (!doc) throw httpError(404, 'Document not found.');

    const filePath = path.join(UPLOAD_DIR, doc.stored_name);
    if (!fs.existsSync(filePath)) {
      throw httpError(410, 'The stored file is no longer available.');
    }
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(doc.original_name)}"`
    );
    fs.createReadStream(filePath).pipe(res);
  })
);

// DELETE /api/documents/:id  -  remove a document and its file.
router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const { rows } = await query('SELECT * FROM documents WHERE id = $1', [
      Number(req.params.id),
    ]);
    const doc = rows[0];
    if (!doc) throw httpError(404, 'Document not found.');

    await query('DELETE FROM documents WHERE id = $1', [doc.id]);
    const filePath = path.join(UPLOAD_DIR, doc.stored_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  })
);

module.exports = router;
