// ---------------------------------------------------------------------------
//  Documents  -  files attached to a communication or a meeting.
//
//  Bytes live in object storage (S3-compatible) when STORAGE_BACKEND=s3, or
//  on local disk otherwise. The storage backend used for each file is
//  recorded on the row (documents.storage_backend) so a partial migration
//  can coexist.
//
//  Downloads are streamed through the API so every download is authenticated
//  + audit-able. Files in private buckets stay private.
// ---------------------------------------------------------------------------
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { query } = require('../db');
const { wrap, httpError } = require('../helpers');
const { requireEditor } = require('../auth');
const { logAudit } = require('../audit');
const { newGroupId } = require('../softDelete');
const storage = require('../storage');

const router = express.Router();

const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 25;

// Bytes go to memory so we can hand them to either backend uniformly. The
// upload size cap is enforced by multer before we ever see the buffer.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

const PARENT_TYPES = { communication: 'communications', meeting: 'meetings' };

function makeStoredName(originalName) {
  const stamp = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName || '');
  return `${Date.now()}-${stamp}${ext}`;
}

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
      `SELECT id FROM ${PARENT_TYPES[parentType]} WHERE id = $1 AND deleted_at IS NULL`,
      [Number(parentId)]
    );
    if (!parent.rows[0]) {
      throw httpError(404, 'The record to attach the document to was not found.');
    }
    if (!req.files || req.files.length === 0) {
      throw httpError(400, 'No file was received.');
    }

    const saved = [];
    for (const f of req.files) {
      const storedName = makeStoredName(f.originalname);

      // Persist the bytes first; only insert the row if the put succeeded.
      const backend = await storage.put({
        buffer: f.buffer,
        mimeType: f.mimetype,
        storedName,
      });

      const { rows } = await query(
        `INSERT INTO documents
           (parent_type, parent_id, original_name, stored_name,
            mime_type, size_bytes, uploaded_by, storage_backend)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at`,
        [
          parentType,
          Number(parentId),
          f.originalname,
          storedName,
          f.mimetype,
          f.size,
          (req.user && req.user.name) || null,
          backend,
        ]
      );
      saved.push(rows[0]);

      await logAudit({
        actor_id: req.user.id,
        event: 'data.document.uploaded',
        target_type: 'document',
        target_id: rows[0].id,
        payload: {
          original_name: f.originalname,
          size_bytes: f.size,
          parent_type: parentType,
          parent_id: Number(parentId),
          storage_backend: backend,
        },
        req,
      });
      await logAudit({
        actor_id: req.user.id,
        event: 'data.' + parentType + '.document_attached',
        target_type: parentType,
        target_id: Number(parentId),
        payload: { document_id: rows[0].id, original_name: f.originalname },
        req,
      });
    }
    res.status(201).json(saved);
  })
);

// GET /api/documents/:id/download  -  stream a stored file (signed-in users).
router.get(
  '/:id/download',
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL',
      [Number(req.params.id)]
    );
    const doc = rows[0];
    if (!doc) throw httpError(404, 'Document not found.');

    let payload;
    try {
      payload = await storage.get({
        storedName: doc.stored_name,
        storageBackend: doc.storage_backend,
      });
    } catch (err) {
      if (err.code === 'STORAGE_MISSING' || err.name === 'NoSuchKey') {
        throw httpError(410, 'The stored file is no longer available.');
      }
      throw err;
    }

    res.setHeader('Content-Type', doc.mime_type || payload.contentType || 'application/octet-stream');
    if (payload.contentLength != null) {
      res.setHeader('Content-Length', String(payload.contentLength));
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(doc.original_name)}"`
    );
    payload.stream.pipe(res);
  })
);

// DELETE /api/documents/:id  -  soft-delete; bytes survive until Trash purge.
router.delete(
  '/:id',
  requireEditor,
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL',
      [Number(req.params.id)]
    );
    const doc = rows[0];
    if (!doc) throw httpError(404, 'Document not found.');

    const group = newGroupId();
    await query(
      `UPDATE documents
       SET deleted_at = now(), deleted_by = $1, deletion_group_id = $2
       WHERE id = $3 AND deleted_at IS NULL`,
      [req.user.id, group, doc.id]
    );
    // The stored object stays put — it's the cheap part of restore. Purge
    // from Trash later will unlink it via storage.remove.

    await logAudit({
      actor_id: req.user.id,
      event: 'data.document.deleted',
      target_type: 'document',
      target_id: doc.id,
      payload: {
        original_name: doc.original_name,
        parent_type: doc.parent_type,
        parent_id: doc.parent_id,
      },
      req,
    });
    await logAudit({
      actor_id: req.user.id,
      event: 'data.' + doc.parent_type + '.document_removed',
      target_type: doc.parent_type,
      target_id: doc.parent_id,
      payload: { document_id: doc.id, original_name: doc.original_name },
      req,
    });
    res.json({ ok: true });
  })
);

module.exports = router;
