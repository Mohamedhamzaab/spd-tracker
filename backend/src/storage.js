// ---------------------------------------------------------------------------
//  Document storage. Two backends behind one interface so the rest of the
//  app doesn't care where bytes live.
//
//    disk  (default in dev)   files under UPLOAD_DIR
//    s3                        any S3-compatible object store
//                              (AWS S3, Cloudflare R2, MinIO, Backblaze B2,
//                               Wasabi, …)
//
//  Selected by STORAGE_BACKEND env. Each Document row also records its own
//  backend in documents.storage_backend so a partial migration can coexist:
//  some files on disk, newer ones on S3, both downloadable.
//
//  Object key in S3 mode is the document's stored_name unchanged, prefixed
//  with S3_KEY_PREFIX (default 'documents/').
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const BACKEND = (process.env.STORAGE_BACKEND || 'disk').toLowerCase();
const S3_BUCKET = process.env.S3_BUCKET;
const S3_KEY_PREFIX = (process.env.S3_KEY_PREFIX || 'documents/').replace(/^\/+/, '');

let s3Client = null;
function getS3() {
  if (s3Client) return s3Client;
  const {
    S3Client,
  } = require('@aws-sdk/client-s3');

  if (!S3_BUCKET) {
    throw new Error('STORAGE_BACKEND=s3 but S3_BUCKET is not set.');
  }
  s3Client = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined, // required for R2 / MinIO
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    } : undefined, // fall back to the default AWS credential chain (IAM roles, env, etc.)
  });
  return s3Client;
}

function s3KeyFor(storedName) {
  return S3_KEY_PREFIX + storedName;
}

// --- public API -------------------------------------------------------------

function activeBackend() {
  return BACKEND === 's3' ? 's3' : 'disk';
}

// Persist a Buffer or stream payload. Returns the backend the file ended up
// on so the caller can stamp documents.storage_backend.
async function put({ buffer, mimeType, storedName }) {
  if (BACKEND === 's3') {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await getS3().send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3KeyFor(storedName),
      Body: buffer,
      ContentType: mimeType || 'application/octet-stream',
    }));
    return 's3';
  }
  const target = path.join(UPLOAD_DIR, storedName);
  await fs.promises.writeFile(target, buffer);
  return 'disk';
}

// Returns an object that resembles a Node readable stream so the route
// handler can pipe it into the HTTP response.
//   { stream, contentType, contentLength }
async function get({ storedName, storageBackend }) {
  // Per-row override: rows uploaded before migration may still live on disk
  // even if the backend default is now s3.
  const effective = (storageBackend || BACKEND);

  if (effective === 's3') {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const out = await getS3().send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3KeyFor(storedName),
    }));
    return {
      stream: out.Body,
      contentType: out.ContentType,
      contentLength: out.ContentLength,
    };
  }
  const target = path.join(UPLOAD_DIR, storedName);
  if (!fs.existsSync(target)) {
    const err = new Error('Stored file not found on disk.');
    err.code = 'STORAGE_MISSING';
    throw err;
  }
  return {
    stream: fs.createReadStream(target),
    contentType: undefined,
    contentLength: fs.statSync(target).size,
  };
}

// Remove the file. Best-effort: a missing file is treated as success because
// the database row is the source of truth and the file is just cached bytes.
async function remove({ storedName, storageBackend }) {
  const effective = (storageBackend || BACKEND);
  if (effective === 's3') {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    try {
      await getS3().send(new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3KeyFor(storedName),
      }));
    } catch (err) {
      console.error('[storage] s3 delete failed:', err.message);
    }
    return;
  }
  const target = path.join(UPLOAD_DIR, storedName);
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch (err) {
    console.error('[storage] disk unlink failed:', err.message);
  }
}

module.exports = { put, get, remove, activeBackend, UPLOAD_DIR, s3KeyFor };
