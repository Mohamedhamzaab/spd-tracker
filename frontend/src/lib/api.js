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
  updateComm: (id, b) => req('/communications/' + id, { method: 'PUT', body: b }),
  deleteComm: (id) => req('/communications/' + id, { method: 'DELETE' }),

  // meetings
  meetings: (params) => req('/meetings' + qs(params)),
  meeting: (id) => req('/meetings/' + id),
  createMeeting: (b) => req('/meetings', { method: 'POST', body: b }),
  updateMeeting: (id, b) => req('/meetings/' + id, { method: 'PUT', body: b }),
  deleteMeeting: (id) => req('/meetings/' + id, { method: 'DELETE' }),

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
