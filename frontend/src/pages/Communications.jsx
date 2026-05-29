// ---------------------------------------------------------------------------
//  Communications. The full log. Server-side full-text search + filter
//  composition (direction, multi-status, date range, authority). Sorting and
//  row-click into the communication detail stay client-side.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Loading, Empty, ErrorBanner, DirectionPill, Pill, fmtDate, useToast,
  useTableSort, SortableTH,
} from '../components/ui.jsx';
import { CommDetail } from './SubDivisionDetail.jsx';
import ViewsBar from '../components/ViewsBar.jsx';
import { useLive } from '../lib/liveStream.js';

const COMM_LIVE_EVENTS = [
  'data.communication.created',
  'data.communication.updated',
  'data.communication.deleted',
];

const STATUS_CHIPS = [
  { key: 'overdue',  label: 'Overdue',  tone: 'red' },
  { key: 'awaiting', label: 'Awaiting', tone: 'amber' },
  { key: 'replied',  label: 'Replied',  tone: 'green' },
  { key: 'logged',   label: 'Logged',   tone: 'grey' },
];

function commStatusRank(c) {
  if (c.is_overdue) return 0;
  if (c.direction === 'Outbound' && c.reply_needed && !c.reply_received) return 1;
  if (c.direction === 'Outbound' && c.reply_received) return 2;
  return 3;
}

const COMM_COLS = {
  comm_code:        { value: (r) => r.comm_code },
  comm_date:        { value: (r) => r.comm_date, type: 'date', defaultDir: 'desc' },
  direction:        { value: (r) => r.direction },
  sub_division_name:{ value: (r) => r.sub_division_name },
  purpose:          { value: (r) => r.purpose || '' },
  summary:          { value: (r) => r.summary || '' },
  status:           { value: (r) => commStatusRank(r), type: 'number' },
};

function useDebouncedValue(value, ms) {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer.current);
  }, [value, ms]);
  return debounced;
}

