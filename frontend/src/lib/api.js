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
  mfaVerify: (challenge_token, code, is_backup = false) =>
    req('/auth/mfa/verify', {
      method: 'POST',
      body: { challenge_token, code, is_backup },
    }),
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

  // users (super_admin)
  users: () => req('/users'),
  createUser: (b) => req('/users', { method: 'POST', body: b }),
  updateUser: (id, b) => req('/users/' + id, { method: 'PATCH', body: b }),
  resendInvite: (id) => req('/users/' + id + '/resend-invite', { method: 'POST' }),
  forceResetUser: (id) => req('/users/' + id + '/force-reset', { method: 'POST' }),
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
  uploadDocs: (parentType, parentId, files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return req(`/documents/${parentType}/${parentId}`, { method: 'POST', body: fd });
  },
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
};
