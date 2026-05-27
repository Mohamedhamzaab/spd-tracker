// ---------------------------------------------------------------------------
//  Sub-Divisions. Full register with a Quick-Add panel. The sequence number
//  and reference (KM-S03) are assigned by the server, shown after saving.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Loading, Empty, ErrorBanner, Modal, FormFields, ConfirmDialog,
  EngagementPill, useToast,
} from '../components/ui.jsx';

export default function SubDivisions() {
  const { lists, isEditor } = useStore();
  const toast = useToast();
  const navigate = useNavigate();

  const [rows, setRows] = useState(null);
  const [authorities, setAuthorities] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [delRow, setDelRow] = useState(null);

  function load() {
    api.subDivisions().then(setRows).catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    api.authorities().then(setAuthorities).catch(() => {});
  }, []);

  const filtered = (rows || []).filter((r) => {
    if (statusFilter && r.engagement_status !== statusFilter) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      r.name.toLowerCase().includes(s) ||
      r.sub_reference.toLowerCase().includes(s) ||
      (r.authority_name || '').toLowerCase().includes(s)
    );
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

        <div className="toolbar">
          <input
            className="search"
            placeholder="Search by name, reference or authority"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {['Identified', 'Contacted', 'Response Received', 'Outcome Secured'].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              )
            )}
          </select>
          <span className="section-note">
            {filtered.length} of {(rows || []).length}
          </span>
        </div>

        {!rows ? (
          <Loading label="Loading sub-divisions" />
        ) : filtered.length === 0 ? (
          <Empty title="No sub-divisions found" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Sub-Division</th>
                  <th>Authority</th>
                  <th>Discipline</th>
                  <th>Status</th>
                  <th>NOC Status</th>
                  <th className="num">Overdue</th>
                  {isEditor && <th></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="clickable"
                    onClick={() => navigate('/sub-divisions/' + r.id)}
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
            load();
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
            load();
          }}
        />
      )}
      {delRow && (
        <ConfirmDialog
          title="Delete sub-division"
          message={`Delete "${delRow.name}" (${delRow.sub_reference})? Its communications are removed too. This cannot be undone.`}
          onClose={() => setDelRow(null)}
          onConfirm={async () => {
            await api.deleteSub(delRow.id);
            setDelRow(null);
            toast('Sub-division deleted');
            load();
          }}
        />
      )}
    </>
  );
}

function SubForm({ lists, authorities, existing, onClose, onSaved }) {
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