export default function Communications() {
  const { isEditor } = useStore();
  useToast();

  // Filter state
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [statuses, setStatuses] = useState([]); // multi-select
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [authorityId, setAuthorityId] = useState('');

  // Data state
  const [rows, setRows] = useState(null);
  const [authorities, setAuthorities] = useState([]);
  const [error, setError] = useState('');
  const [openComm, setOpenComm] = useState(null);

  const qDebounced = useDebouncedValue(q, 250);

  // Authority dropdown options — loaded once.
  useEffect(() => {
    api.authorities().then(setAuthorities).catch(() => {});
  }, []);

  // Refetch whenever any committed filter changes.
  const params = useMemo(() => {
    const p = {};
    if (qDebounced) p.q = qDebounced;
    if (direction) p.direction = direction;
    if (statuses.length) p.status = statuses.join(',');
    if (from) p.from = from;
    if (to) p.to = to;
    if (authorityId) p.authority_id = authorityId;
    return p;
  }, [qDebounced, direction, statuses, from, to, authorityId]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    api.communications(params)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Search failed.'); });
    return () => { cancelled = true; };
  }, [params]);

  // Live refresh — when someone else creates / updates / deletes a comm
  // upstream, refetch silently so reviewers don't have to hit reload.
  useLive(COMM_LIVE_EVENTS, () => {
    api.communications(params).then(setRows).catch(() => {});
  });

  const { sorted, sortKey, sortDir, onSort } = useTableSort(rows || [], COMM_COLS, {
    defaultKey: 'comm_date',
    defaultDir: 'desc',
  });

  function toggleStatus(key) {
    setStatuses((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
    );
  }

  function clearFilters() {
    setQ(''); setDirection(''); setStatuses([]);
    setFrom(''); setTo(''); setAuthorityId('');
  }

  const filtersActive = !!(q || direction || statuses.length || from || to || authorityId);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Communications</div>
        </div>
      </div>
      <div className="page">
        <ErrorBanner message={error} />
        <div className="section-note" style={{ marginBottom: 16 }}>
          Full-text search runs against the database — try a phrase, a code
          (e.g. C-0012), or a sub-division name. Combine with filters below.
        </div>

        <ViewsBar
          target="communications"
          currentParams={params}
          onApply={(p) => {
            setQ(p.q || '');
            setDirection(p.direction || '');
            setStatuses(p.status ? String(p.status).split(',') : []);
            setFrom(p.from || '');
            setTo(p.to || '');
            setAuthorityId(p.authority_id ? String(p.authority_id) : '');
          }}
        />

        <div className="filter-bar">
          <input
            className="search"
            placeholder='Search — try "overdue water" or "C-0008"'
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="filter-select"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="">All directions</option>
            <option value="Outbound">Outbound</option>
            <option value="Inbound">Inbound</option>
          </select>
          <select
            className="filter-select"
            value={authorityId}
            onChange={(e) => setAuthorityId(e.target.value)}
          >
            <option value="">All authorities</option>
            {authorities.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </select>
          <div className="filter-date-pair">
            <input
              className="filter-select"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From date"
            />
            <span className="filter-date-sep">→</span>
            <input
              className="filter-select"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To date"
            />
          </div>
        </div>

        <div className="filter-bar" style={{ marginTop: 10 }}>
          <span className="section-note" style={{ marginRight: 4 }}>Status:</span>
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={'chip chip-' + c.tone + (statuses.includes(c.key) ? ' chip-on' : '')}
              onClick={() => toggleStatus(c.key)}
            >
              {c.label}
            </button>
          ))}
          {filtersActive && (
            <button className="btn btn-ghost" onClick={clearFilters} style={{ marginLeft: 'auto' }}>
              Clear filters
            </button>
          )}
          <span className="section-note">
            {rows ? rows.length : '…'} {rows && rows.length === 1 ? 'result' : 'results'}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => api.downloadExport('/exports/communications.xlsx', 'communications.xlsx')}
            title="Download all communications as .xlsx"
          >
            Export
          </button>
        </div>

        {!rows ? (
          <Loading label="Loading communications" />
        ) : rows.length === 0 ? (
          <Empty title="No communications match these filters" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortableTH id="comm_code"         sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Code</SortableTH>
                  <SortableTH id="comm_date"         sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Date</SortableTH>
                  <SortableTH id="direction"         sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Direction</SortableTH>
                  <SortableTH id="sub_division_name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Sub-Division</SortableTH>
                  <SortableTH id="purpose"           sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Purpose</SortableTH>
                  <SortableTH id="summary"           sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Summary</SortableTH>
                  <SortableTH id="status"            sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Status</SortableTH>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr
                    key={c.id}
                    className="clickable"
                    onClick={() => setOpenComm(c.id)}
                  >
                    <td className="mono">{c.comm_code}</td>
                    <td>{fmtDate(c.comm_date)}</td>
                    <td>
                      <DirectionPill direction={c.direction} />
                    </td>
                    <td>
                      <div className="cell-strong">{c.sub_division_name}</div>
                      <div className="cell-sub">{c.authority_code}</div>
                    </td>
                    <td>{c.purpose || '-'}</td>
                    <td style={{ maxWidth: 320 }}>
                      <div
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.summary || '-'}
                      </div>
                    </td>
                    <td>
                      {c.is_overdue ? (
                        <Pill tone="red">Overdue</Pill>
                      ) : c.direction === 'Outbound' && c.reply_received ? (
                        <Pill tone="green">Replied</Pill>
                      ) : c.direction === 'Outbound' && c.reply_needed ? (
                        <Pill tone="amber">Awaiting</Pill>
                      ) : (
                        <Pill tone="grey">Logged</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openComm && (
        <CommDetail
          commId={openComm}
          isEditor={isEditor}
          onClose={() => setOpenComm(null)}
          onChanged={() => {
            // Re-trigger the fetch by updating a sibling.
            setRows(null);
            api.communications(params).then(setRows).catch((e) => setError(e.message));
          }}
        />
      )}
    </>
  );
}
