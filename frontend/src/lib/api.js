// ---------------------------------------------------------------------------
//  API client. One thin wrapper over fetch that attaches the login token and
//  surfaces server error messages. The token is held in localStorage so a
//  refresh keeps the user signed in.
// ---------------------------------------------------------------------------
const TOKEN_KEY = 'spd_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

function qs(params) {
  if (!params) return '';
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return parts.length ? '?' + parts.join('&') : '';
}

async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body = opts.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers,
    body,
  });

  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Request failed.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// --- document helpers (folder uploads) -------------------------------------
// Mirror of the server's allow-list (routes/documents.js). Files outside this
// set are dropped client-side so a folder full of junk never fails the batch.
const ALLOWED_DOC_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.txt', '.rtf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.tif', '.tiff', '.bmp', '.heic',
  '.dwg', '.dxf', '.dwf', '.rvt', '.ifc', '.skp',
  '.zip', '.rar', '.7z',
]);
// OS bookkeeping files that ride along inside folders — never worth uploading.
const JUNK_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.localized']);
const MAX_BATCH_FILES = 25;
const MAX_BATCH_BYTES = 95 * 1024 * 1024; // stay under Cloudflare's 100 MB cap

function extOf(name) {
  const i = String(name || '').lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

// Accept either a File (optionally carrying a `.relPath` expando set by
// FileDrop for folder uploads) or a { file, relPath } object; always return
// the { file, relPath } shape.
function normalizeDocItems(items) {
  const arr = Array.from(items || []);
  return arr.map((it) =>
    it && it.file
      ? { file: it.file, relPath: it.relPath || '' }
      : { file: it, relPath: (it && it.relPath) || '' }
  );
}

// Returns a human reason to skip a file, or '' to keep it.
function docSkipReason(file, relPath) {
  const leaf = (relPath || file.name || '').split('/').pop();
  if (JUNK_NAMES.has(String(leaf).toLowerCase())) return 'system file';
  if (String(leaf).startsWith('._')) return 'system file'; // macOS AppleDouble
  const ext = extOf(leaf);
  if (!ALLOWED_DOC_EXT.has(ext)) return `unsupported type ${ext || '(none)'}`;
  return '';
}

// Upload one batch via XMLHttpRequest so we get real byte-level progress
// (fetch can't report upload progress). Resolves with the saved-docs array.
// `onBytes(loaded)` fires as bytes leave the browser.
function uploadBatchXHR(parentType, parentId, list, onBytes) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    const relPaths = [];
    for (const { file, relPath } of list) {
      fd.append('files', file);
      relPaths.push(relPath || '');
    }
    fd.append('rel_paths', JSON.stringify(relPaths));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/documents/${parentType}/${parentId}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onBytes) onBytes(e.loaded);
    };
    xhr.onload = () => {
      let data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const err = new Error((data && data.error) || 'Upload failed.');
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(fd);
  });
}

