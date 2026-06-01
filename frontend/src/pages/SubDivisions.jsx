// ---------------------------------------------------------------------------
//  Sub-Divisions. Full register with a Quick-Add panel. The sequence number
//  and reference (KM-S03) are assigned by the server, shown after saving.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Loading, Empty, ErrorBanner, Modal, FormFields, ConfirmDialog,
  EngagementPill, useToast, useTableSort, SortableTH,
} from '../components/ui.jsx';
import ViewsBar from '../components/ViewsBar.jsx';
import { useLive } from '../lib/liveStream.js';

const SUB_LIVE_EVENTS = [
  'data.subdivision.created', 'data.subdivision.updated', 'data.subdivision.deleted',
  'data.communication.created', 'data.communication.updated', 'data.communication.deleted',
];

const ENGAGEMENT_STAGES = ['Identified', 'Contacted', 'Response Received', 'Outcome Secured'];

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

// Ladder order: earlier-on-the-ladder = lower rank.
const ENGAGEMENT_RANK = {
  'Identified':       0,
  'Contacted':        1,
  'Response Received':2,
  'Outcome Secured':  3,
};

const SUB_COLS = {
  sub_reference:     { value: (r) => r.sub_reference },
  name:              { value: (r) => r.name },
  authority_code:    { value: (r) => r.authority_code || '' },
  discipline:        { value: (r) => r.discipline || '' },
  engagement_status: { value: (r) => ENGAGEMENT_RANK[r.engagement_status] ?? -1, type: 'number' },
  noc_status:        { value: (r) => r.noc_status || '' },
  overdue_count:     { value: (r) => r.overdue_count, type: 'number', defaultDir: 'desc' },
};

