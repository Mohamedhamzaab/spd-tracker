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

// The next record code for a table, e.g. nextCode(client, 'communications',
// 'comm_code', 'C', 4) -> 'C-0042'. A code is given once and never changes:
// letters, minutes and the weekly file quote it. Trashed rows keep theirs, so
// they count. Call inside the caller's transaction; the lock makes two saves at
// once take numbers in turn instead of clashing. table/column are constants.
// shortcut: a record purged from Trash frees its number if it was the newest;
// switch to a sequence if purged codes must never come back.
async function nextCode(client, table, column, prefix, width) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [table]);
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CAST(substring(${column} from 3) AS INTEGER)), 0) + 1 AS next
       FROM ${table}`
  );
  return ref(prefix, rows[0].next, width);
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

// Who carried a communication or held a meeting. Must match the CHECK in schema.sql.
const ORIGINATORS = ['ECG', 'SPD', 'EGIS'];

module.exports = { suggestCode, ref, nextCode, wrap, httpError, ORIGINATORS };