// Split items into request-sized batches: ≤25 files and ≤95 MB each. A single
// file larger than the cap still goes out alone (the server will reject it with
// a clear message rather than us guessing).
function batchDocs(items) {
  const batches = [];
  let cur = [];
  let bytes = 0;
  for (const it of items) {
    const size = it.file.size || 0;
    if (cur.length && (cur.length >= MAX_BATCH_FILES || bytes + size > MAX_BATCH_BYTES)) {
      batches.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

export const api = {
  // auth
  login: (email, password) =>
    req('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => req('/auth/me'),
  forgotPassword: (email) =>
    req('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) =>
    req('/auth/reset-password', { method: 'POST', body: { token, password } }),
  acceptInvite: (token, password) =>
    req('/auth/accept-invite', { method: 'POST', body: { token, password } }),
  changePassword: (current_password, new_password) =>
    req('/auth/change-password', {
      method: 'POST',
      body: { current_password, new_password },
    }),
  mfaStart: () => req('/auth/mfa/start', { method: 'POST' }),
  mfaConfirm: (code) => req('/auth/mfa/confirm', { method: 'POST', body: { code } }),
  mfaVerify: (challenge_token, code, is_backup = false, trust_device = false) =>
    req('/auth/mfa/verify', {
      method: 'POST',
      body: { challenge_token, code, is_backup, trust_device },
    }),
  trustedDevices: () => req('/auth/trusted-devices'),
  revokeTrustedDevice: (id) => req('/auth/trusted-devices/' + id, { method: 'DELETE' }),
  mfaRegenerateBackup: () =>
    req('/auth/mfa/regenerate-backup-codes', { method: 'POST' }),

  // reference data
  lists: () => req('/lists'),
  dashboard: () => req('/dashboard'),
  period: (from, to) => req('/dashboard/period' + qs({ from, to })),

  // authorities
  authorities: () => req('/authorities'),
  authority: (id) => req('/authorities/' + id),
  suggestCode: (name) => req('/authorities/suggest-code' + qs({ name })),
  createAuthority: (b) => req('/authorities', { method: 'POST', body: b }),
  updateAuthority: (id, b) => req('/authorities/' + id, { method: 'PUT', body: b }),
  deleteAuthority: (id) => req('/authorities/' + id, { method: 'DELETE' }),

  // sub-divisions
  subDivisions: (params) => req('/sub-divisions' + qs(params)),
  subDivision: (id) => req('/sub-divisions/' + id),
  createSub: (b) => req('/sub-divisions', { method: 'POST', body: b }),
  updateSub: (id, b) => req('/sub-divisions/' + id, { method: 'PUT', body: b }),
  deleteSub: (id) => req('/sub-divisions/' + id, { method: 'DELETE' }),

  // communications
  communications: (params) => req('/communications' + qs(params)),
  communication: (id) => req('/communications/' + id),
  createComm: (b) => req('/communications', { method: 'POST', body: b }),
  bulkDeleteComms: (ids) => req('/communications/bulk-delete', { method: 'POST', body: { ids } }),
  updateComm: (id, b) => req('/communications/' + id, { method: 'PUT', body: b }),
  deleteComm: (id) => req('/communications/' + id, { method: 'DELETE' }),

  // meetings
  meetings: (params) => req('/meetings' + qs(params)),
  meeting: (id) => req('/meetings/' + id),
  createMeeting: (b) => req('/meetings', { method: 'POST', body: b }),
  updateMeeting: (id, b) => req('/meetings/' + id, { method: 'PUT', body: b }),
  deleteMeeting: (id) => req('/meetings/' + id, { method: 'DELETE' }),
  bulkDeleteMeetings: (ids) => req('/meetings/bulk-delete', { method: 'POST', body: { ids } }),

  // qdrs
  qdrsList: (params) => req('/qdrs' + qs(params)),
  qdrsRecord: (id) => req('/qdrs/' + id),
  createQdrs: (b) => req('/qdrs', { method: 'POST', body: b }),
  updateQdrs: (id, b) => req('/qdrs/' + id, { method: 'PUT', body: b }),
  deleteQdrs: (id) => req('/qdrs/' + id, { method: 'DELETE' }),

  // --- stakeholder engagement ---------------------------------------------
  engSummary: () => req('/engagement/summary'),
  engMatrix: () => req('/engagement/matrix'),
  engSetRating: (subId, b) =>
    req('/engagement/matrix/' + subId, { method: 'PATCH', body: b }),
  engActions: (params) => req('/engagement/actions' + qs(params)),
  engAction: (id) => req('/engagement/actions/' + id),
  engCreateAction: (b) => req('/engagement/actions', { method: 'POST', body: b }),
  engUpdateAction: (id, b) => req('/engagement/actions/' + id, { method: 'PUT', body: b }),
  engDeleteAction: (id) => req('/engagement/actions/' + id, { method: 'DELETE' }),
  engAddProgress: (id, b) =>
    req('/engagement/actions/' + id + '/progress', { method: 'POST', body: b }),
  engDeleteProgress: (id) => req('/engagement/progress/' + id, { method: 'DELETE' }),
  engRestoreProgress: (id) =>
    req('/engagement/progress/' + id + '/restore', { method: 'POST' }),
  engRestoreAction: (id) =>
    req('/engagement/actions/' + id + '/restore', { method: 'POST' }),
  engRemoved: () => req('/engagement/removed'),
  engResolve: (id, b) => req('/engagement/actions/' + id + '/resolve', { method: 'POST', body: b }),
  engSources: (params) => req('/engagement/sources' + qs(params)),
  engOrgs: () => req('/engagement/orgs'),
  bulkDeleteQdrs: (ids) => req('/qdrs/bulk-delete', { method: 'POST', body: { ids } }),

  // users (super_admin)
  users: () => req('/users'),
  createUser: (b) => req('/users', { method: 'POST', body: b }),
  updateUser: (id, b) => req('/users/' + id, { method: 'PATCH', body: b }),
  resendInvite: (id) => req('/users/' + id + '/resend-invite', { method: 'POST' }),
  forceResetUser: (id) => req('/users/' + id + '/force-reset', { method: 'POST' }),
  setTempPassword: (id) => req('/users/' + id + '/set-temp-password', { method: 'POST' }),
  clearUserMfa: (id) => req('/users/' + id + '/clear-mfa', { method: 'POST' }),
  deleteUser: (id) => req('/users/' + id, { method: 'DELETE' }),

  // audit
  audit: (params) => req('/audit' + qs(params)),
  auditEventTypes: () => req('/audit/event-types'),
  auditFor: (type, id, params) =>
    req('/audit/for/' + encodeURIComponent(type) + '/' + Number(id) + qs(params)),

  // comments
  comments: (parent_type, parent_id) =>
    req('/comments' + qs({ parent_type, parent_id })),
  createComment: (b) => req('/comments', { method: 'POST', body: b }),
  updateComment: (id, b) => req('/comments/' + id, { method: 'PATCH', body: b }),
  deleteComment: (id) => req('/comments/' + id, { method: 'DELETE' }),

  // tasks
  tasks: (params) => req('/tasks' + qs(params)),
  taskAssignees: () => req('/tasks/assignees'),
  createTask: (b) => req('/tasks', { method: 'POST', body: b }),
  updateTask: (id, b) => req('/tasks/' + id, { method: 'PATCH', body: b }),
  deleteTask: (id) => req('/tasks/' + id, { method: 'DELETE' }),

  // saved views
  views: (target) => req('/views' + qs(target ? { target } : null)),
  createView: (b) => req('/views', { method: 'POST', body: b }),
  updateView: (id, b) => req('/views/' + id, { method: 'PATCH', body: b }),
  deleteView: (id) => req('/views/' + id, { method: 'DELETE' }),

  // exports — open in a new tab so the browser handles the download UI.
  // The bearer token is in localStorage, but downloads need to round-trip via
  // fetch with the Authorization header. So we stream the response to a Blob
  // and trigger a save dialog manually.
  downloadExport: async (path, filename) => {
    const res = await fetch('/api' + path, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      // Try to surface the server's JSON error message.
      let msg = 'Export failed.';
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch {
        // not JSON — fall through with the generic message
      }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // trash
  trash: () => req('/trash'),
  restore: (type, id) =>
    req('/trash/' + encodeURIComponent(type) + '/' + Number(id) + '/restore', { method: 'POST' }),
  purge: (type, id) =>
    req('/trash/' + encodeURIComponent(type) + '/' + Number(id), { method: 'DELETE' }),

  // documents
  // `items` may be plain File objects (loose files) or { file, relPath }
  // entries (files that came from a dropped/selected folder). The relative
  // path travels in a parallel rel_paths array because busboy strips any
  // directory from the multipart filename.
  uploadDocs: (parentType, parentId, items) => {
    const list = normalizeDocItems(items);
    const fd = new FormData();
    const relPaths = [];
    for (const { file, relPath } of list) {
      fd.append('files', file);
      relPaths.push(relPath || '');
    }
    fd.append('rel_paths', JSON.stringify(relPaths));
    return req(`/documents/${parentType}/${parentId}`, { method: 'POST', body: fd });
  },

  // Upload an arbitrary number of files/folders by splitting them into
  // request-sized batches (Cloudflare rejects any single request over 100 MB).
  // Junk OS files and disallowed extensions are dropped up front and reported
  // back so the UI can show a "skipped N files" summary. `onProgress` fires
  // continuously with { done, total, loaded, totalBytes, pct } so the UI can
  // render a real upload bar. Returns { saved, skipped }.
  uploadDocsBatched: async (parentType, parentId, items, onProgress) => {
    const list = normalizeDocItems(items);
    const skipped = [];
    const keep = [];
    for (const it of list) {
      const reason = docSkipReason(it.file, it.relPath);
      if (reason) skipped.push({ name: it.relPath || it.file.name, reason });
      else keep.push(it);
    }
    const batches = batchDocs(keep);
    const totalBytes = keep.reduce((s, it) => s + (it.file.size || 0), 0);
    const saved = [];
    let doneFiles = 0;
    let bytesBefore = 0; // bytes fully sent in completed batches
    const report = (loaded) => {
      if (!onProgress) return;
      const sent = Math.min(bytesBefore + loaded, totalBytes);
      onProgress({
        done: doneFiles,
        total: keep.length,
        loaded: sent,
        totalBytes,
        pct: totalBytes ? Math.min(100, Math.round((sent / totalBytes) * 100)) : 100,
      });
    };
    report(0);
    for (const batch of batches) {
      const batchBytes = batch.reduce((s, it) => s + (it.file.size || 0), 0);
      const res = await uploadBatchXHR(parentType, parentId, batch,
        (loaded) => report(Math.min(loaded, batchBytes)));
      if (Array.isArray(res)) saved.push(...res);
      doneFiles += batch.length;
      bytesBefore += batchBytes;
      report(0);
    }
    return { saved, skipped };
  },

  // List a record's documents (with folder_path) so the UI can build a tree.
  docsList: (parentType, parentId) =>
    req(`/documents/${parentType}/${parentId}`),

  deleteDoc: (id) => req('/documents/' + id, { method: 'DELETE' }),

  // document download streams a file; fetch with the token then save locally
  downloadDoc: async (id, name) => {
    const res = await fetch('/api/documents/' + id + '/download', {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error('Download failed.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Download every attachment on a record as one zip (folder structure is
  // recreated inside). Pass `folder` to limit the zip to one folder subtree.
  downloadDocsZip: async (parentType, parentId, filename, folder) => {
    const res = await fetch(
      `/api/documents/${parentType}/${parentId}/zip` + qs(folder ? { folder } : null),
      { headers: { Authorization: `Bearer ${getToken()}` } }
    );
    if (!res.ok) {
      let msg = 'Download failed.';
      try { const j = await res.json(); msg = j.error || msg; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'documents.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Fetch a document (authenticated) and return an in-memory blob: URL so it
  // can be previewed inline (e.g. a PDF in an iframe). Caller must revoke it.
  fetchDocBlobUrl: async (id) => {
    const res = await fetch('/api/documents/' + id + '/download', {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error('Could not load the document.');
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  // Fetch a document (authenticated) as an ArrayBuffer, for client-side
  // parsers that need the raw bytes (Word via docx-preview, Excel via SheetJS).
  fetchDocArrayBuffer: async (id) => {
    const res = await fetch('/api/documents/' + id + '/download', {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error('Could not load the document.');
    return res.arrayBuffer();
  },

  // Fetch a native .dxf drawing and return a blob: URL for dxf-viewer.
  fetchDxfBlobUrl: async (id) => {
    const res = await fetch('/api/documents/' + id + '/dxf', {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      let msg = 'Could not load the drawing.';
      try { const j = await res.json(); msg = j.error || msg; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  // Fetch a .dwg rendered to SVG (server-side via LibreDWG) as text.
  fetchCadSvg: async (id) => {
    const res = await fetch('/api/documents/' + id + '/svg', {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      let msg = 'Could not render the drawing.';
      try { const j = await res.json(); msg = j.error || msg; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    return res.text();
  },
};
