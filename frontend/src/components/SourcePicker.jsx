// ---------------------------------------------------------------------------
//  SourcePicker — where an action, or a piece of progress on it, came from.
//
//  The whole point of the register is that work traces back to something that
//  was actually logged, so the meeting / communication / QDRS options search
//  the real records and you pick one; there is no free-text path to them.
//
//  "Outside the system" exists for the real case — the client relays what an
//  authority told them, and the evidence is a document we hold elsewhere — but
//  it demands a reference and marks the entry so it stands out until the real
//  record is attached.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const KINDS = [
  { key: 'meeting', label: 'Meeting' },
  { key: 'communication', label: 'Communication' },
  { key: 'qdrs', label: 'QDRS' },
  { key: 'external', label: 'Outside the system' },
];

export default function SourcePicker({ value, onChange, disabled }) {
  const { source_type: type, source_id: id, source_ref_external: ref } = value;
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null);

  // Search the register as the user types, debounced.
  useEffect(() => {
    if (!type || type === 'external') { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      setBusy(true);
      api.engSources({ type, q, limit: 15 })
        .then((r) => { if (!cancelled) setResults(r); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [type, q]);

  // Clicking the chosen kind again clears it — otherwise a mis-click traps you
  // on a progress entry, where naming a source is optional.
  function choose(kind) {
    setPicked(null);
    setQ('');
    const next = type === kind ? '' : kind;
    onChange({ source_type: next, source_id: null, source_ref_external: '' });
  }

  return (
    <div className="src-picker">
      <div className="src-kinds">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            disabled={disabled}
            className={'chip ' + (type === k.key ? 'chip-on' : '')}
            onClick={() => choose(k.key)}
            title={type === k.key ? 'Click again to clear' : undefined}
          >
            {k.label}
          </button>
        ))}
      </div>

      {type && type !== 'external' && (
        <div className="src-search">
          {picked ? (
            <div className="src-picked">
              <span className="mono">{picked.code}</span>
              <span className="cell-sub">{picked.on_date}{picked.detail ? ' · ' + picked.detail : ''}</span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={disabled}
                onClick={() => { setPicked(null); onChange({ ...value, source_id: null }); }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                className="input"
                placeholder="Search by code, reference or authority"
                value={q}
                disabled={disabled}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="src-results">
                {busy && <div className="cell-sub" style={{ padding: 8 }}>Searching…</div>}
                {!busy && results.length === 0 && (
                  <div className="cell-sub" style={{ padding: 8 }}>
                    No matching record. If it isn’t logged here yet, log it first —
                    or record this as outside the system.
                  </div>
                )}
                {results.map((r) => (
                  <button
                    key={r.type + r.id}
                    type="button"
                    className="src-result"
                    disabled={disabled}
                    onClick={() => { setPicked(r); onChange({ ...value, source_id: r.id }); }}
                  >
                    <span className="mono">{r.code}</span>
                    <span className="cell-sub">
                      {r.on_date}{r.authority_code ? ' · ' + r.authority_code : ''}
                      {r.detail ? ' · ' + String(r.detail).slice(0, 44) : ''}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {type === 'external' && (
        <div className="src-external">
          <label className="field-label">Reference</label>
          <input
            className="input"
            placeholder="e.g. Client MoM 14-Aug-26, or a letter number"
            value={ref || ''}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, source_ref_external: e.target.value })}
          />
          <div className="field-help">
            This will be flagged in the register until the record itself is logged
            here and linked.
          </div>
        </div>
      )}
    </div>
  );
}