export default function SubDivisions() {
  const { lists, isEditor } = useStore();
  const toast = useToast();
  const navigate = useNavigate();

  const [rows, setRows] = useState(null);
  const [authorities, setAuthorities] = useState([]);
  const [error, setError] = useState('');

  // Filters
  const [q, setQ] = useState('');
  const [statuses, setStatuses] = useState(() => {
    // Seed from a ?status=Identified deep-link (e.g. dashboard "Not yet contacted").
    const s = new URLSearchParams(window.location.search).get('status');
    return s ? s.split(',').filter(Boolean) : [];
  }); // multi-select
  const [authorityId, setAuthorityId] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [adding, setAdding] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [delRow, setDelRow] = useState(null);

  const qDebounced = useDebouncedValue(q, 250);
  useEffect(() => { api.authorities().then(setAuthorities).catch(() => {}); }, []);

  const params = useMemo(() => {
    const p = {};
    if (qDebounced) p.q = qDebounced;
    if (statuses.length) p.status = statuses.join(',');
    if (authorityId) p.authority_id = authorityId;
    if (overdueOnly) p.overdue_only = 'true';
    return p;
  }, [qDebounced, statuses, authorityId, overdueOnly]);

  function load(p) {
    api.subDivisions(p).then(setRows).catch((e) => setError(e.message));
  }
  useEffect(() => { setError(''); load(params); }, [params]);

  // Live refresh on any sub-division or communication mutation upstream.
  useLive(SUB_LIVE_EVENTS, () => load(params));

  function toggleStatus(s) {
    setStatuses((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]
    );
  }
  function clearFilters() {
    setQ(''); setStatuses([]); setAuthorityId(''); setOverdueOnly(false);
  }
  const filtersActive = !!(q || statuses.length || authorityId || overdueOnly);

  const { sorted, sortKey, sortDir, onSort } = useTableSort(rows || [], SUB_COLS, {
    defaultKey: 'sub_reference',
    defaultDir: 'asc',
  });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Sub-Divisions</div>
        </div>
        {isEditor && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add Sub-Division
          </button>
        )}
      </div>
      <div className="page">
        <ErrorBanner message={error} />

        {isEditor && (
          <div className="quickadd">
            <div className="quickadd-text">
              <strong>Quick add.</strong> Choose the parent authority and the new
              sub-division is placed under it. The sequence number and reference
              are assigned automatically.
            </div>
            <button className="btn" onClick={() => setAdding(true)}>
              + Add Sub-Division
            </button>
          </div>
        )}

        <ViewsBar
          target="sub_divisions"
          currentParams={params}
          onApply={(p) => {
            setQ(p.q || '');
            setStatuses(p.status ? String(p.status).split(',') : []);
            setAuthorityId(p.authority_id ? String(p.authority_id) : '');
            setOverdueOnly(p.overdue_only === 'true');
          }}
        />

        <div className="filter-bar">
          <input
            className="search"
            placeholder="Search by name, reference, discipline, contact"
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
          <label className="check-row" style={{ background: 'var(--surface)', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />
            <span>Overdue only</span>
          </label>
        </div>
        <div className="filter-bar" style={{ marginTop: 10 }}>
          <span className="section-note" style={{ marginRight: 4 }}>Status:</span>
          {ENGAGEMENT_STAGES.map((s) => (
            <button
              key={s}
              type="button"
              className={'chip ' + (statuses.includes(s) ? 'chip-on' : '')}
              onClick={() => toggleStatus(s)}
            >
              {s}
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
            onClick={() => api.downloadExport('/exports/sub-divisions.xlsx', 'sub-divisions.xlsx')}
            title="Download all sub-divisions as .xlsx"
          >
            Export
          </button>
        </div>

        {!rows ? (
          <Loading label="Loading sub-divisions" />
        ) : rows.length === 0 ? (
          <Empty title="No sub-divisions match these filters" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortableTH id="sub_reference"     sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Reference</SortableTH>
                  <SortableTH id="name"              sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Sub-Division</SortableTH>
                  <SortableTH id="authority_code"    sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Authority</SortableTH>
                  <SortableTH id="discipline"        sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Discipline</SortableTH>
                  <SortableTH id="engagement_status" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Status</SortableTH>
                  <SortableTH id="noc_status"        sortKey={sortKey} sortDir={sortDir} onSort={onSort}>NOC Status</SortableTH>
                  <SortableTH id="overdue_count"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="num">Overdue</SortableTH>
                  {isEditor && <th></th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.id}
                    className="clickable"
                    onClick={() => navigate('/app/sub-divisions/' + r.id)}
                  >
                    <td className="mono">{r.sub_reference}</td>
                    <td className="cell-strong">{r.name}</td>
                    <td>{r.authority_code}</td>
                    <td>{r.discipline || '-'}</td>
                    <td>
                      <EngagementPill status={r.engagement_status} />
                    </td>
                    <td>{r.noc_status}</td>
                    <td className="num">{r.overdue_count}</td>
                    {isEditor && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setEditRow(r)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setDelRow(r)}
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
        <SubForm
          lists={lists}
          authorities={authorities}
          onClose={() => setAdding(false)}
          onSaved={(ref) => {
            setAdding(false);
            toast('Sub-division added: ' + ref);
            load(params);
          }}
        />
      )}
      {editRow && (
        <SubForm
          lists={lists}
          authorities={authorities}
          existing={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => {
            setEditRow(null);
            toast('Sub-division updated');
            load(params);
          }}
        />
      )}
      {delRow && (
        <ConfirmDialog
          title="Delete sub-division"
          message={`Delete "${delRow.name}" (${delRow.sub_reference})? Its communications are removed too. This cannot be undone.`}
          onClose={() => setDelRow(null)}
          onConfirm={async () => {
            try {
              await api.deleteSub(delRow.id);
              setDelRow(null);
              toast('Sub-division deleted');
              load(params);
            } catch (e) {
              setDelRow(null);
              setError(e.message || 'Delete failed.');
            }
          }}
        />
      )}
    </>
  );
}

export function SubForm({ lists, authorities, existing, onClose, onSaved }) {
  const editing = !!existing;
  const [values, setValues] = useState(
    editing
      ? {
          authority_id: String(existing.authority_id),
          name: existing.name,
          discipline: existing.discipline || '',
          primary_objective: existing.primary_objective || '',
          target_stage: existing.target_stage || '',
          date_identified: (existing.date_identified || '').slice(0, 10),
          primary_contact: existing.primary_contact || '',
          designation: existing.designation || '',
          contact_details: existing.contact_details || '',
          data_collection_status: existing.data_collection_status || 'Not Started',
          consultation_status: existing.consultation_status || 'Not Started',
          noc_status: existing.noc_status || 'Not Started',
          outcome_secured: !!existing.outcome_secured,
        }
      : {
          authority_id: '', name: '', discipline: '', primary_objective: '',
          target_stage: '', date_identified: '', primary_contact: '',
          designation: '', contact_details: '',
          data_collection_status: 'Not Started',
          consultation_status: 'Not Started',
          noc_status: 'Not Started', outcome_secured: false,
        }
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onChange = (n, v) => setValues((s) => ({ ...s, [n]: v }));

  const authOptions = authorities.map((a) => ({
    value: String(a.id),
    label: `${a.code} - ${a.name}`,
  }));

  const baseFields = [
    { name: 'authority_id', label: 'Parent Authority', type: 'select',
      required: true, span: 2, options: authOptions, disabled: editing },
    { name: 'name', label: 'Sub-Division Name', required: true, span: 2 },
    { name: 'discipline', label: 'Discipline', type: 'select', options: lists.discipline },
    { name: 'primary_objective', label: 'Primary Objective', type: 'select',
      options: lists.primary_objective },
    { name: 'target_stage', label: 'Target Stage', type: 'select',
      options: lists.target_stage },
    { name: 'date_identified', label: 'Date Identified', type: 'date' },
    { name: 'primary_contact', label: 'Primary Contact' },
    { name: 'designation', label: 'Designation' },
    { name: 'contact_details', label: 'Contact Details', span: 2 },
  ];
  const editFields = [
    { name: 'data_collection_status', label: 'Data Collection Status', type: 'select',
      options: lists.data_collection_status },
    { name: 'consultation_status', label: 'Consultation Status', type: 'select',
      options: lists.consultation_status },
    { name: 'noc_status', label: 'NOC Status', type: 'select',
      options: lists.noc_status, span: 2 },
    { name: 'outcome_secured', label: 'Outcome secured for this sub-division',
      type: 'checkbox', span: 2 },
  ];
  const fields = editing ? [...baseFields, ...editFields] : baseFields;

  async function save() {
    setError('');
    if (!values.authority_id) return setError('A parent authority is required.');
    if (!values.name.trim()) return setError('A sub-division name is required.');
    setBusy(true);
    try {
      const payload = { ...values, authority_id: Number(values.authority_id) };
      if (!payload.date_identified) payload.date_identified = null;
      if (editing) {
        await api.updateSub(existing.id, payload);
        onSaved(existing.sub_reference);
      } else {
        const created = await api.createSub(payload);
        onSaved(created.sub_reference);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={editing ? 'Edit Sub-Division' : 'Add Sub-Division'}
      sub={
        editing
          ? existing.sub_reference
          : 'The reference is assigned once the parent authority is chosen'
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Add sub-division'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <FormFields fields={fields} values={values} onChange={onChange} disabled={busy} />
    </Modal>
  );
}
