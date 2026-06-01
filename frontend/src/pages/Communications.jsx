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
  useTableSort, SortableTH, ConfirmDialog,
} from '../components/ui.jsx';
import { CommDetail, CommForm } from './SubDivisionDetail.jsx';
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

const LINKED_OPTIONS = [
  { value: '',           label: 'All communications' },
  { value: 'replies',    label: 'Replies only (responses)' },
  { value: 'originals',  label: 'Originals only (not a reply)' },
  { value: 'answered',   label: 'Answered (got a reply)' },
  { value: 'unanswered', label: 'Unanswered (awaiting reply)' },
];

const COMM_COLS = {
  comm_code:        { value: (r) => r.comm_code },
  comm_date:        { value: (r) => r.comm_date, type: 'date', defaultDir: 'desc' },
  direction:        { value: (r) => r.direction },
  linked:           { value: (r) => r.in_response_to_code || r.reply_code || '' },
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
  const { isEditor, lists } = useStore();
  const toast = useToast();

  // Filter state
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [statuses, setStatuses] = useState(() => {
    // Seed from a ?status=overdue,awaiting deep-link (e.g. from the dashboard).
    const s = new URLSearchParams(window.location.search).get('status');
    return s ? s.split(',').filter(Boolean) : [];
  }); // multi-select
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [authorityId, setAuthorityId] = useState('');
  const [linked, setLinked] = useState('');
  const [thread, setThread] = useState(''); // a comm_code — shows that whole thread

  // Data state
  const [rows, setRows] = useState(null);
  const [authorities, setAuthorities] = useState([]);
  const [subDivisions, setSubDivisions] = useState([]);
  const [error, setError] = useState('');
  const [openComm, setOpenComm] = useState(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(() => new Set()); // ids ticked for bulk action
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const qDebounced = useDebouncedValue(q, 250);

  // Authority dropdown options — loaded once.
  useEffect(() => {
    api.authorities().then(setAuthorities).catch(() => {});
  }, []);

  // Sub-divisions — loaded once, only needed so editors can log a new
  // communication straight from this page (the picker in the modal).
  useEffect(() => {
    if (!isEditor) return;
    api.subDivisions().then(setSubDivisions).catch(() => {});
  }, [isEditor]);

  // Refetch whenever any committed filter changes.
  const params = useMemo(() => {
    const p = {};
    if (qDebounced) p.q = qDebounced;
    if (direction) p.direction = direction;
    if (statuses.length) p.status = statuses.join(',');
    if (from) p.from = from;
    if (to) p.to = to;
    if (authorityId) p.authority_id = authorityId;
    if (linked) p.linked = linked;
    if (thread) p.in_response_to = thread;
    return p;
  }, [qDebounced, direction, statuses, from, to, authorityId, linked, thread]);

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
    defaultKey: 'comm_code',
    defaultDir: 'asc',
  });

  // Drop any selection when the filter set changes — the visible rows differ,
  // so keeping ticks from a previous result would be confusing.
  useEffect(() => { setSelected(new Set()); }, [params]);

  const visibleIds = (sorted || []).map((r) => r.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleOne(id) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function doBulkDelete() {
    setBulkBusy(true);
    setError('');
    try {
      const ids = [...selected];
      const r = await api.bulkDeleteComms(ids);
      setConfirmBulk(false);
      setSelected(new Set());
      toast(`Deleted ${r.deleted} communication${r.deleted === 1 ? '' : 's'} — codes re-ordered by date.`);
      setRows(null);
      api.communications(params).then(setRows).catch((e) => setError(e.message));
    } catch (e) {
      setConfirmBulk(false); // close so the page-level error banner is visible
      setError(e.message || 'Bulk delete failed.');
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleStatus(key) {
    setStatuses((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
    );
  }

  function clearFilters() {
    setQ(''); setDirection(''); setStatuses([]);
    setFrom(''); setTo(''); setAuthorityId(''); setLinked(''); setThread('');
  }

  const filtersActive = !!(q || direction || statuses.length || from || to || authorityId || linked || thread);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Communications</div>
        </div>
        {isEditor && (
          <button
            className="btn btn-primary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setAdding(true)}
          >
            + Log Communication
          </button>
        )}
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
            setLinked(p.linked || '');
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
          <select
            className="filter-select"
            value={linked}
            onChange={(e) => setLinked(e.target.value)}
            title="Filter by reply linkage"
          >
            {LINKED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
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

        {isEditor && selected.size > 0 && (
          <div className="thread-banner" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span><strong>{selected.size}</strong> selected</span>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => setConfirmBulk(true)}
            >
              Delete selected
            </button>
            <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        {thread && (
          <div className="thread-banner">
            Showing the thread for <span className="mono">{thread}</span> (the original and its replies).
            <button type="button" className="link-btn" onClick={() => setThread('')}>
              Clear
            </button>
          </div>
        )}

        {!rows ? (
          <Loading label="Loading communications" />
        ) : rows.length === 0 ? (
          <Empty title="No communications match these filters" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isEditor && (
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                      />
                    </th>
                  )}
                  <SortableTH id="comm_code"         sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Code</SortableTH>
                  <SortableTH id="comm_date"         sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Date</SortableTH>
                  <SortableTH id="direction"         sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Direction</SortableTH>
                  <SortableTH id="linked"            sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Linked</SortableTH>
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
                    className={'clickable' + (selected.has(c.id) ? ' row-selected' : '')}
                    onClick={() => setOpenComm(c.id)}
                  >
                    {isEditor && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.comm_code}`}
                          checked={selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                        />
                      </td>
                    )}
                    <td className="mono">{c.comm_code}</td>
                    <td>{fmtDate(c.comm_date)}</td>
                    <td>
                      <DirectionPill direction={c.direction} />
                    </td>
                    <td>
                      {!c.in_response_to_code && !c.reply_code && !c.related_to_code ? (
                        <span className="cell-sub">—</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          {c.in_response_to_code && (
                            <button
                              type="button"
                              className="link-chip"
                              title={`Reply to ${c.in_response_to_code} — click to see the thread`}
                              onClick={(e) => { e.stopPropagation(); setThread(c.in_response_to_code); }}
                            >
                              ↩ {c.in_response_to_code}
                            </button>
                          )}
                          {c.reply_code && (
                            <button
                              type="button"
                              className="link-chip link-chip-fwd"
                              title={`Answered by ${c.reply_code} — click to see the thread`}
                              onClick={(e) => { e.stopPropagation(); setThread(c.comm_code); }}
                            >
                              → {c.reply_code}
                            </button>
                          )}
                          {c.related_to_code && (
                            <button
                              type="button"
                              className="link-chip"
                              title={`Related to ${c.related_to_code} — click to find it`}
                              onClick={(e) => { e.stopPropagation(); setQ(c.related_to_code); }}
                            >
                              ≈ {c.related_to_code}
                            </button>
                          )}
                        </div>
                      )}
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

      {adding && (
        <CommForm
          lists={lists}
          subDivisions={subDivisions}
          onClose={() => setAdding(false)}
          onSaved={(code) => {
            setAdding(false);
            toast(`Logged ${code}.`);
            setRows(null);
            api.communications(params).then(setRows).catch((e) => setError(e.message));
          }}
        />
      )}

      {confirmBulk && (
        <ConfirmDialog
          title="Delete selected communications"
          message={`Move ${selected.size} communication${selected.size === 1 ? '' : 's'} to Trash? Remaining codes re-order by date automatically. You can restore from Trash later.`}
          confirmLabel={bulkBusy ? 'Deleting…' : `Delete ${selected.size}`}
          onConfirm={doBulkDelete}
          onClose={() => setConfirmBulk(false)}
        />
      )}
    </>
  );
}
