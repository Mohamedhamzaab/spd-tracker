// ---------------------------------------------------------------------------
//  Meetings. The register with an add form whose Primary Sub-Division list
//  is filtered to the chosen authority's sub-divisions only.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Loading, Empty, ErrorBanner, Modal, FormFields, ConfirmDialog, Pill,
  fmtDate, fileSize, useToast, useTableSort, SortableTH,
} from '../components/ui.jsx';
import ViewsBar from '../components/ViewsBar.jsx';
import TasksPanel from '../components/TasksPanel.jsx';
import { useLive } from '../lib/liveStream.js';

const MEETING_LIVE_EVENTS = [
  'data.meeting.created', 'data.meeting.updated', 'data.meeting.deleted',
];

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

const MEETING_COLS = {
  meeting_code:   { value: (r) => r.meeting_code },
  meeting_date:   { value: (r) => r.meeting_date, type: 'date', defaultDir: 'desc' },
  authority_name: { value: (r) => r.authority_name || '' },
  primary_sub:    { value: (r) => r.primary_sub_reference || r.primary_sub_name || '' },
  purpose:        { value: (r) => r.purpose || '' },
  mode:           { value: (r) => r.mode || '' },
  mom_reference:  { value: (r) => r.mom_reference || '' },
};

export default function Meetings() {
  const { lists, isEditor } = useStore();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [authorities, setAuthorities] = useState([]);
  const [error, setError] = useState('');

  // Filters
  const [q, setQ] = useState('');
  const [authorityId, setAuthorityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // MoM-status filter — seeded from a ?mom=pending|draft|final deep-link.
  const [momFilter, setMomFilter] = useState(() => {
    const m = new URLSearchParams(window.location.search).get('mom');
    return ['pending', 'draft', 'final'].includes(m) ? m : '';
  });

  const [adding, setAdding] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [delRow, setDelRow] = useState(null);
  const [openRow, setOpenRow] = useState(null); // read-only detail (any user)
  const [selected, setSelected] = useState(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const qDebounced = useDebouncedValue(q, 250);
  useEffect(() => { api.authorities().then(setAuthorities).catch(() => {}); }, []);

  const params = useMemo(() => {
    const p = {};
    if (qDebounced) p.q = qDebounced;
    if (authorityId) p.authority_id = authorityId;
    if (from) p.from = from;
    if (to) p.to = to;
    if (momFilter) p.mom_status = momFilter;
    return p;
  }, [qDebounced, authorityId, from, to, momFilter]);

  function load(p) {
    api.meetings(p).then(setRows).catch((e) => setError(e.message));
  }
  useEffect(() => { setError(''); load(params); }, [params]);
  useLive(MEETING_LIVE_EVENTS, () => load(params));

  // Deep-link: dashboard "recent meetings" rows arrive as ?open=<id>. Once the
  // list has loaded, pop that meeting's read-only detail (once).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || !rows) return;
    const o = new URLSearchParams(window.location.search).get('open');
    if (!o || !/^\d+$/.test(o)) return;
    const row = rows.find((m) => m.id === Number(o));
    if (row) { setOpenRow(row); autoOpenedRef.current = true; }
  }, [rows]);

  function clearFilters() {
    setQ(''); setAuthorityId(''); setFrom(''); setTo(''); setMomFilter('');
  }
  const filtersActive = !!(q || authorityId || from || to || momFilter);

  const { sorted, sortKey, sortDir, onSort } = useTableSort(rows || [], MEETING_COLS, {
    defaultKey: 'meeting_date',
    defaultDir: 'asc',
  });

  // Clear ticked rows when the filter set changes.
  useEffect(() => { setSelected(new Set()); }, [params]);

  const visibleIds = (sorted || []).map((m) => m.id);
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
      const r = await api.bulkDeleteMeetings([...selected]);
      setConfirmBulk(false);
      setSelected(new Set());
      toast(`Deleted ${r.deleted} meeting${r.deleted === 1 ? '' : 's'} — codes re-ordered by date.`);
      load(params);
    } catch (e) {
      setConfirmBulk(false);
      setError(e.message || 'Bulk delete failed.');
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Meetings</div>
        </div>
        {isEditor && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add Meeting
          </button>
        )}
      </div>
      <div className="page">
        <ErrorBanner message={error} />
        <div className="section-note" style={{ marginBottom: 16 }}>
          Attendees, outcomes and actions live in the Minutes of Meeting. The
          tracker records the meeting and links to the MoM.
        </div>

        <ViewsBar
          target="meetings"
          currentParams={params}
          onApply={(p) => {
            setQ(p.q || '');
            setAuthorityId(p.authority_id ? String(p.authority_id) : '');
            setFrom(p.from || '');
            setTo(p.to || '');
          }}
        />

        <div className="filter-bar">
          <input
            className="search"
            placeholder='Search — try "kick-off" or "MoM-26-01"'
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
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
            <input className="filter-select" type="date" value={from}
              onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span className="filter-date-sep">→</span>
            <input className="filter-select" type="date" value={to}
              onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
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
            onClick={() => api.downloadExport('/exports/meetings.xlsx', 'meetings.xlsx')}
            title="Download all meetings as .xlsx"
          >
            Export
          </button>
        </div>

        {isEditor && selected.size > 0 && (
          <div className="thread-banner" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span><strong>{selected.size}</strong> selected</span>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmBulk(true)}>
              Delete selected
            </button>
            <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        {momFilter && (
          <div className="thread-banner">
            Showing meetings with MoM <strong>{{ pending: 'pending', draft: 'in draft', final: 'finalised' }[momFilter]}</strong>.
            <button type="button" className="link-btn" onClick={() => setMomFilter('')}>Clear</button>
          </div>
        )}

        {!rows ? (
          <Loading label="Loading meetings" />
        ) : rows.length === 0 ? (
          <Empty
            title="No meetings logged"
            sub={isEditor ? 'Add the first one above.' : undefined}
          />
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
                  <SortableTH id="meeting_code"   sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Code</SortableTH>
                  <SortableTH id="meeting_date"   sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Date</SortableTH>
                  <SortableTH id="authority_name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Authority</SortableTH>
                  <SortableTH id="primary_sub"    sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Primary Sub-Division</SortableTH>
                  <SortableTH id="purpose"        sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Purpose</SortableTH>
                  <SortableTH id="mode"           sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Mode</SortableTH>
                  <th>Attendees</th>
                  <SortableTH id="mom_reference"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>MoM</SortableTH>
                  {isEditor && <th></th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr
                    key={m.id}
                    className={'clickable' + (selected.has(m.id) ? ' row-selected' : '')}
                    onClick={() => setOpenRow(m)}
                  >
                    {isEditor && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${m.meeting_code}`}
                          checked={selected.has(m.id)}
                          onChange={() => toggleOne(m.id)}
                        />
                      </td>
                    )}
                    <td className="mono cell-strong">{m.meeting_code}</td>
                    <td>
                      {fmtDate(m.meeting_date)}
                      {m.meeting_time && (
                        <span className="cell-sub"> · {String(m.meeting_time).slice(0, 5)}</span>
                      )}
                    </td>
                    <td>
                      <div className="cell-strong">{m.authority_name}</div>
                    </td>
                    <td>
                      {m.primary_sub_reference ? (
                        <>
                          <div className="cell-strong">{m.primary_sub_name}</div>
                          <div className="cell-sub">{m.primary_sub_reference}</div>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{m.purpose ? <Pill tone="grey">{m.purpose}</Pill> : '-'}</td>
                    <td>{m.mode || '-'}</td>
                    <td>{m.attendees ? <span className="cell-strong">{m.attendees}</span> : <span className="cell-sub">—</span>}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <MomDot status={m.mom_status} />
                        {m.mom_link ? (
                          <a href={m.mom_link} target="_blank" rel="noreferrer">
                            {m.mom_reference || 'Open MoM'}
                          </a>
                        ) : (
                          <span>{m.mom_reference || '—'}</span>
                        )}
                      </div>
                    </td>
                    {isEditor && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setEditRow(m)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setDelRow(m)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && (
        <MeetingForm
          lists={lists}
          authorities={authorities}
          onClose={() => setAdding(false)}
          onSaved={(code) => {
            setAdding(false);
            toast('Meeting added: ' + code);
            load(params);
          }}
        />
      )}
      {editRow && (
        <MeetingForm
          lists={lists}
          authorities={authorities}
          existing={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => {
            setEditRow(null);
            toast('Meeting updated');
            load(params);
          }}
        />
      )}
      {openRow && (
        <MeetingDetail
          meeting={openRow}
          isEditor={isEditor}
          onClose={() => setOpenRow(null)}
          onEdit={() => { setEditRow(openRow); setOpenRow(null); }}
        />
      )}

      {delRow && (
        <ConfirmDialog
          title="Delete meeting"
          message={`Move meeting ${delRow.meeting_code} to Trash? Remaining codes re-order by date automatically. You can restore it from Trash later.`}
          onClose={() => setDelRow(null)}
          onConfirm={async () => {
            try {
              await api.deleteMeeting(delRow.id);
              setDelRow(null);
              toast('Meeting moved to Trash — codes re-ordered by date.');
              load(params);
            } catch (e) {
              setDelRow(null);
              setError(e.message || 'Delete failed.');
            }
          }}
        />
      )}

      {confirmBulk && (
        <ConfirmDialog
          title="Delete selected meetings"
          message={`Move ${selected.size} meeting${selected.size === 1 ? '' : 's'} to Trash? Remaining codes re-order by date automatically. You can restore from Trash later.`}
          confirmLabel={bulkBusy ? 'Deleting…' : `Delete ${selected.size}`}
          onConfirm={doBulkDelete}
          onClose={() => setConfirmBulk(false)}
        />
      )}
    </>
  );
}

// Red / amber / green indicator for the Minutes-of-Meeting status.
const MOM_DOT = {
  pending: { color: '#dc2626', label: 'MoM pending — minutes not ready yet' },
  draft:   { color: '#d97706', label: 'Draft MoM received' },
  final:   { color: '#16a34a', label: 'Final MoM received' },
};
function MomDot({ status }) {
  const d = MOM_DOT[status] || MOM_DOT.pending;
  return (
    <span
      title={d.label}
      aria-label={d.label}
      style={{
        display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
        background: d.color, flexShrink: 0,
      }}
    />
  );
}

const MOM_LABEL = { pending: 'Pending — minutes not ready', draft: 'Draft received', final: 'Final received' };

function MItem({ label, value }) {
  return <div className="detail-item"><div className="dl">{label}</div><div className="dv">{value}</div></div>;
}
function MRow({ label, value }) {
  return <div className="detail-item" style={{ marginTop: 12 }}><div className="dl">{label}</div><div className="dv">{value}</div></div>;
}

// Read-only meeting view — opens for ANY signed-in user (editors + reviewers).
// Editors get an Edit button; reviewers can view + download documents only.
function MeetingDetail({ meeting, isEditor, onClose, onEdit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.meeting(meeting.id).then(setData).catch((e) => setError(e.message));
  }, [meeting.id]);

  return (
    <Modal
      wide
      title={data ? data.meeting_code : meeting.meeting_code}
      sub={data ? data.authority_name : ''}
      onClose={onClose}
      footer={
        <>
          {isEditor && <button className="btn" onClick={onEdit}>Edit</button>}
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </>
      }
    >
      <ErrorBanner message={error} />
      {!data ? (
        <Loading label="Loading" />
      ) : (
        <>
          <div className="detail-grid">
            <MItem label="Authority" value={data.authority_name} />
            <MItem label="Primary Sub-Division"
              value={data.primary_sub_reference
                ? `${data.primary_sub_name} (${data.primary_sub_reference})` : '—'} />
            <MItem label="Date"
              value={fmtDate(data.meeting_date) + (data.meeting_time ? ' · ' + String(data.meeting_time).slice(0, 5) : '')} />
            <MItem label="Purpose" value={data.purpose || '—'} />
            <MItem label="Mode" value={data.mode || '—'} />
            <MItem label="MoM Status"
              value={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <MomDot status={data.mom_status} /> {MOM_LABEL[data.mom_status] || 'Pending'}
              </span>} />
          </div>
          {data.attendees && <MRow label="Attendees" value={data.attendees} />}
          {data.other_sub_divisions && <MRow label="Other Sub-Divisions Covered" value={data.other_sub_divisions} />}
          {data.location && <MRow label="Location" value={data.location} />}
          {data.mom_reference && <MRow label="MoM Reference" value={data.mom_reference} />}
          {data.mom_link && (
            <MRow label="MoM Link" value={<a href={data.mom_link} target="_blank" rel="noreferrer">Open MoM</a>} />
          )}

          <div style={{ marginTop: 22 }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Documents</div>
            <MeetingDocs meetingId={meeting.id} />
          </div>
          <div style={{ marginTop: 22 }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Tasks</div>
            <TasksPanel parentType="meeting" parentId={meeting.id} />
          </div>
        </>
      )}
    </Modal>
  );
}

function MeetingForm({ lists, authorities, existing, onClose, onSaved }) {
  const editing = !!existing;
  const [values, setValues] = useState(
    editing
      ? {
          authority_id: String(existing.authority_id),
          primary_sub_id: existing.primary_sub_id
            ? String(existing.primary_sub_id)
            : '',
          other_sub_divisions: existing.other_sub_divisions || '',
          attendees: existing.attendees || '',
          meeting_date: (existing.meeting_date || '').slice(0, 10),
          meeting_time: (existing.meeting_time || '').slice(0, 5),
          purpose: existing.purpose || '',
          mode: existing.mode || '',
          location: existing.location || '',
          mom_status: existing.mom_status || 'pending',
          mom_reference: existing.mom_reference || '',
          mom_link: existing.mom_link || '',
        }
      : {
          authority_id: '', primary_sub_id: '', other_sub_divisions: '',
          attendees: '',
          meeting_date: new Date().toISOString().slice(0, 10),
          meeting_time: '',
          purpose: '', mode: '', location: '',
          mom_status: 'pending', mom_reference: '', mom_link: '',
        }
  );
  const [subOptions, setSubOptions] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Create mode: files chosen before the meeting exists are held here and
  // uploaded right after the meeting is created. If the upload step fails we
  // keep the created id so re-trying never makes a duplicate meeting.
  const [pendingFiles, setPendingFiles] = useState([]);
  const [createdId, setCreatedId] = useState(null);
  const [createdCode, setCreatedCode] = useState(null);
  const pendingRef = useRef(null);

  // Dependent dropdown: load this authority's sub-divisions when it changes.
  useEffect(() => {
    if (!values.authority_id) {
      setSubOptions([]);
      return;
    }
    api
      .subDivisions({ authority_id: values.authority_id })
      .then((subs) =>
        setSubOptions(
          subs.map((s) => ({
            value: String(s.id),
            label: `${s.sub_reference} - ${s.name}`,
          }))
        )
      )
      .catch(() => setSubOptions([]));
  }, [values.authority_id]);

  function onChange(name, value) {
    setValues((v) => {
      const next = { ...v, [name]: value };
      // Changing the authority clears a sub-division that no longer belongs.
      if (name === 'authority_id') next.primary_sub_id = '';
      return next;
    });
  }

  const fields = [
    { name: 'authority_id', label: 'Authority', type: 'select', required: true,
      span: 2,
      options: authorities.map((a) => ({
        value: String(a.id),
        label: `${a.code} - ${a.name}`,
      })) },
    { name: 'primary_sub_id', label: 'Primary Sub-Division', type: 'select',
      span: 2, options: subOptions,
      placeholder: values.authority_id
        ? 'Select a sub-division'
        : 'Choose an authority first',
      disabled: !values.authority_id,
      help: "The list shows only the chosen authority's sub-divisions." },
    { name: 'other_sub_divisions', label: 'Other Sub-Divisions Covered', span: 2,
      placeholder: 'Free text, e.g. KM-S02, PWA-S01' },
    { name: 'attendees', label: 'Attendees', span: 2,
      placeholder: 'e.g. ECG, Egis, SPD, KM',
      help: 'Company names only, comma-separated — no individual staff names.' },
    { name: 'meeting_date', label: 'Date', type: 'date', required: true },
    { name: 'meeting_time', label: 'Time', type: 'time' },
    { name: 'purpose', label: 'Purpose', type: 'select',
      options: lists.meeting_purpose },
    { name: 'mode', label: 'Mode', type: 'select', options: lists.meeting_mode },
    { name: 'location', label: 'Location' },
    { name: 'mom_status', label: 'MoM Status', type: 'select',
      options: [
        { value: 'pending', label: 'Pending — minutes not ready' },
        { value: 'draft', label: 'Draft received' },
        { value: 'final', label: 'Final received' },
      ],
      help: 'Drives the red / amber / green dot in the meetings list.' },
    { name: 'mom_reference', label: 'MoM Reference', span: 2 },
    { name: 'mom_link', label: 'MoM Link (ACC)', span: 2,
      placeholder: 'Link to the Minutes of Meeting in ACC' },
  ];

  async function save() {
    setError('');
    if (!values.authority_id) return setError('An authority is required.');
    if (!values.meeting_date) return setError('A date is required.');
    setBusy(true);
    try {
      const payload = {
        ...values,
        authority_id: Number(values.authority_id),
        primary_sub_id: values.primary_sub_id
          ? Number(values.primary_sub_id)
          : null,
      };
      if (editing) {
        await api.updateMeeting(existing.id, payload);
        onSaved(existing.meeting_code);
        return;
      }

      // Create once. If a previous attempt already created the meeting (but
      // the file upload failed), reuse it instead of creating a duplicate.
      let meetingId = createdId;
      let meetingCode = createdCode;
      if (!meetingId) {
        const created = await api.createMeeting(payload);
        meetingId = created.id;
        meetingCode = created.meeting_code;
        setCreatedId(meetingId);
        setCreatedCode(meetingCode);
      }

      if (pendingFiles.length) {
        // A failure here throws to the catch; the meeting still exists, so the
        // user can click again to retry just the upload (no duplicate).
        await api.uploadDocs('meeting', meetingId, pendingFiles);
      }
      onSaved(meetingCode);
    } catch (e) {
      setError(
        createdId
          ? 'Meeting saved, but the documents failed to upload. Click "Add meeting" again to retry, or attach them later by editing the meeting. (' + e.message + ')'
          : e.message
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={editing ? 'Edit Meeting' : 'Add Meeting'}
      sub={editing ? existing.meeting_code : 'A new entry in the meetings register'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Add meeting'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <FormFields fields={fields} values={values} onChange={onChange} disabled={busy} />
      {editing ? (
        <>
          <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Documents</div>
            <MeetingDocs meetingId={existing.id} />
          </div>
          <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Tasks</div>
            <TasksPanel parentType="meeting" parentId={existing.id} />
          </div>
        </>
      ) : (
        <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <div className="section-title" style={{ marginBottom: 10 }}>Documents</div>
          {pendingFiles.length === 0 && (
            <div className="section-note" style={{ marginBottom: 10 }}>
              Attach presentations or shared files now — they upload when you click “Add meeting”.
            </div>
          )}
          {pendingFiles.map((f, i) => (
            <div className="doc-chip" key={i}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="doc-name">{f.name}</div>
                <div className="doc-meta">{fileSize(f.size)}</div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => setPendingFiles((fs) => fs.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <input
              ref={pendingRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                setPendingFiles((fs) => [...fs, ...picked]);
                if (pendingRef.current) pendingRef.current.value = '';
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => pendingRef.current && pendingRef.current.click()}
            >
              + Add document
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Attachments for one meeting — presentations, shared/received files, etc.
// Backend already supports parent_type='meeting' on documents; this is the UI.
function MeetingDocs({ meetingId }) {
  const { isEditor } = useStore();
  const toast = useToast();
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  function load() {
    api.meeting(meetingId)
      .then((m) => setDocs(m.documents || []))
      .catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [meetingId]);

  async function upload(files) {
    if (!files || !files.length) return;
    setUploading(true);
    setError('');
    try {
      await api.uploadDocs('meeting', meetingId, files);
      toast(files.length > 1 ? 'Documents uploaded' : 'Document uploaded');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeDoc(docId) {
    try {
      await api.deleteDoc(docId);
      toast('Document removed');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!docs) return <Loading label="Loading documents" />;

  return (
    <div>
      <ErrorBanner message={error} />
      {docs.length === 0 && (
        <div className="section-note" style={{ marginBottom: 10 }}>
          No documents attached yet.
        </div>
      )}
      {docs.map((d) => (
        <div className="doc-chip" key={d.id}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="doc-name">{d.original_name}</div>
            <div className="doc-meta">
              {fileSize(d.size_bytes)}
              {d.uploaded_by ? ' · ' + d.uploaded_by : ''}
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => api.downloadDoc(d.id, d.original_name)}>
            Download
          </button>
          {isEditor && (
            <button className="btn btn-sm btn-ghost" onClick={() => removeDoc(d.id)}>
              Remove
            </button>
          )}
        </div>
      ))}
      {isEditor && (
        <div style={{ marginTop: 10 }}>
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => upload(e.target.files)}
          />
          <button
            className="btn"
            disabled={uploading}
            onClick={() => fileRef.current && fileRef.current.click()}
          >
            {uploading ? 'Uploading...' : '+ Upload document'}
          </button>
        </div>
      )}
    </div>
  );
}
