// ---------------------------------------------------------------------------
//  Live stream — a singleton EventSource on /api/stream that fans out to
//  subscribers via a tiny pub/sub. List pages call useLive(eventTypes, cb)
//  and silently refresh when an upstream event matches.
//
//  Reconnects automatically on drop (the browser does this for SSE, but we
//  also re-create the EventSource if the token rotated).
// ---------------------------------------------------------------------------
import { useEffect, useRef } from 'react';
import { getToken } from './api.js';

let source = null;
let lastToken = null;
const listeners = new Set();

function ensureSource() {
  const tok = getToken();
  if (!tok) {
    closeSource();
    return null;
  }
  if (source && lastToken === tok && source.readyState !== 2 /* CLOSED */) {
    return source;
  }
  closeSource();
  try {
    source = new EventSource('/api/stream?token=' + encodeURIComponent(tok));
    lastToken = tok;
    source.addEventListener('hello', () => {
      // could log connection success here
    });
    // Any "data.*" / "user.*" event lands here.
    source.onmessage = () => {}; // unused — we listen to named events below
    // Subscribe to named events via a single handler that fans out.
    // The backend emits each event with its kind as the event name.
    const named = (e) => {
      let payload = null;
      try { payload = JSON.parse(e.data); } catch { /* */ }
      const evt = { type: e.type, payload };
      listeners.forEach((fn) => {
        try { fn(evt); } catch { /* swallow per-listener */ }
      });
    };
    // We don't know event names ahead of time — attach a small known set + a
    // wildcard via "message". The backend writes `event: <kind>` per emission,
    // so we add common event kinds explicitly.
    const KINDS = [
      'data.authority.created', 'data.authority.updated', 'data.authority.deleted',
      'data.authority.restored', 'data.authority.purged',
      'data.subdivision.created', 'data.subdivision.updated', 'data.subdivision.deleted',
      'data.subdivision.restored', 'data.subdivision.purged',
      'data.communication.created', 'data.communication.updated', 'data.communication.deleted',
      'data.communication.restored', 'data.communication.purged',
      'data.meeting.created', 'data.meeting.updated', 'data.meeting.deleted',
      'data.meeting.restored', 'data.meeting.purged',
      'data.qdrs.created', 'data.qdrs.updated', 'data.qdrs.deleted',
      'data.qdrs.restored', 'data.qdrs.purged',
      'data.document.uploaded', 'data.document.deleted',
      'data.comment.created', 'data.comment.updated', 'data.comment.deleted',
      'data.task.created', 'data.task.updated', 'data.task.completed', 'data.task.deleted',
      'user.created', 'user.role_changed', 'user.disabled', 'user.enabled',
      'user.deleted', 'user.force_reset',
      'mfa.cleared',
    ];
    KINDS.forEach((k) => source.addEventListener(k, named));
    source.onerror = () => {
      // The browser auto-reconnects; nothing else to do unless we want
      // exponential backoff.
    };
  } catch (err) {
    console.warn('[live] EventSource init failed:', err.message);
    source = null;
  }
  return source;
}

function closeSource() {
  if (source) {
    try { source.close(); } catch { /* */ }
    source = null;
  }
}

export function subscribe(handler) {
  listeners.add(handler);
  ensureSource();
  return () => {
    listeners.delete(handler);
    if (listeners.size === 0) closeSource();
  };
}

// Hook: trigger `callback()` when ANY of the named event kinds fires.
// `kinds` is an array of literal event names (e.g. ['data.communication.created']).
// `callback` is debounced internally so a flurry of related events triggers
// one refresh.
export function useLive(kinds, callback, debounceMs = 300) {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const wanted = new Set(kinds || []);

  useEffect(() => {
    let timer = null;
    const off = subscribe((evt) => {
      if (!wanted.has(evt.type)) return;
      clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), debounceMs);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kinds.join(','), debounceMs]);
}
