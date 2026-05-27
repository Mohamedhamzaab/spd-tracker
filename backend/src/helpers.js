// ---------------------------------------------------------------------------
//  Shared helpers.
// ---------------------------------------------------------------------------

// Build a short authority code from a name. Uses the bracketed abbreviation
// when present, otherwise the initials of the significant words. Ported from
// the Excel tracker's SuggestCode macro so the two stay consistent.
function suggestCode(name) {
  const nm = (name || '').trim();
  if (!nm) return '';

  const open = nm.indexOf('(');
  const close = nm.indexOf(')');
  if (open > -1 && close > open) {
    const inside = nm.slice(open + 1, close).replace(/[.\s]/g, '');
    if (inside.length >= 2 && inside.length <= 8) return inside.toUpperCase();
  }

  const base = open > -1 ? nm.slice(0, open).trim() : nm;
  const stop = new Set(['of', 'the', 'and', 'for', 'de', 'da', '-', '']);
  let res = base
    .split(/\s+/)
    .filter((w) => !stop.has(w.toLowerCase()))
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

  if (res.length > 6) res = res.slice(0, 6);
  if (!res) res = nm.replace(/\s+/g, '').slice(0, 4).toUpperCase();
  return res;
}

// Pad a running number into a reference, e.g. ref('C', 7, 4) -> 'C-0007'.
function ref(prefix, n, width) {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

// Wrap an async Express handler so thrown errors reach the error middleware.
function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// Raise an error carrying an HTTP status code.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { suggestCode, ref, wrap, httpError };
